// Конфигурация Nabu-claude: читает переменные окружения (.env через node --env-file)
// и config/nabu.config.json. Единая точка правды для подключений и политик.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// lib/dist/config.js -> корень репозитория на два уровня выше
const REPO_ROOT = resolve(__dirname, "..", "..");

import type { Visibility } from "./types.js";

export interface NabuConfig {
  namespace: string;
  sharedDbWithMainNabu: boolean;
  embedding: { provider: string; model: string; dimension: number; privateOnly: boolean };
  privacy: {
    defaultVisibility: Visibility;
    privateLocalOnly: boolean;
    neverLogContent: boolean;
    highRiskDomainsPrivate: string[];
  };
  council: {
    conveneOnDomainsGte: number;
    maxMinistersPerQuery: number;
    alwaysCriticHighRisk: boolean;
    deliberationBudgetSteps: number;
  };
  memory: { workingTtlHours: number; retrievalTopK: number; consolidationMinEpisodes: number };
  features: Record<string, unknown>;
}

export interface Env {
  databaseUrl: string;
  ollamaBaseUrl: string;
  ollamaEmbedModel: string;
  typedb: { url: string; database: string; username: string; password: string };
  namespace: string;
  userId: string | undefined; // владелец в общей многопользовательской БД (NABU_USER_ID)
  logLevel: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Отсутствует обязательная переменная окружения: ${name}`);
  return v;
}

let envHydrated = false;

/**
 * Подхватывает REPO_ROOT/.env в process.env (только ключи, которых ещё нет).
 * Нужно, чтобы MCP-серверы, запускаемые Claude Code, получали креды даже без
 * `node --env-file`. Не перезаписывает уже заданные переменные окружения.
 */
function hydrateEnvFromFile(): void {
  if (envHydrated) return;
  envHydrated = true;
  const envPath = resolve(REPO_ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

/** Публично: подхватить .env в process.env без конструирования зависимостей/пула. */
export function hydrateEnv(): void {
  hydrateEnvFromFile();
}

export function loadEnv(): Env {
  hydrateEnvFromFile();
  return {
    databaseUrl: requireEnv("DATABASE_URL"),
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    ollamaEmbedModel: process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text-v2-moe:latest",
    typedb: {
      url: process.env.TYPEDB_URL ?? "",
      database: process.env.TYPEDB_DATABASE ?? "nabu_dev",
      username: process.env.TYPEDB_USERNAME ?? "admin",
      password: process.env.TYPEDB_PASSWORD ?? "",
    },
    namespace: process.env.NABU_NAMESPACE ?? "default",
    userId: process.env.NABU_USER_ID || undefined,
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
}

let cachedConfig: NabuConfig | undefined;

export function loadConfig(): NabuConfig {
  if (cachedConfig) return cachedConfig;
  const raw = JSON.parse(readFileSync(resolve(REPO_ROOT, "config", "nabu.config.json"), "utf8"));
  cachedConfig = {
    namespace: raw.namespace ?? "default",
    sharedDbWithMainNabu: raw.shared_db_with_main_nabu ?? true,
    embedding: {
      provider: raw.models?.embedding?.provider ?? "ollama",
      model: raw.models?.embedding?.model ?? "nomic-embed-text",
      dimension: raw.models?.embedding?.dimension ?? 768,
      privateOnly: raw.models?.embedding?.private_only ?? true,
    },
    privacy: {
      defaultVisibility: (raw.privacy?.default_visibility ?? "private") as Visibility,
      privateLocalOnly: raw.privacy?.private_local_only ?? true,
      neverLogContent: raw.privacy?.never_log_content ?? true,
      highRiskDomainsPrivate: raw.privacy?.high_risk_domains_private ?? [],
    },
    council: {
      conveneOnDomainsGte: raw.council?.convene_on_domains_gte ?? 2,
      maxMinistersPerQuery: raw.council?.max_ministers_per_query ?? 5,
      alwaysCriticHighRisk: raw.council?.always_critic_high_risk ?? true,
      deliberationBudgetSteps: raw.council?.deliberation_budget_steps ?? 30,
    },
    memory: {
      workingTtlHours: raw.memory?.working_ttl_hours ?? 24,
      retrievalTopK: raw.memory?.retrieval_top_k ?? 12,
      consolidationMinEpisodes: raw.memory?.consolidation_min_episodes ?? 20,
    },
    features: raw.features ?? {},
  };
  return cachedConfig;
}

export const REPO_ROOT_PATH = REPO_ROOT;
