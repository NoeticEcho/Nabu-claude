// registry.ts — общий банк/рынок агентов (OlimpOS P4). Определения агентов живут в файлах
// (agents/*.md), а метаданные/происхождение/видимость/использование — в таблице agent_registry.
// builtin — встроенные (общие всем); shared — созданные пользователем и опубликованные в банк;
// private — личные (только автору). Общая процедурная память/скиллы — в namespace COMMONS_NS.

import type { Postgres } from "./db/postgres.js";
import { COMMONS_NS } from "./tenancy.js";

export type AgentVisibility = "builtin" | "shared" | "private";

export interface AgentEntry {
  slug: string;
  originUser: string | null;
  visibility: AgentVisibility;
  specPath: string | null;
  usageCount: number;
}

/** Зарегистрировать/обновить агента в реестре (idempotent по slug). */
export async function registerAgent(
  pg: Postgres,
  e: { slug: string; originUser?: string | null; visibility?: AgentVisibility; specPath?: string | null },
): Promise<void> {
  await pg.query(
    `insert into agent_registry(slug, origin_user, visibility, spec_path)
     values ($1,$2,$3,$4)
     on conflict (slug) do update set
       origin_user = coalesce(agent_registry.origin_user, excluded.origin_user),
       visibility  = excluded.visibility,
       spec_path   = coalesce(excluded.spec_path, agent_registry.spec_path)`,
    [e.slug, e.originUser ?? null, e.visibility ?? "private", e.specPath ?? null],
  );
}

/** Засеять встроенных агентов (visibility=builtin). Не перетирает уже shared/private. */
export async function seedBuiltinAgents(pg: Postgres, slugs: string[]): Promise<number> {
  let n = 0;
  for (const slug of slugs) {
    await pg.query(
      "insert into agent_registry(slug, visibility, spec_path) values ($1,'builtin',$2) on conflict (slug) do nothing",
      [slug, `agents/${slug}.md`],
    );
    n++;
  }
  return n;
}

/**
 * Опубликовать СВОЕГО личного агента в общий банк (shared). Скоуп по владельцу: публиковать можно
 * только агента, у которого `origin_user` = вызывающий (или ещё не задан — тогда застолбить за ним).
 * Без фильтра `origin_user` любой пользователь мог бы опубликовать ЧУЖОГО приватного агента (AUDIT R8 M1).
 */
export async function shareAgent(pg: Postgres, slug: string, originUser: string): Promise<boolean> {
  if (!originUser) return false; // без владельца публиковать нечего (fail-closed)
  const r = await pg.query(
    `update agent_registry set visibility='shared', origin_user=$2
     where slug=$1 and visibility<>'builtin' and (origin_user=$2 or origin_user is null)
     returning slug`,
    [slug, originUser],
  );
  return r.length > 0;
}

/**
 * Список агентов, ДОСТУПНЫХ пользователю: все builtin + shared + собственные private.
 * opts.onlyShared — только опубликованные (рынок). Сортировка по usage (популярность).
 */
export async function listAgents(pg: Postgres, opts: { userId?: string; onlyShared?: boolean; limit?: number } = {}): Promise<AgentEntry[]> {
  const limit = opts.limit ?? 200;
  const rows = opts.onlyShared
    ? await pg.query<AgentRow>("select * from agent_registry where visibility='shared' order by usage_count desc limit $1", [limit])
    : await pg.query<AgentRow>(
        "select * from agent_registry where visibility in ('builtin','shared') or (visibility='private' and origin_user=$1) order by usage_count desc limit $2",
        [opts.userId ?? null, limit],
      );
  return rows.map(mapAgent);
}

/** Инкремент счётчика использования агента (для рейтинга рынка). */
export async function incrementAgentUsage(pg: Postgres, slug: string): Promise<void> {
  await pg.query("update agent_registry set usage_count = usage_count + 1 where slug = $1", [slug]);
}

interface AgentRow { slug: string; origin_user: string | null; visibility: string; spec_path: string | null; usage_count: string | number; }
function mapAgent(r: AgentRow): AgentEntry {
  return {
    slug: r.slug,
    originUser: r.origin_user,
    visibility: r.visibility as AgentVisibility,
    specPath: r.spec_path,
    usageCount: Number(r.usage_count),
  };
}

// ── Общая процедурная память / скиллы (COMMONS_NS) ──
// Процедуры банка доступны всем; пишутся в общий namespace. Позволяет агентам переиспользовать
// «как делать X», накопленное сообществом. (Личные процедуры остаются в личном namespace.)

export { COMMONS_NS };
