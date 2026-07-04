// Порты (контракты Option Д). Бизнес-логика и MCP-серверы зависят от интерфейсов,
// а не от конкретных Postgres/TypeDB/Ollama. Реализации — в repositories/*.

import type {
  Episode,
  Fact,
  Prospective,
  Procedure,
  WorkingItem,
  RecallHit,
  Visibility,
} from "./types.js";

export interface RecallQuery {
  query: string;
  topK?: number;
  kinds?: Array<"episodic" | "semantic" | "autobiographical">;
  visibility?: Visibility[]; // фильтр по уровню приватности (по умолчанию все локальные)
}

export interface MemoryPort {
  rememberEpisode(e: Episode): Promise<{ id: string }>;
  addFact(f: Fact): Promise<{ id: string }>;
  setWorking(w: WorkingItem): Promise<{ id: string }>;
  getWorking(sessionId: string): Promise<Array<{ id: string; content: string }>>;
  addProspective(p: Prospective): Promise<{ id: string }>;
  listProspective(): Promise<Array<{ id: string; intent: string; triggerAt?: string }>>;
  addProcedure(p: Procedure): Promise<{ id: string }>;
  recall(q: RecallQuery): Promise<RecallHit[]>;
  listRecentEpisodes(
    limit?: number,
    sinceDays?: number,
  ): Promise<Array<{ id: string; event: string; occurredAt: string; emotion?: string; visibility: string }>>;
  saveNarrative(period: string, narrative: string): Promise<{ id: string }>;
  countEpisodes(sinceDays?: number): Promise<number>;
  /** Явное чтение vault-записей (расшифровка локальным ключом; вызывать по прямой просьбе пользователя). */
  listVaultRecent(limit?: number): Promise<Array<{ kind: "episodic" | "semantic"; text: string; occurredAt?: string }>>;
}

export interface GraphPort {
  available(): Promise<boolean>;
  upsertConcept(name: string, opts?: { entityType?: string; externalId?: string; visibility?: Visibility }): Promise<void>;
  relateConcepts(from: string, to: string, kind: string, weight?: number): Promise<void>;
  neighbors(name: string, limit?: number): Promise<string[]>;
}
