// Реализация GraphPort на TypeDB 3.x (HTTP). Аддитивно поверх базовой онтологии nabu_dev.
// Если TypeDB недоступен — методы тихо no-op (вызывающая сторона проверяет available()).
//
// TypeQL 3.x: используем современные формы — `links (...)` для relation-инстансов,
// `fetch { }` для проекции чтения, десятичные литералы для double, идемпотентность через `put`
// (по ключу concept-name) и `not { }`-гард для связей.

import type { GraphClient } from "../db/typedb.js";
import { tqlString } from "../db/typedb.js";
import type { GraphPort } from "../ports.js";
import type { Visibility } from "../types.js";

/** double-литерал всегда с десятичной точкой (TypeDB 3.x строг к int vs double). */
function tqlDouble(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

export class GraphRepository implements GraphPort {
  constructor(private readonly client: GraphClient) {}

  async available(): Promise<boolean> {
    return this.client.connect();
  }

  /** Идемпотентно гарантирует существование концепта по ключу concept-name. */
  async upsertConcept(
    name: string,
    opts: { entityType?: string; externalId?: string; visibility?: Visibility } = {},
  ): Promise<void> {
    if (!(await this.available())) return;
    // put по ключу — идемпотентно (создаёт, только если совпадения по concept-name нет)
    await this.client.write(`put $c isa concept, has concept-name ${tqlString(name)};`);
    // Доп. атрибуты добавляем гардированно, чтобы не конфликтовать при повторных вызовах
    if (opts.entityType) {
      await this.client.write(
        `match $c isa concept, has concept-name ${tqlString(name)};
           not { $c has entity-type $et; };
         insert $c has entity-type ${tqlString(opts.entityType)};`,
      );
    }
    if (opts.externalId) {
      await this.client.write(
        `match $c isa concept, has concept-name ${tqlString(name)};
           not { $c has external-id $xid; };
         insert $c has external-id ${tqlString(opts.externalId)};`,
      );
    }
  }

  /** Создаёт ассоциацию source→target (идемпотентно по паре+виду связи). */
  async relateConcepts(from: string, to: string, kind: string, weight = 1.0): Promise<void> {
    if (!(await this.available())) return;
    await this.client.write(
      `match
         $a isa concept, has concept-name ${tqlString(from)};
         $b isa concept, has concept-name ${tqlString(to)};
         not {
           $r0 isa association, links (source-concept: $a, target-concept: $b),
             has relation-kind ${tqlString(kind)};
         };
       insert
         $r isa association, links (source-concept: $a, target-concept: $b),
           has relation-kind ${tqlString(kind)}, has weight ${tqlDouble(weight)};`,
    );
  }

  /** Соседи концепта (цели ассоциаций). Использует fetch-проекцию для детерминированного парсинга. */
  async neighbors(name: string, limit = 20): Promise<string[]> {
    if (!(await this.available())) return [];
    const raw = (await this.client.read(
      `match
         $a isa concept, has concept-name ${tqlString(name)};
         $r isa association, links (source-concept: $a, target-concept: $b);
         $b has concept-name $n;
       limit ${limit};
       fetch { "n": $n };`,
    )) as { answers?: Array<Record<string, unknown>> } | undefined;
    return extractFetch(raw, "n");
  }
}

/** Достаёт значения ключа из ответа fetch (/v1/query): answers[].{key}. Форма значения версионно-устойчива. */
function extractFetch(raw: { answers?: Array<Record<string, unknown>> } | undefined, key: string): string[] {
  const out: string[] = [];
  for (const ans of raw?.answers ?? []) {
    const v = ans?.[key];
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string") {
      out.push((v as { value: string }).value);
    }
  }
  return [...new Set(out)];
}
