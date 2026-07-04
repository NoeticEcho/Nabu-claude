// Личность агентов в БД (agent_personality) + рендеринг директив. Источник истины черт —
// профили agents/*.json; таблица нужна для эволюции (evolves=true) и лога изменений.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Postgres } from "../db/postgres.js";
import { REPO_ROOT_PATH } from "../config.js";
import { renderPersonalityBlock, applyGuardrails, type Traits } from "../personality.js";

export class PersonalityRepository {
  private nsId: string | null = null;

  constructor(
    private readonly pg: Postgres,
    private readonly namespace: string,
  ) {}

  private async ns(): Promise<string> {
    if (!this.nsId) this.nsId = await this.pg.resolveNamespace(this.namespace);
    return this.nsId;
  }

  /** Прочитать профиль agents/<agent>.json (источник истины черт). */
  private readProfile(agent: string): { traits: Partial<Traits>; evolves: boolean; guardrails: Record<string, unknown> } | undefined {
    const p = join(REPO_ROOT_PATH, "agents", `${agent}.json`);
    if (!existsSync(p)) return undefined;
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (!j.traits) return undefined;
    return { traits: j.traits, evolves: !!j.evolves, guardrails: j.guardrails ?? {} };
  }

  /** Засеять/обновить agent_personality из всех профилей agents/*.json (идемпотентно). */
  async seedFromProfiles(): Promise<{ seeded: number }> {
    const ns = await this.ns();
    const dir = join(REPO_ROOT_PATH, "agents");
    let seeded = 0;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json") || f === "registry.json") continue;
      const agent = f.replace(/\.json$/, "");
      const prof = this.readProfile(agent);
      if (!prof) continue;
      await this.pg.query(
        `insert into agent_personality(namespace, agent, traits, evolves, guardrails)
         values ($1,$2,$3,$4,$5)
         on conflict (namespace, agent) do update set
           traits = excluded.traits, evolves = excluded.evolves, guardrails = excluded.guardrails, updated_at = now()`,
        [ns, agent, JSON.stringify(prof.traits), prof.evolves, JSON.stringify(prof.guardrails)],
      );
      seeded++;
    }
    return { seeded };
  }

  /** Черты агента: из БД (если засеяно/эволюционировало), иначе из профиля на диске. */
  async getTraits(agent: string): Promise<Partial<Traits> | undefined> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ traits: Partial<Traits> }>(
      "select traits from agent_personality where namespace = $1 and agent = $2",
      [ns, agent],
    );
    if (row?.traits) return row.traits;
    return this.readProfile(agent)?.traits;
  }

  /** Готовый текстовый блок директив личности для системного промпта агента. */
  async render(agent: string): Promise<string | undefined> {
    const traits = await this.getTraits(agent);
    if (!traits) return undefined;
    // Применяем floor-пороги guardrails профиля (honesty≥8 и пр.) до рендера.
    const guardrails = this.readProfile(agent)?.guardrails ?? {};
    return renderPersonalityBlock(agent, applyGuardrails(traits, guardrails));
  }

  /** Эволюция черты (только для evolves=true, шаг ≤±1, с логом). */
  async evolveTrait(agent: string, trait: string, delta: number, reason: string): Promise<boolean> {
    const ns = await this.ns();
    const prof = this.readProfile(agent);
    if (!prof?.evolves) return false;
    const step = Math.max(-1, Math.min(1, delta));
    const cur = await this.getTraits(agent);
    const oldV = typeof (cur as Record<string, number>)?.[trait] === "number" ? (cur as Record<string, number>)[trait]! : 5;
    // honesty/kindness не ниже порогов
    let newV = oldV + step;
    if ((trait === "honesty" && newV < 8) || (trait === "kindness" && newV < 4)) return false;
    // Диапазон по шкале черты: sentiment_bias/extroversion — знаковые [-10,10]; остальные — [0,10]
    // (PERSONALITY_RENDERING.md). Не допускаем выхода 0–10 черт в отрицательные значения.
    const SIGNED = new Set(["sentiment_bias", "extroversion"]);
    const lo = SIGNED.has(trait) ? -10 : 0;
    newV = Math.max(lo, Math.min(10, newV));
    const merged = { ...(cur ?? {}), [trait]: newV };
    await this.pg.query(
      `insert into agent_personality(namespace, agent, traits, evolves) values ($1,$2,$3,true)
       on conflict (namespace, agent) do update set traits = $3, updated_at = now()`,
      [ns, agent, JSON.stringify(merged)],
    );
    await this.pg.query(
      `insert into agent_personality_log(namespace, agent, trait, old_value, new_value, reason)
       values ($1,$2,$3,$4,$5,$6)`,
      [ns, agent, trait, oldV, newV, reason],
    );
    return true;
  }
}
