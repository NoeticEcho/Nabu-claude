// Узкий доступ к заметкам основного Nabu (public.notes, docs/07 §2.2). Обслуживает конвейер
// разбора «Входящих»: свежие заметки (fleeting) → триаж статуса/типа/доменов. Скоуп по
// пользователю (в персональном режиме — единственный/первый). Записи — write-класс.

import type { Postgres } from "../db/postgres.js";
import { encryptVault, decryptVault, isVaultCiphertext } from "../vault-crypto.js";

export interface Note {
  id: string;
  title: string;
  type: string;
  status: string;
  domain: string[];
  visibility: string;
  contentNormalized?: string;
  createdAt: string;
}

export class NotesRepository {
  private userId: string | null = null;

  constructor(
    private readonly pg: Postgres,
    private readonly configuredUserId?: string,
  ) {
    this.userId = configuredUserId ?? null;
  }

  private async user(): Promise<string> {
    if (this.userId) return this.userId;
    // FAIL-CLOSED: в общей многопользовательской БД без NABU_USER_ID нельзя угадывать владельца —
    // это привело бы к чтению/записи чужих данных. Fallback допустим ТОЛЬКО если пользователь один.
    const rows = await this.pg.query<{ id: string }>("select id from users order by created_at limit 2");
    if (rows.length === 0) throw new Error("Нет пользователей в БД");
    if (rows.length > 1) {
      throw new Error(
        "NABU_USER_ID не задан, а в общей БД несколько пользователей. Задайте NABU_USER_ID (uuid из public.users) для корректной изоляции — доступ к заметкам заблокирован во избежание утечки.",
      );
    }
    this.userId = rows[0]!.id;
    return this.userId;
  }

  /** Создать заметку. По умолчанию visibility='private' (входящие часто медицина/финансы/отношения). */
  async add(t: { title: string; content?: string; visibility?: string }): Promise<{ id: string }> {
    const u = await this.user();
    const visibility = t.visibility ?? "private";
    // Vault (инвариант #2): шифруем ТОЛЬКО content_normalized до записи в БД. title остаётся
    // plaintext — он нужен для списков/навигации; поэтому в title не класть чувствительное.
    const content =
      visibility === "vault" && t.content != null ? encryptVault(t.content) : (t.content ?? null);
    const row = await this.pg.queryOne<{ id: string }>(
      `insert into notes(user_id, title, content_normalized, visibility)
       values ($1,$2,$3,$4) returning id`,
      [u, t.title, content, visibility],
    );
    return { id: row!.id };
  }

  /** Список заметок пользователя (по возрастанию даты — сначала старые входящие). */
  async list(opts: { status?: string; limit?: number } = {}): Promise<Note[]> {
    const u = await this.user();
    const cond = ["user_id = $1", "deleted_at is null"];
    const params: unknown[] = [u];
    if (opts.status) {
      params.push(opts.status);
      cond.push(`status = $${params.length}`);
    }
    params.push(opts.limit ?? 50);
    const rows = await this.pg.query<{
      id: string;
      title: string;
      type: string;
      status: string;
      domain: string[];
      visibility: string;
      content_normalized: string | null;
      created_at: string;
    }>(
      `select id, title, type, status, domain, visibility, content_normalized, created_at
       from notes where ${cond.join(" and ")} order by created_at asc limit $${params.length}`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      status: r.status,
      domain: r.domain,
      visibility: r.visibility,
      // Приватность: рутинные списки НЕ тянут vault-plaintext в контекст Claude — отдаём
      // заглушку. Расшифровка vault — только через явные пути (memory-server list_vault для
      // чтения пользователем, getContentDecrypted для локальных обработчиков).
      contentNormalized:
        r.content_normalized == null
          ? undefined
          : r.visibility === "vault"
            ? "[vault: скрыто]"
            : r.content_normalized,
      createdAt: r.created_at,
    }));
  }

  /**
   * Получить расшифрованное содержимое заметки по id (скоуп по пользователю). Vault-шифртекст
   * расшифровывается локальным ключом; при отсутствии/неверном ключе decryptVault бросает
   * внятную ошибку (в отличие от list(), заглушка тут не нужна). null, если заметка не найдена.
   * Предназначен для ЛОКАЛЬНЫХ обработчиков (extract_entities_local и т.п.), где текст НЕ
   * попадает в контекст Claude — только vault читается в открытую именно здесь.
   */
  async getContentDecrypted(id: string): Promise<string | null> {
    const u = await this.user();
    const row = await this.pg.queryOne<{ content_normalized: string | null }>(
      "select content_normalized from notes where id = $1 and user_id = $2 and deleted_at is null",
      [id, u],
    );
    if (!row) return null;
    const c = row.content_normalized;
    if (c == null) return null;
    return isVaultCiphertext(c) ? decryptVault(c) : c;
  }

  /** Триаж заметки: обновить только переданные поля (статус/тип/домены/заголовок). */
  async update(
    id: string,
    patch: { status?: string; type?: string; domain?: string[]; title?: string },
  ): Promise<boolean> {
    const u = await this.user();
    const sets: string[] = [];
    const params: unknown[] = [id, u];
    if (patch.status !== undefined) {
      params.push(patch.status);
      sets.push(`status = $${params.length}`);
    }
    if (patch.type !== undefined) {
      params.push(patch.type);
      sets.push(`type = $${params.length}`);
    }
    if (patch.domain !== undefined) {
      params.push(patch.domain);
      sets.push(`domain = $${params.length}`);
    }
    if (patch.title !== undefined) {
      params.push(patch.title);
      sets.push(`title = $${params.length}`);
    }
    if (sets.length === 0) return false; // нечего обновлять
    sets.push("updated_at = now()");
    const r = await this.pg.queryOne<{ id: string }>(
      `update notes set ${sets.join(", ")} where id = $1 and user_id = $2 returning id`,
      params,
    );
    return !!r;
  }

  /** Счётчик заметок по статусам (для сводки «Входящих»). */
  async countByStatus(): Promise<Record<string, number>> {
    const u = await this.user();
    const rows = await this.pg.query<{ status: string; count: string }>(
      "select status, count(*) as count from notes where user_id = $1 and deleted_at is null group by status",
      [u],
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  }
}
