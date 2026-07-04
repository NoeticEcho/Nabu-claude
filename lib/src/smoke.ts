// Smoke-тест фундамента: проверяет Postgres, Ollama-эмбеддинги, запись/чтение памяти
// и (мягко) доступность TypeDB. Запуск: npm run smoke  (node --env-file=.env lib/dist/smoke.js)

import { buildDeps } from "./index.js";

async function main(): Promise<void> {
  const deps = buildDeps();
  const results: Array<[string, string]> = [];

  // 1. Postgres
  const pgOk = await deps.pg.ping();
  results.push(["Postgres ping", pgOk ? "OK" : "FAIL"]);
  if (!pgOk) throw new Error("Postgres недоступен — проверь DATABASE_URL");

  // 2. Ollama эмбеддинги
  const ollamaOk = await deps.embedder.ping();
  results.push(["Ollama ping", ollamaOk ? "OK" : "FAIL"]);
  const vec = await deps.embedder.embed("тестовый факт о пользователе", "private");
  results.push([`Embedding dim`, `${vec.length}`]);

  // 3. Запись working memory + episodic + semantic, затем recall
  await deps.memory.setWorking({ sessionId: "smoke", content: "рабочий контекст", meta: {} });
  const w = await deps.memory.getWorking("smoke");
  results.push(["Working memory rows", `${w.length}`]);

  const ep = await deps.memory.rememberEpisode({
    event: "Пользователь начал сборку Nabu-claude и проверил фундамент",
    actors: ["user"],
    context: { source: "smoke" },
    visibility: "private",
  });
  results.push(["Episode id", ep.id.slice(0, 8)]);

  const fact = await deps.memory.addFact({
    subject: "пользователь",
    predicate: "строит",
    object: "Nabu-claude",
    confidence: 0.95,
    source: "smoke",
    visibility: "private",
  });
  results.push(["Fact id", fact.id.slice(0, 8)]);

  const hits = await deps.memory.recall({ query: "что строит пользователь", topK: 5 });
  results.push(["Recall hits", `${hits.length}`]);
  if (hits[0]) results.push(["Top hit", `${hits[0].kind} score=${hits[0].score.toFixed(3)}`]);

  // 4. TypeDB (мягко — недоступность НЕ роняет фундамент)
  try {
    const graphOk = await deps.graph.available();
    results.push(["TypeDB available", graphOk ? "OK" : "недоступен (Postgres-fallback)"]);
    if (graphOk) {
      await deps.graph.upsertConcept("Nabu-claude", { entityType: "project", visibility: "private" });
      await deps.graph.upsertConcept("пользователь", { entityType: "person", visibility: "private" });
      await deps.graph.relateConcepts("пользователь", "Nabu-claude", "строит");
      const nb = await deps.graph.neighbors("пользователь");
      results.push(["Graph neighbors(пользователь)", nb.join(", ") || "(пусто)"]);
    }
  } catch (err) {
    results.push(["TypeDB available", `ошибка: ${(err as Error).message}`]);
  }

  // Очистка ВСЕХ smoke-записей (не засоряем реальную БД; строго в своём namespace).
  const smokeNs = await deps.pg.resolveNamespace(deps.namespace);
  await deps.pg.query("delete from working_memory where namespace = $1 and session_id = 'smoke'", [smokeNs]);
  await deps.pg.query("delete from episodic_memory where namespace = $1 and context->>'source' = 'smoke'", [smokeNs]);
  await deps.pg.query("delete from semantic_facts where namespace = $1 and source = 'smoke'", [smokeNs]);

  console.log("\n=== Nabu-claude smoke ===");
  for (const [k, v] of results) console.log(`  ${k.padEnd(28)} ${v}`);
  console.log("=========================\n");

  await deps.graphClient.close();
  await deps.pg.close();
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
