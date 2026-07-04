// nabu-voice MCP server — опциональная, НЕблокирующая транскрипция голоса.
// Тяжёлая операция (Whisper) выполняется ЛОКАЛЬНО через python-воркер scripts/transcribe.py —
// аудио не уходит в облако/Claude. При отсутствии faster-whisper сервер деградирует изящно:
// возвращает status=degraded с инструкцией установки, НЕ падает и НЕ блокирует систему.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { hydrateEnv, REPO_ROOT_PATH, ok, degraded, fail } from "@nabu/lib";

hydrateEnv(); // подхватить .env (WHISPER_MODEL и т.д.) без PG-пула — voice не трогает БД
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "large-v3";
const WORKER = join(REPO_ROOT_PATH, "scripts", "transcribe.py");

const server = new McpServer({ name: "nabu-voice", version: "1.4.0" });

// Единый контракт результата — из @nabu/lib. Адаптер к явному status у voice.
function result(status: "ok" | "degraded" | "error", summary: string, data: unknown, warnings: string[] = []) {
  if (status === "degraded") return degraded(summary, data, warnings);
  if (status === "error") return fail(summary, data, warnings);
  return ok(summary, data, warnings);
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT_PATH });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

server.registerTool(
  "voice_status",
  {
    title: "Статус голосового движка",
    description: "Проверить, доступен ли локальный движок транскрипции (python3 + faster-whisper).",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const check = await run("python3", ["-c", "import faster_whisper; print('ok')"], 15000);
    const available = check.code === 0 && check.stdout.includes("ok");
    if (!available) {
      return result("degraded", "Транскрипция недоступна: нет python3/faster-whisper", { available: false }, [
        "Установите: pip install faster-whisper",
      ]);
    }
    return result("ok", `Готов (модель ${WHISPER_MODEL})`, { available: true, model: WHISPER_MODEL });
  },
);

server.registerTool(
  "transcribe",
  {
    title: "Транскрибировать аудио (локально)",
    description:
      "Локальная транскрипция аудиофайла (Whisper) — аудио не покидает машину. Неблокирующая опция. Возвращает текст. Если движок недоступен — status=degraded с инструкцией, без падения.",
    inputSchema: {
      audioPath: z.string().min(1).describe("Абсолютный путь к аудиофайлу"),
      language: z.string().default("auto").describe("Код языка или 'auto'"),
    },
  },
  async ({ audioPath, language }) => {
    if (!existsSync(WORKER)) {
      return result("error", "Воркер транскрипции не найден", { audioPath }, [`Нет файла ${WORKER}`]);
    }
    if (!existsSync(audioPath)) {
      return result("error", "Аудиофайл не найден", { audioPath });
    }
    const out = await run("python3", [WORKER, audioPath, WHISPER_MODEL, language], 600_000);
    let parsed: { ok?: boolean; text?: string; language?: string; error?: string; hint?: string } = {};
    try {
      parsed = JSON.parse(out.stdout.trim().split("\n").pop() ?? "{}");
    } catch {
      return result("error", "Не удалось разобрать ответ воркера", { stderr: out.stderr.slice(0, 500) });
    }
    if (!parsed.ok) {
      const warnings = parsed.hint ? [parsed.hint] : [];
      return result("degraded", `Транскрипция не выполнена: ${parsed.error ?? "unknown"}`, { audioPath }, warnings);
    }
    return result("ok", `Транскрибировано (${parsed.language})`, {
      text: parsed.text,
      language: parsed.language,
    });
  },
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  console.error("nabu-voice MCP server готов (stdio)");
}

main().catch((err) => {
  console.error("nabu-voice fatal:", err);
  process.exit(1);
});
