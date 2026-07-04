// Типы и Zod-схемы памяти и Совета (контракты Option Д).
// Валидация на границе tools; бизнес-логика оперирует уже проверенными данными.

import { z } from "zod";

export const VisibilitySchema = z.enum(["default", "private", "vault"]);
export type Visibility = z.infer<typeof VisibilitySchema>;

export const MemoryTypeSchema = z.enum([
  "working",
  "episodic",
  "semantic",
  "procedural",
  "prospective",
  "autobiographical",
  "associative",
]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

// ── Записи памяти ──

export const EpisodeSchema = z.object({
  event: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  actors: z.array(z.string()).default([]),
  emotion: z.string().optional(),
  context: z.record(z.string(), z.unknown()).default({}),
  visibility: VisibilitySchema.default("private"),
});
export type Episode = z.infer<typeof EpisodeSchema>;

export const FactSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.8),
  source: z.string().optional(),
  visibility: VisibilitySchema.default("private"),
});
export type Fact = z.infer<typeof FactSchema>;

export const WorkingItemSchema = z.object({
  sessionId: z.string().min(1),
  content: z.string().min(1),
  meta: z.record(z.string(), z.unknown()).default({}),
});
export type WorkingItem = z.infer<typeof WorkingItemSchema>;

export const ProspectiveSchema = z.object({
  intent: z.string().min(1),
  triggerAt: z.string().datetime().optional(),
  triggerCond: z.record(z.string(), z.unknown()).optional(),
});
export type Prospective = z.infer<typeof ProspectiveSchema>;

export const ProcedureSchema = z.object({
  skill: z.string().min(1),
  steps: z.array(z.unknown()),
});
export type Procedure = z.infer<typeof ProcedureSchema>;

// ── Результаты поиска ──

export interface RecallHit {
  id: string;
  kind: MemoryType;
  text: string;
  score: number; // 0..1, косинусная близость (или 1.0 для recency-хитов)
  occurredAt?: string;
  visibility: Visibility;
  meta?: Record<string, unknown>;
}

// ── Позиция министра в Совете (ARCHITECTURE §4) ──

export const MinisterPositionSchema = z.object({
  minister: z.string(),
  recommendation: z.string(),
  rationale: z.string(),
  risks: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  dependsOn: z.array(z.string()).default([]),
});
export type MinisterPosition = z.infer<typeof MinisterPositionSchema>;

// Примечание: единый контракт результата MCP-tool — в mcp-result.ts (ok/degraded/fail/wrap).
// Прежний дублирующий ToolResult/ok/empty удалён (не использовался, затенял mcp-result.ok).
