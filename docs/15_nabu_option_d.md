# NABU

*Опция Д · Архитектурная развязка*  
*Контракты для возможной будущей миграции backend*  
*Дополнение к документу 14 (Stack Decision Analysis)*  
*Версия 1.0*  

---

# 1. Назначение и контекст

Документ детализирует Опцию Д из документа 14 (Stack Decision Analysis §9.5). Цель — зафиксировать набор архитектурных контрактов, соблюдение которых на этапе разработки v1 (TypeScript/NestJS/Next.js/Tauri/Mastra) сделает будущую миграцию backend-стека (например, на Elixir/Phoenix в момент перехода в high-scale multi-tenant SaaS) дешёвой и предсказуемой.

Без этих контрактов миграция стека через 12–24 месяца обернётся либо переписыванием всего, либо застрёванием на TS-стеке навсегда. С ними — backend становится сменяемым модулем.

> Главный принцип: контракты — это инварианты. Они не описывают «как удобно», они описывают «что нельзя нарушать ни при каких обстоятельствах». PR, нарушающие эти контракты, не принимаются.

# 2. Базовые принципы развязки

1. Бизнес-логика отделена от runtime-фреймворка. Mastra, NestJS, Drizzle — это инфраструктурные обёртки; бизнес-логика живёт в чистых функциях с явными контрактами.
1. Каждый внешний API (REST, SSE, Realtime, MCP) — версионирован, публикуется как OpenAPI-схема, является нормативным контрактом. Реализация может меняться, контракт — нет (пока не переходим на vN+1).
1. Каждое хранилище — за интерфейсом репозитория. Прямые вызовы Drizzle/Postgres из бизнес-логики запрещены.
1. Каждый агент — stateless функция с типизированными inputs/outputs. Mastra используется как тонкая обёртка вокруг агента, не как место для бизнес-логики.
1. Каждое внешнее событие — типизированный domain event, проходящий через явную event bus абстракцию.
1. Все границы (модули, пакеты, сервисы) явно типизированы. Никаких неявных контрактов через any, unknown или JSON.
1. Тесты проверяют контракты, а не реализации. Покрытие контрактных тестов — обязательное условие merge.

# 3. Контракт агента

Это самый критический контракт. Если он соблюдён — миграция агентского слоя на другой runtime становится механической задачей.

## 3.1. Структура агента в коде

Каждый агент живёт в packages/agents/<group>/<agent-name>/ со следующей структурой (повторяет документ 09, но с явным разделением логики и обёртки):

```
packages/agents/<group>/<agent-name>/
├── agent.ts          # Mastra-обёртка (≤ 50 строк, без бизнес-логики)
├── logic.ts          # ★ ОСНОВНОЙ ФАЙЛ — pure business logic
├── prompt.md         # текущий системный промпт
├── prompt.v1.md      # immutable исторические версии
├── schema.ts         # Zod-схемы input/output
├── tools.ts          # определения tools (см. §4)
├── eval.jsonl        # golden dataset
├── eval.runner.ts    # eval runner (вызывает logic.ts, не agent.ts)
└── README.md         # документация
```

## 3.2. logic.ts — нормативная сигнатура

Каждый агент экспортирует одну главную функцию следующей формы:

```
// packages/agents/understanding/entity-extractor/logic.ts
```

```
import { z } from 'zod';
```

```
export const InputSchema = z.object({
  text: z.string().min(1),
  context: z.object({
    recentEntities: z.array(EntitySchema).optional(),
    locale: z.enum(['ru', 'en']).default('ru'),
  }).optional(),
});
```

```
export const OutputSchema = z.object({
  entities: z.array(z.object({
    type: z.enum(['person', 'place', 'project', 'concept', 'datetime', 'amount', 'emotion']),
    surface_form: z.string(),
    canonical_form: z.string().nullable(),
    attributes: z.record(z.unknown()).optional(),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    confidence: z.number().min(0).max(1),
  })),
  metadata: z.object({
    model_used: z.string(),
    tokens_in: z.number().int(),
    tokens_out: z.number().int(),
    latency_ms: z.number().int(),
  }),
});
```

```
export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
```

```
/**
 * Core agent function. PURE in terms of bus./logic.
 * Side effects: ONLY through injected ports (llm, tools, ctx).
 * NO direct imports of Mastra, NestJS, Drizzle, Supabase, file system.
 */
export async function extractEntities(
  input: Input,
  ports: AgentPorts,
): Promise<Output> {
  // ... pure logic, calls only ports.*
}
```

## 3.3. AgentPorts — единый интерфейс зависимостей

Все внешние зависимости агента инжектируются через AgentPorts — структурированный bag портов. Это позволяет тестировать логику без runtime'а и заменять runtime целиком.

```
// packages/agents/_kernel/ports.ts
```

```
export interface AgentPorts {
  // LLM provider (Anthropic/OpenAI/Ollama — абстракция стирает разницу)
  llm: LlmPort;
```

```
  // Inter-agent dispatch (вызов одного агента из другого)
  agents: AgentDispatcher;
```

```
  // Persistence ports (см. §5)
  repos: RepositoriesPort;
```

```
  // Event bus (см. §6)
  events: EventBusPort;
```

```
  // Logger and telemetry
  log: LoggerPort;
  telemetry: TelemetryPort;
```

```
  // Runtime context (см. §3.4)
  ctx: AgentRuntimeContext;
}
```

```
export interface LlmPort {
  complete(input: LlmCompleteInput): Promise<LlmCompleteOutput>;
  stream(input: LlmCompleteInput): AsyncIterable<LlmStreamChunk>;
  embed(input: { texts: string[]; model?: string }): Promise<number[][]>;
}
```

```
export interface AgentDispatcher {
  invoke<I, O>(agentId: AgentId, input: I): Promise<O>;
  stream<I>(agentId: AgentId, input: I): AsyncIterable<AgentEvent>;
}
```

> Запрет: ни одна функция в logic.ts НЕ должна импортировать ничего из @mastra/*, @nestjs/*, drizzle-orm, @supabase/*, fs, fetch напрямую. Все внешние взаимодействия — через AgentPorts. ESLint-правило перевода в error.

## 3.4. AgentRuntimeContext

Контекст исполнения — иммутабельная структура, прокидывается через всю цепочку вызовов:

```
export interface AgentRuntimeContext {
  readonly userId: UserId;
  readonly sessionId: SessionId;
  readonly traceId: TraceId;
  readonly visibility: 'default' | 'private' | 'vault';
  readonly locale: 'ru' | 'en';
  readonly now: Date;
  readonly abortSignal: AbortSignal;
  readonly budget: {
    readonly tokensRemaining: number;
    readonly costUsdRemaining: number;
  };
}
```

Все эти поля будут идентично существовать в любой будущей реализации (например, как Elixir struct, проходящий через GenServer state). Сама структура — runtime-agnostic.

## 3.5. agent.ts — допустимое содержимое

Mastra-обёртка должна быть тонкой. Допустимое содержимое — ≤ 50 строк:

```
// packages/agents/understanding/entity-extractor/agent.ts
```

```
import { Agent } from '@mastra/core';
import { extractEntities, InputSchema, OutputSchema } from './logic';
import { buildPorts } from '../_kernel/build-ports';
```

```
export const entityExtractorAgent = new Agent({
  name: 'entity-extractor',
  instructions: () => readFile('./prompt.md'),
  model: anthropic('claude-haiku-4-5'),
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async ({ input, runtimeContext }) => {
    const ports = buildPorts(runtimeContext);
    return extractEntities(input, ports);
  },
});
```

Запрещённое содержимое agent.ts:

- Условные ветки в зависимости от input — это бизнес-логика, должна быть в logic.ts.
- Маршрутизация между моделями — должно делаться LlmPort'ом с конфигурацией.
- Вызов других агентов — через ports.agents в logic.ts.
- Прямой вызов БД, S3, внешних HTTP.

## 3.6. Запрещённые антипаттерны

1. Использование Mastra workflows для бизнес-логики. Workflows можно использовать только как декларативную обёртку для оркестрации; ветвление — в logic.ts через явные функции.
1. Mastra memory / threads — НЕ использовать как primary state. Если агенту нужна память — через ports.repos с явной схемой.
1. Mastra evals API — допустимо использовать только если eval можно одновременно запускать без Mastra (т.е. eval.runner.ts вызывает logic.ts напрямую, а не через Mastra-обёртку).
1. Прямые вызовы fetch() из агента — только через LlmPort или специальный HttpPort.

# 4. Контракт инструментов (tools)

## 4.1. Структура tool

```
// packages/agents/_kernel/tools.ts
```

```
export interface ToolDefinition<I, O> {
  readonly id: ToolId;
  readonly description: string;
  readonly inputSchema: z.ZodType<I>;
  readonly outputSchema: z.ZodType<O>;
  execute(input: I, ports: AgentPorts): Promise<O>;
}
```

Tools определяются как plain objects, не как Mastra-specific конструкции. Mastra-адаптер регистрирует их при необходимости.

## 4.2. Реестр инструментов

- Все tools регистрируются в едином реестре packages/agents/_kernel/tools-registry.ts.
- Дублирование запрещено: если уже есть pgvector-search, новый pgvector-search-v2 не создаётся; старый эволюционирует.
- Каждый tool имеет stable id. Изменение id — breaking change, требует ADR.

# 5. Контракт persistence-слоя

## 5.1. Repository pattern

Прямой доступ к Drizzle/Postgres из бизнес-логики, агентов, API-контроллеров — запрещён. Всё идёт через типизированные репозитории.

```
// packages/db/repositories/notes.ts
```

```
export interface NotesRepository {
  findById(id: NoteId, ctx: { userId: UserId }): Promise<Note | null>;
  findByUser(userId: UserId, filter: NotesFilter): Promise<Note[]>;
  create(input: CreateNoteInput, ctx: { userId: UserId }): Promise<Note>;
  update(id: NoteId, patch: UpdateNotePatch, ctx: { userId: UserId; baseVersion: number }): Promise<Note>;
  softDelete(id: NoteId, ctx: { userId: UserId }): Promise<void>;
  listVersions(id: NoteId, ctx: { userId: UserId }): Promise<NoteVersion[]>;
}
```

```
// Drizzle implementation
export class NotesRepositoryDrizzle implements NotesRepository { ... }
```

```
// Future Ecto implementation would be:
// defmodule Nabu.Repositories.Notes do
//   @behaviour Nabu.Behaviors.NotesRepository
//   ...
// end
```

## 5.2. RepositoriesPort

```
export interface RepositoriesPort {
  notes: NotesRepository;
  noteVersions: NoteVersionsRepository;
  entities: EntitiesRepository;       // TypeDB-обёртка
  embeddings: EmbeddingsRepository;
  tags: TagsRepository;
  audit: AuditRepository;
  habits: HabitsRepository;
  tasks: TasksRepository;
  projects: ProjectsRepository;
  quests: QuestsRepository;
  character: CharacterRepository;
  metrics: MetricsRepository;
  users: UsersRepository;
  sessions: SessionsRepository;
  // ... всё, что нужно бизнес-логике
}
```

## 5.3. Транзакции

Транзакционные границы — явные:

```
// Не так:
await db.transaction(async (tx) => {
  await tx.insert(notes).values(...);
  await tx.insert(audit).values(...);
});
```

```
// А так:
await repos.runInTransaction(async (txRepos) => {
  await txRepos.notes.create(...);
  await txRepos.audit.append(...);
});
```

Это позволяет в Elixir-версии реализовать через Ecto.Multi с тем же интерфейсом.

## 5.4. TypeDB и pgvector

TypeDB-доступ — за интерфейсом EntitiesRepository. pgvector-доступ — за интерфейсом EmbeddingsRepository. Никаких TQL-строк или vector_cosine_distance прямо в бизнес-логике.

## 5.5. S3/MinIO

```
export interface ObjectStorePort {
  put(key: ObjectKey, content: Buffer | Readable, meta?: ObjectMeta): Promise<void>;
  get(key: ObjectKey): Promise<{ content: Readable; meta: ObjectMeta }>;
  delete(key: ObjectKey): Promise<void>;
  exists(key: ObjectKey): Promise<boolean>;
}
```

AWS SDK / MinIO client — не импортируются за пределами реализации этого порта.

# 6. Контракт событий (event bus)

## 6.1. Domain events

Все значимые события домена — типизированные:

```
export type DomainEvent =
  | NoteCreated
  | NoteUpdated
  | NoteSoftDeleted
  | EntityResolved
  | HabitLogged
  | QuestCompleted
  | XpAwarded
  | InsightGenerated
  | SyncConflictDetected
  | AuditLlmCalled
  | // ...
```

```
export interface NoteCreated {
  readonly type: 'note.created';
  readonly traceId: TraceId;
  readonly occurredAt: Date;
  readonly userId: UserId;
  readonly noteId: NoteId;
  readonly version: number;
  readonly source: 'web' | 'desktop' | 'mobile' | 'import' | 'api';
}
```

## 6.2. EventBusPort

```
export interface EventBusPort {
  publish(event: DomainEvent): Promise<void>;
  publishBatch(events: DomainEvent[]): Promise<void>;
```

```
  // Подписка — только в инфраструктурном слое, не из бизнес-логики
  subscribe<T extends DomainEvent>(
    eventType: T['type'],
    handler: (event: T) => Promise<void>,
  ): Subscription;
}
```

## 6.3. Реализации

- Текущая (TS): Supabase Realtime + Postgres LISTEN/NOTIFY + pgmq для durable обработки.
- Будущая (Elixir): Phoenix.PubSub + Oban — single API, разная реализация.

# 7. Контракт API

## 7.1. OpenAPI как нормативная истина

1. API спецификация (документ 08) — это нормативный контракт. Реализация может меняться, контракт — только через v2.
1. OpenAPI 3.1 публикуется в /v1/openapi.json. Это машиночитаемый контракт; клиенты генерируют типы из него.
1. Любое изменение OpenAPI — отдельный PR, отдельный review (back+front). Поломка существующих клиентов — fail CI.

## 7.2. Версионирование

- /v1/* — стабильно. Только добавление optional полей. Breaking changes — в /v2/.
- После выпуска /v2/ — /v1/* живёт ≥ 12 месяцев. Удаление — через 12-месячный deprecation.
- Заголовок X-API-Deprecated в ответах удаляемых эндпоинтов.

## 7.3. NestJS — тонкая обёртка

Controllers НЕ содержат бизнес-логики. Только: парсинг input, вызов service, формирование response.

```
// apps/api/src/notes/notes.controller.ts
```

```
@Controller('v1/notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}
```

```
  @Post()
  @UseGuards(AuthGuard)
  async create(
    @Body() body: CreateNoteDto,           // class-validator-валидация
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.notes.create(body, { userId: user.id });
    return ApiResponseMapper.note(result);  // в snake_case API-формат
  }
}
```

```
// apps/api/src/notes/notes.service.ts
export class NotesService {
  constructor(private readonly repos: RepositoriesPort, private readonly events: EventBusPort) {}
```

```
  async create(input: CreateNoteInput, ctx: { userId: UserId }): Promise<Note> {
    // ★ Бизнес-логика. Идентично может быть переписано на Elixir
    const note = await this.repos.notes.create(input, ctx);
    await this.events.publish({ type: 'note.created', noteId: note.id, ... });
    return note;
  }
}
```

# 8. Контракт аутентификации

## 8.1. AuthPort

```
export interface AuthPort {
  validateToken(token: string): Promise<AuthenticatedUser | null>;
  issueAccessToken(userId: UserId, scopes: Scope[]): Promise<{ token: string; expiresAt: Date }>;
  issueRefreshToken(userId: UserId, deviceId: DeviceId): Promise<{ token: string; expiresAt: Date }>;
  revokeRefreshToken(token: string): Promise<void>;
  listActiveSessions(userId: UserId): Promise<Session[]>;
}
```

Сейчас реализуется через Supabase GoTrue. При миграции backend — реализация меняется, контракт остаётся.

## 8.2. JWT-формат

- Стандартный JWT с claims: sub (userId), exp, iat, aud, iss.
- Алгоритм подписи: EdDSA (Ed25519) или RS256.
- Этот формат runtime-agnostic. Elixir-реализация валидирует JWT тем же ключом.

# 9. Контракт конфигурации

## 9.1. Все runtime-конфиги — через явные структуры

```
// packages/core/config/schema.ts
```

```
export const ConfigSchema = z.object({
  database: z.object({
    url: z.string().url(),
    poolMax: z.number().int().positive().default(20),
  }),
  llm: z.object({
    anthropicApiKey: z.string().optional(),
    openaiApiKey: z.string().optional(),
    voyageApiKey: z.string().optional(),
    defaultProvider: z.enum(['anthropic', 'openai', 'local']).default('anthropic'),
    budgetUsdPerDayPerUser: z.number().positive().default(5),
  }),
  storage: z.object({
    s3Endpoint: z.string().url(),
    s3Bucket: z.string(),
    // ...
  }),
  // ...
});
```

```
export type Config = z.infer<typeof ConfigSchema>;
```

```
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return ConfigSchema.parse({
    database: { url: env.DATABASE_URL!, poolMax: Number(env.DB_POOL_MAX ?? 20) },
    // ...
  });
}
```

Все имена env-переменных и их значения — задокументированы. В Elixir-версии — Application.compile_env с тем же набором ключей.

# 10. Контракт сборки и структуры кода

## 10.1. Запреты на уровне зависимостей

Граф зависимостей пакетов жёстко фиксирован. ESLint + Madge проверяют на CI:

```
packages/core/        # No deps to anything except zod
packages/db/          # Depends on: core
packages/typedb/      # Depends on: core
packages/sync/        # Depends on: core, db
packages/agents/      # Depends on: core, db, typedb (но НЕ напрямую — через ports)
packages/agents/_kernel/ports.ts  # ★ нет импортов из @mastra/*, @nestjs/*
```

```
apps/api/             # Depends on: core, db, typedb, agents
apps/worker/          # Depends on: core, db, typedb, agents, sync
apps/web/             # Depends on: core, ui, editor, markdown, api-client
                      # Не зависит от apps/api или packages/agents напрямую
```

```
# ЗАПРЕТЫ:
# - packages/agents/<logic> НЕ импортирует @mastra/*, @nestjs/*, drizzle-orm
# - packages/agents/<logic> НЕ импортирует apps/*
# - apps/web НЕ импортирует apps/api
```

## 10.2. Phantom-types для исключения смешения id

```
// packages/core/types/ids.ts
```

```
declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };
```

```
export type UserId = Brand<string, 'UserId'>;
export type NoteId = Brand<string, 'NoteId'>;
export type SessionId = Brand<string, 'SessionId'>;
// и т. д.
```

Это делает невозможным случайно передать UserId туда, где ожидается NoteId. В Elixir-версии — типы через @type или structs.

# 11. Тестирование контрактов

## 11.1. Contract tests как отдельная категория

Помимо unit/integration/e2e (документ 10) — отдельная категория contract tests. Они проверяют, что реализации соблюдают контракты.

1. Для каждой repository — общий тест-набор, проверяющий поведение через интерфейс (не через реализацию).
1. Для каждого агента — тест, что logic.ts работает с mock ports без участия Mastra.
1. Для API — schema-validation тесты: каждый response соответствует OpenAPI-схеме.
1. Для event bus — тест на shape публикуемых событий.

## 11.2. Conformance suite

Когда (если) будет писаться Elixir-реализация — те же contract tests должны проходить против неё. Поэтому contract tests формулируются абстрактно:

```
// packages/db/__contracts__/notes-repository.contract.ts
```

```
export function notesRepositoryContract(makeRepo: () => Promise<NotesRepository>) {
  describe('NotesRepository contract', () => {
    it('создаёт заметку с новым id', async () => {
      const repo = await makeRepo();
      const note = await repo.create({ ... }, { userId: testUser });
      expect(note.id).toBeDefined();
    });
```

```
    it('бросает ConflictError при baseVersion mismatch', async () => { ... });
    // ... остальные инварианты
  });
}
```

```
// Применяется к Drizzle-реализации:
notesRepositoryContract(() => new NotesRepositoryDrizzle(testDb));
```

```
// В будущем — к Ecto-реализации, экспортированной через RPC.
```

# 12. CI gates для соблюдения контрактов

Что проверяется автоматически на каждом PR (см. также документ 10 §10):

| **Gate** | **Что проверяет** |
| --- | --- |
| dependency-cruiser / madge | Граф зависимостей пакетов соответствует §10.1. Цикл или запрещённая зависимость — fail. |
| eslint:no-restricted-imports | logic.ts агентов не импортирует @mastra/*, @nestjs/*, drizzle-orm, fs, axios. Запрет на @supabase/* за пределами AuthPort-implementation. |
| openapi-diff | OpenAPI 3.1 спецификация не имеет breaking changes относительно main. Удаление поля/эндпоинта — только в /v2/. |
| zod-to-openapi validation | Все API endpoint definitions сопровождаются Zod-схемами, синхронизированными с OpenAPI. |
| contract test suite | Все *.contract.ts тесты проходят против всех реализаций. |
| agent-isolation check | logic.ts можно импортировать в Node-среде без @mastra/*. Запускается тест: импорт + вызов с mock ports без какого-либо runtime. |
| typed-events check | Все published события в event bus являются членами DomainEvent union. |
| forbidden-strings check | Запрет встроенных SQL/TQL строк в бизнес-логике (только через repositories). |

# 13. Playbook миграции backend (если/когда понадобится)

При материализации сценария multi-tenant scale (см. документ 14 §10.3), если решено мигрировать backend на Elixir/Phoenix — последовательность действий:

## 13.1. Подготовительный этап (1–2 месяца)

1. Аудит соблюдения контрактов: все ли agents соответствуют §3, все ли API — §7, все ли repositories — §5. Закрыть оставшиеся отклонения.
1. Расширение contract test suite до уровня полного покрытия инвариантов (это будет базис для верификации Elixir-реализации).
1. OpenAPI spec фиксируется как snapshot — это контракт для frontend.
1. Event schemas фиксируются как snapshot — это контракт для sync engine и Realtime каналов.

## 13.2. Этап proof-of-concept (1–2 месяца)

1. Поднимается параллельный nabu-api-elixir на Phoenix.
1. Реализуются: AuthPort, базовый NotesRepository, базовый AuditRepository, базовый EventBusPort.
1. Реализуются 2–3 простых эндпоинта (/v1/auth/*, /v1/notes/* CRUD).
1. Прогоняется contract test suite — должен пройти против Phoenix-реализации.
1. Прогоняется существующий frontend (Next.js) против Phoenix — все запросы идут с тем же контрактом, должен работать без правок.

## 13.3. Этап параллельной работы (2–4 месяца)

1. Реализуются оставшиеся репозитории, агентский runtime (минимальный), sync engine на Phoenix.
1. Параллельно работают nabu-api (TS) и nabu-api-elixir. Они оба пишут в одни и те же Postgres/TypeDB/S3.
1. На границе — feature-flag-роутер (на уровне load balancer): процент трафика идёт на Elixir.
1. Мониторинг сравнения: latency, error rate, eval-метрики агентов. Если Elixir-реализация деградирует — флаг откатывается.

## 13.4. Этап перехода (1 месяц)

1. 100% трафика на Elixir.
1. Старая TS-реализация в режиме standby — может быть включена обратно за минуты.
1. Через 30 дней стабильной работы — TS-реализация выводится из эксплуатации (но код остаётся в репозитории как референс).
Совокупно: 5–9 месяцев на миграцию backend без даунтайма и без переписывания клиентов. Это драматически меньше, чем 1.5–2 года, в которые бы вылилась миграция без соблюдения контрактов.

> Опция Д не предотвращает миграцию — она делает её механической задачей вместо архитектурной катастрофы. В этом её ценность.

# 14. Чек-лист соблюдения для AI-команды разработки

Перед merge каждого PR AI-агент проверяет:

- Логика агента — в logic.ts; agent.ts — тонкая обёртка ≤ 50 строк.
- logic.ts не импортирует Mastra, NestJS, Drizzle, Supabase, fs, axios.
- Все зависимости logic.ts — через AgentPorts параметр.
- Все БД-операции — через RepositoriesPort, не напрямую через Drizzle.
- Все S3-операции — через ObjectStorePort.
- Все типы id — branded (UserId, NoteId, ...).
- Все опубликованные events — типизированные DomainEvent.
- Любой новый API-эндпоинт сопровождается обновлением OpenAPI.
- Любая новая repository функция сопровождается её contract test.
- Любой новый агент сопровождается eval-набором (≥ 200 примеров — см. документ 10).
- ESLint, типы, dep-graph — зелёные.

# 15. Антипаттерны, которые нужно отлавливать в code review

1. «Просто использую Drizzle прямо здесь, это короче» — нет, через репозиторий.
1. «Mastra workflow проще» — workflow допустим только как тонкая обёртка над logic.ts.
1. «Это NestJS-специфичная инжекция, нельзя сделать иначе» — можно. Бизнес-логика принимает зависимости как простые параметры.
1. «Я расширил API, но не обновил OpenAPI — это просто временно» — нет, спецификация всегда синхронна с реализацией.
1. «У меня внутри агента fetch("https://...")» — нет, через LlmPort или HttpPort.
1. «Я использовал Mastra Memory, чтобы хранить состояние пользователя между вызовами» — нет, состояние пользователя в Postgres/TypeDB через репозитории.
1. «Я положил конфиг прямо в код для скорости» — нет, через ConfigSchema.

# 16. Заключение

Опция Д — это форма страховки. На стадии MVP она кажется избыточной (зачем абстракции, если будет только одна реализация?). На стадии scale она становится единственным способом мигрировать backend без переписывания всего.

Конкретно для траектории Nabu (цель — десятки тысяч платящих пользователей через 12–18 месяцев) — опция Д означает, что если backend станет узким местом и потребуется Elixir, миграция займёт 5–9 месяцев параллельной работы вместо 18–24 месяцев переписывания.

Цена соблюдения опции Д на этапе MVP — оценочно +10–15% к времени разработки (на дисциплину контрактов и contract tests). Это разумная страховая премия.
