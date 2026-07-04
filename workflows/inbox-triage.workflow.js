// inbox-triage.workflow.js — массовый разбор горнила Nabu (00-inbox).
// ОПЦИОНАЛЬНЫЙ ассет: workflows в Claude Code — SDK/CLI-only, плагином не устанавливаются.
// Запуск через инструмент Workflow или /inbox-triage (если сохранён в .claude/workflows/).
//
// ВАЖНО: это НЕ обычный ES-модуль. Тело исполняется в песочнице инструмента Workflow, которая
// оборачивает его в async-функцию и предоставляет глобалы phase()/log()/agent()/pipeline()/args.
// Поэтому top-level `await` и `return` здесь корректны. `node --check`/прямой import этого файла
// дадут "return outside function" — это ожидаемо и НЕ является багом (не запускайте его как модуль).
//
// Пайплайн по каждому файлу горнила (параллельно, результаты — в переменных скрипта, не в контексте):
//   классификация (домен/тип/приватность) → извлечение сущностей/фактов → предложение назначения.
// Итог — сводка + план перемещений. Применение (перемещение/запись в память) — по approval.

export const meta = {
  name: 'inbox-triage',
  description: 'Массовый разбор горнила 00-inbox: классификация → сущности → план назначения',
  phases: [
    { title: 'Scan', detail: 'найти файлы горнила' },
    { title: 'Triage', detail: 'по файлу: классификация → сущности → назначение' },
    { title: 'Synthesize', detail: 'сводка и план перемещений' },
  ],
};

const CLASSIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'domains', 'noteType', 'visibility', 'destination', 'entities', 'summary'],
  properties: {
    file: { type: 'string' },
    domains: { type: 'array', items: { type: 'string' } },
    noteType: { type: 'string', enum: ['fleeting', 'literature', 'evergreen', 'task', 'idea', 'decision', 'other'] },
    visibility: { type: 'string', enum: ['default', 'private', 'vault'] },
    destination: { type: 'string', description: 'куда в workspace (напр. 10-knowledge/literature или 20-domains/health)' },
    entities: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
};

phase('Scan');
// args: { inbox: "<абс.путь к 00-inbox>", files: ["...", ...] } — передаётся при запуске.
const files = (args && Array.isArray(args.files)) ? args.files : [];
if (files.length === 0) {
  log('Нет файлов для разбора (передай args.files — список путей из 00-inbox).');
  return { triaged: 0, plan: [] };
}
log(`К разбору файлов: ${files.length}`);

phase('Triage');
const results = await pipeline(
  files,
  (file) =>
    agent(
      `Ты — конвейер приёма Nabu. Разбери ОДИН файл горнила: ${file}.\n` +
        `Прочитай его (Read), определи: сферы жизни (health/mind/finance/work/learning/relationships/growth/lifestyle/admin), ` +
        `тип заметки, visibility (медицина/финансы/отношения → private; нет ясности → private), ` +
        `куда положить в workspace, ключевые сущности и краткое резюме. Только из содержимого — не выдумывай. ` +
        `Приватное не выноси наружу.`,
      { label: `triage:${file.split('/').pop()}`, phase: 'Triage', schema: CLASSIFY_SCHEMA, effort: 'low' },
    ),
);

phase('Synthesize');
const plan = results.filter(Boolean);
const byDomain = {};
for (const r of plan) for (const d of r.domains || ['(none)']) byDomain[d] = (byDomain[d] || 0) + 1;
log(`Разобрано ${plan.length}/${files.length}. По сферам: ${JSON.stringify(byDomain)}`);

return {
  triaged: plan.length,
  byDomain,
  plan: plan.map((r) => ({ file: r.file, destination: r.destination, visibility: r.visibility, noteType: r.noteType })),
  note: 'План назначения. Перемещение файлов и запись сущностей/фактов в память — только после approval пользователя.',
};
