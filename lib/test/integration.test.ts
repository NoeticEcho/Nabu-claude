// DB-интеграционные тесты через lib-репозитории на РЕАЛЬНОЙ общей БД (nabu_dev).
// Пропускаются, если нет DATABASE_URL (offline/CI без БД). Каждый тест сам за собой убирает.
// Запуск: npm run test:db  (нужен .env с DATABASE_URL и доступный Postgres).
//
// Namespace-скоуп: всё пишется в служебный namespace `itest-<random>`, чтобы не задеть данные
// пользователя; в конце namespace-строки удаляются.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const HAS_DB = !!process.env.DATABASE_URL;
const suite = HAS_DB ? test : test.skip;

// Уникальный namespace на прогон (без Math.random в проде — тут тест, допустимо).
const NS = `itest-${Date.now()}`;

let deps;
let nsId;

before(async () => {
  if (!HAS_DB) return;
  process.env.NABU_NAMESPACE = NS;
  const lib = await import("../dist/index.js");
  deps = lib.buildDeps();
  nsId = await deps.pg.resolveNamespace(NS);
});

after(async () => {
  if (!HAS_DB || !deps) return;
  // Полная уборка: все строки этого namespace + сам namespace.
  const tables = [
    "working_memory", "episodic_memory", "semantic_facts", "procedures", "prospective_memory",
    "autobiographical_narrative", "mem_association", "agent_personality", "agent_personality_log",
    "knowledge_chunk", "deliberation_synthesis", "deliberation_position", "deliberation",
    "action_log", "action_approval", "system_task", "agent_effectiveness", "improvement_proposal",
    "recommendation",
  ];
  for (const t of tables) {
    try { await deps.pg.query(`delete from ${t} where namespace = $1`, [nsId]); } catch { /* FK-порядок/нет колонки */ }
  }
  try { await deps.pg.query("delete from mem_namespace where id = $1", [nsId]); } catch { /* остались ссылки */ }
  await deps.graphClient.close();
  await deps.pg.close();
});

suite("memory: episode/fact write + hybrid recall + purge", async () => {
  await deps.memory.rememberEpisode({ event: "itest: пользователь настроил сон", actors: ["itest"], context: {}, visibility: "private" });
  const fact = await deps.memory.addFact({ subject: "itest", predicate: "любит", object: "тестирование интеграции", confidence: 0.9, visibility: "private" });
  assert.ok(fact.id, "addFact вернул id");
  const hits = await deps.memory.recall({ query: "что настроил пользователь", topK: 5 });
  assert.ok(hits.length >= 1, "recall нашёл хотя бы одну единицу");
  // visibility-фильтр: vault-факт не должен попадать при исключении vault
  await deps.memory.addFact({ subject: "itest", predicate: "секрет", object: "vault-значение", confidence: 0.9, visibility: "vault" });
  const noVault = await deps.memory.recall({ query: "секрет vault-значение", topK: 10, kinds: ["semantic"], visibility: ["default", "private"] });
  assert.ok(!noVault.some((h) => h.visibility === "vault"), "vault не утёк при фильтре");
  // working + purge
  await deps.memory.setWorking({ sessionId: "itest", content: "врем.", meta: {} });
  const purged = await deps.memory.purgeExpiredWorking();
  assert.ok(typeof purged === "number", "purge вернул число");
});

suite("system_task: add/list/update lifecycle", async () => {
  const { id } = await deps.systemTask.add({ kind: "research", title: "itest задача", priority: "high" });
  const open = await deps.systemTask.list({ status: "open" });
  assert.ok(open.some((t) => t.id === id), "задача видна в open");
  assert.ok(await deps.systemTask.updateStatus(id, "done"), "статус обновлён");
});

suite("improvement: effectiveness + proposal", async () => {
  await deps.improvement.recordEffectiveness({ targetKind: "agent", target: "itest-agent", metric: "acc", value: 0.9, source: "eval" });
  const eff = await deps.improvement.getEffectiveness({ target: "itest-agent" });
  assert.ok(eff.averages.some((a) => a.target === "itest-agent" && Math.abs(a.avg - 0.9) < 1e-9), "среднее эффективности верно");
  const p = await deps.improvement.addProposal({ sourceAgent: "itest", category: "prompt", title: "itest", rationale: "r", proposedChange: "c" });
  assert.ok(await deps.improvement.updateProposal(p.id, "accepted"), "предложение принято");
});

suite("recommendation → outcome → effectiveness loop (feature 13→C)", async () => {
  const rec = await deps.recommendation.record({ sourceAgent: "finance", domain: "finance", question: "подушка?", recommendation: "6 мес" });
  const pending = await deps.recommendation.listPendingFollowup(50);
  assert.ok(pending.some((r) => r.id === rec.id), "рекомендация в очереди на опрос");
  assert.ok(await deps.recommendation.recordOutcome(rec.id, { status: "applied", outcome: "ок", outcomeRating: 4 }), "исход записан");
  // замыкание контура: записать эффективность из исхода (как делает MCP record_outcome)
  await deps.improvement.recordEffectiveness({ targetKind: "agent", target: "finance", metric: "advice_outcome_rating", value: 4, source: "feedback", notes: "itest" });
  const eff = await deps.improvement.getEffectiveness({ target: "finance", metric: "advice_outcome_rating" });
  assert.ok(eff.points.length >= 1, "эффективность из фидбэка записана");
});

suite("personality: seed + render + evolve gating", async () => {
  const seeded = await deps.personality.seedFromProfiles();
  assert.ok(seeded.seeded > 0, "профили засеяны");
  const block = await deps.personality.render("finance");
  assert.ok(block && /honesty/i.test(block), "render вернул директивы");
  // finance evolves=false → эволюция не применяется (gated)
  const evolved = await deps.personality.evolveTrait("finance", "humor", 1, "itest");
  assert.equal(evolved, false, "эволюция gated при evolves=false");
});
