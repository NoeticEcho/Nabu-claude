// Публичный API @nabu/lib — импортируется MCP-серверами и батч-скриптами.

export * from "./folder-index.js";
export * from "./domain-classify.js";
export * from "./tenancy.js";
export * from "./registry.js";
export * from "./config.js";
export * from "./types.js";
export * from "./ports.js";
export { Embedder, toVectorLiteral } from "./embeddings.js";
export { encryptVault, decryptVault, isVaultCiphertext, tryDecrypt } from "./vault-crypto.js";
export { Postgres } from "./db/postgres.js";
export type { Tx } from "./db/postgres.js";
export { GraphClient, normalizeBaseUrl, tqlString } from "./db/typedb.js";
export { MemoryRepository } from "./repositories/memory.js";
export { GraphRepository } from "./repositories/graph.js";
export { KnowledgeRepository, chunkText } from "./repositories/knowledge.js";
export { DeliberationRepository } from "./repositories/deliberation.js";
export type { DeliberationRecord } from "./repositories/deliberation.js";
export { GovernanceRepository } from "./repositories/governance.js";
export type { RiskClass, ApprovalRequest } from "./repositories/governance.js";
export { AnalyticsRepository } from "./repositories/analytics.js";
export type { SeriesInfo } from "./repositories/analytics.js";
export * as stats from "./stats.js";
export { ok, degraded, fail, wrap } from "./mcp-result.js";
export type { McpToolResult } from "./mcp-result.js";
export { PersonalityRepository } from "./repositories/personality.js";
export { renderTraits, renderSalient, renderPersonalityBlock, applyGuardrails, ETHICAL_INVARIANTS } from "./personality.js";
export type { Traits } from "./personality.js";
export { DomainRepository } from "./repositories/domain.js";
export type { XpAward } from "./repositories/domain.js";
export {
  XP_ATTRS,
  attrLevel,
  overallLevel,
  xpToNext,
  domainToAttribute,
  taskXp,
  characterSummary,
  ATTR_DIVISOR,
  OVERALL_DIVISOR,
  ONTIME_BONUS,
  HABIT_DISCIPLINE_XP,
  HABIT_DOMAIN_XP,
  GOAL_XP,
  HABIT_MISS_PENALTY,
  QUALITATIVE_CAP,
} from "./rpg.js";
export type { XpAttr, LevelFormula, AttrSummary, CharacterSummary, CharacterSheetRow } from "./rpg.js";
export { NotesRepository } from "./repositories/notes.js";
export type { Note } from "./repositories/notes.js";
export { SystemTaskRepository } from "./repositories/system-task.js";
export type { SystemTask, SystemTaskKind, SystemTaskStatus } from "./repositories/system-task.js";
export { ImprovementRepository } from "./repositories/improvement.js";
export type { Proposal, TargetKind, ProposalCategory, ProposalStatus, EffectivenessPoint } from "./repositories/improvement.js";
export { RecommendationRepository } from "./repositories/recommendation.js";
export type { Recommendation, RecommendationStatus } from "./repositories/recommendation.js";
export { ConsultRepository } from "./repositories/consult.js";
export type { Consult, ConsultStatus } from "./repositories/consult.js";
export { DashboardRepository } from "./repositories/dashboard.js";
export type { DashboardOverview } from "./repositories/dashboard.js";
export {
  HealthImportRepository,
  parseAppleHealth,
  parseAppleHealthStats,
  parseGoogleFitDaily,
  parseGenericCsv,
  parseCsvLine,
  normalizeAppleDate,
  detectFormat,
} from "./health-import.js";
export type { HealthPoint } from "./health-import.js";
export {
  FinanceImportRepository,
  parseBankCsv,
  parseCsvLine as parseFinanceCsvLine,
  parseAmount,
  normalizeDate as normalizeFinanceDate,
  categorize,
  CATEGORIES,
} from "./finance-import.js";
export type { FinanceTx, FinanceSummary, ImportResult } from "./finance-import.js";
export { parseIcs, loadCalendars } from "./ics.js";
export type { CalEvent, IcsOptions } from "./ics.js";

import { loadEnv, loadConfig } from "./config.js";
import { Embedder } from "./embeddings.js";
import { Postgres } from "./db/postgres.js";
import { GraphClient } from "./db/typedb.js";
import { MemoryRepository } from "./repositories/memory.js";
import { GraphRepository } from "./repositories/graph.js";
import { KnowledgeRepository } from "./repositories/knowledge.js";
import { DeliberationRepository } from "./repositories/deliberation.js";
import { GovernanceRepository } from "./repositories/governance.js";
import { AnalyticsRepository } from "./repositories/analytics.js";
import { PersonalityRepository } from "./repositories/personality.js";
import { DomainRepository } from "./repositories/domain.js";
import { NotesRepository } from "./repositories/notes.js";
import { SystemTaskRepository } from "./repositories/system-task.js";
import { ImprovementRepository } from "./repositories/improvement.js";
import { RecommendationRepository } from "./repositories/recommendation.js";
import { ConsultRepository } from "./repositories/consult.js";
import { DashboardRepository } from "./repositories/dashboard.js";
import { HealthImportRepository } from "./health-import.js";
import { FinanceImportRepository } from "./finance-import.js";

/** Собранный набор зависимостей для серверов (композиционный корень). */
export interface NabuDeps {
  pg: Postgres;
  embedder: Embedder;
  graph: GraphRepository;
  graphClient: GraphClient;
  memory: MemoryRepository;
  knowledge: KnowledgeRepository;
  deliberation: DeliberationRepository;
  governance: GovernanceRepository;
  analytics: AnalyticsRepository;
  personality: PersonalityRepository;
  domain: DomainRepository;
  notes: NotesRepository;
  systemTask: SystemTaskRepository;
  improvement: ImprovementRepository;
  recommendation: RecommendationRepository;
  consult: ConsultRepository;
  dashboard: DashboardRepository;
  healthImport: HealthImportRepository;
  financeImport: FinanceImportRepository;
  namespace: string;
}

/**
 * overrides — мульти-профиль v2: собрать deps для другого пространства (namespace/userId),
 * не трогая process.env (веб-чат держит per-profile кэши deps параллельно).
 */
export function buildDeps(overrides: { namespace?: string; userId?: string } = {}): NabuDeps {
  // Изоляция профиля — ДВУХОСЕВАЯ (namespace для памяти/совещаний, userId для домена/финансов/
  // здоровья). Половинчатый override = межпрофильная утечка (r3-C3) — отказываем fail-closed.
  if (!!overrides.namespace !== !!overrides.userId) {
    throw new Error(
      "Профиль обязан задавать И namespace, И user_id (иначе часть данных утечёт в основное пространство). " +
      "Создайте корректный профиль: nabu profiles add <имя>",
    );
  }
  const env = { ...loadEnv(), ...(overrides.namespace ? { namespace: overrides.namespace } : {}), ...(overrides.userId ? { userId: overrides.userId } : {}) };
  const config = loadConfig();
  const pg = Postgres.fromEnv(env);
  const embedder = Embedder.fromEnv(env, config.embedding.dimension);
  const graphClient = GraphClient.fromEnv(env);
  const graph = new GraphRepository(graphClient);
  const memory = new MemoryRepository(pg, embedder, env.namespace, {
    workingTtlHours: config.memory.workingTtlHours,
    retrievalTopK: config.memory.retrievalTopK,
  });
  const knowledge = new KnowledgeRepository(pg, embedder, env.namespace);
  const deliberation = new DeliberationRepository(pg, env.namespace);
  const governance = new GovernanceRepository(pg, env.namespace);
  const analytics = new AnalyticsRepository(pg, env.userId);
  const personality = new PersonalityRepository(pg, env.namespace);
  const domain = new DomainRepository(pg, env.userId);
  const notes = new NotesRepository(pg, env.userId);
  const systemTask = new SystemTaskRepository(pg, env.namespace);
  const improvement = new ImprovementRepository(pg, env.namespace);
  const recommendation = new RecommendationRepository(pg, env.namespace);
  const consult = new ConsultRepository(pg, env.namespace);
  const dashboard = new DashboardRepository(pg, graphClient, env.namespace, env.userId);
  const healthImport = new HealthImportRepository(pg, env.userId);
  const financeImport = new FinanceImportRepository(pg, env.userId);
  return { pg, embedder, graph, graphClient, memory, knowledge, deliberation, governance, analytics, personality, domain, notes, systemTask, improvement, recommendation, consult, dashboard, healthImport, financeImport, namespace: env.namespace };
}

/**
 * Как buildDeps, но при ошибке конфигурации (нет DATABASE_URL / нечитаемый config) печатает
 * внятное сообщение в stderr и завершает процесс с кодом 1 — вместо сырого стека до старта сервера.
 */
/**
 * Зарегистрировать корректное завершение: на SIGINT/SIGTERM закрыть graph-клиент и pg-пул,
 * затем выйти. Иначе соединения к локальной Postgres висят до таймаута пула (делят лимит с основным Nabu).
 */
export function installGracefulShutdown(deps: Pick<NabuDeps, "pg" | "graphClient">): void {
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    try {
      await deps.graphClient.close();
    } catch {
      /* ignore */
    }
    try {
      await deps.pg.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

export function buildDepsOrExit(serverName: string): NabuDeps {
  try {
    return buildDeps();
  } catch (e) {
    process.stderr.write(
      `[${serverName}] Не удалось инициализировать зависимости: ${(e as Error).message}\n` +
        `Проверьте .env (DATABASE_URL и пр.) и config/nabu.config.json. Сервер не запущен.\n`,
    );
    process.exit(1);
  }
}
