// nabu-pipeline MCP server — индексация папок в базу знаний Совета.
// Сканирование/чтение/чанкинг/эмбеддинг/запись — ЛОКАЛЬНО (тяжёлое вне Claude; приватный
// контент не покидает машину). Узкие типизированные tools, структурированные результаты,
// бюджеты (лимиты файлов/размера) с логированием усечения.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, extname, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { buildDepsOrExit, installGracefulShutdown, ok, degraded, fail, wrap, type McpToolResult } from "@nabu/lib";

const deps = buildDepsOrExit("nabu-pipeline");
const server = new McpServer({ name: "nabu-pipeline", version: "1.4.0" });

const visibility = z.enum(["default", "private", "vault"]);
const TEXT_EXT = new Set([".md", ".markdown", ".txt", ".text"]);
// Локальное извлечение текста: pdftotext (poppler) для PDF, tesseract (OCR) для изображений.
const PDF_EXT = new Set([".pdf"]);
const OCR_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".tiff"]);
const BINARY_EXT = new Set([...PDF_EXT, ...OCR_EXT]); // требуют внешнего бинаря для извлечения
const INDEXABLE_EXT = new Set([...TEXT_EXT, ...BINARY_EXT]);
const MAX_FILES = 500;
const MAX_FILE_BYTES = 2_000_000;
// Сканы/изображения крупнее текста; отдельный порог, совпадает с maxBuffer вывода извлечения.
const MAX_BINARY_FILE_BYTES = 50_000_000;
const EXTRACT_MAX_BUFFER = 50 * 1024 * 1024;
const MAX_SKIPPED_REPORTED = 100; // не раздуваем payload на больших деревьях

/** Нормализация текста из PDF: убрать form-feed (\f) и схлопнуть >2 пустых строк. */
function cleanPdfText(s: string): string {
  return s.replace(/\f/g, "").replace(/\n{3,}/g, "\n\n");
}

/**
 * Локально извлечь текст из файла. .pdf → pdftotext -layout; изображения → tesseract OCR;
 * прочее → readFileSync(utf8). Отсутствие бинаря (ENOENT) или ненулевой код → error c честной
 * подсказкой по установке и пустой text (файл будет пропущен вызывающим). Текст не покидает машину.
 */
function extractText(file: string): { text: string; method: "plain" | "pdftotext" | "tesseract"; error?: string } {
  const ext = extname(file).toLowerCase();
  if (PDF_EXT.has(ext)) {
    const r = spawnSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: EXTRACT_MAX_BUFFER });
    if (r.error) {
      const enoent = (r.error as NodeJS.ErrnoException).code === "ENOENT";
      return { text: "", method: "pdftotext", error: enoent ? "pdftotext не найден — установите poppler(-utils)" : (r.error as Error).message };
    }
    if (r.status !== 0) return { text: "", method: "pdftotext", error: `pdftotext вышел с кодом ${r.status}: ${(r.stderr || "").trim()}` };
    return { text: cleanPdfText(r.stdout || ""), method: "pdftotext" };
  }
  if (OCR_EXT.has(ext)) {
    const langs = process.env.NABU_OCR_LANGS || "rus+eng";
    const r = spawnSync("tesseract", [file, "stdout", "-l", langs], { encoding: "utf8", maxBuffer: EXTRACT_MAX_BUFFER });
    if (r.error) {
      const enoent = (r.error as NodeJS.ErrnoException).code === "ENOENT";
      return { text: "", method: "tesseract", error: enoent ? "tesseract не найден — установите tesseract(-ocr) + языковые пакеты rus" : (r.error as Error).message };
    }
    if (r.status !== 0) return { text: "", method: "tesseract", error: `tesseract вышел с кодом ${r.status}: ${(r.stderr || "").trim()}` };
    return { text: r.stdout || "", method: "tesseract" };
  }
  return { text: readFileSync(file, "utf8"), method: "plain" };
}

const result = ok;
const reg = ((name: string, opts: unknown, h: (...a: unknown[]) => Promise<unknown>) =>
  server.registerTool(name as never, opts as never, ((...a: unknown[]) =>
    wrap(() => h(...a) as Promise<McpToolResult>)) as never)) as unknown as typeof server.registerTool;

/**
 * Разрешённые корни индексации (sandbox). По умолчанию — рабочий workspace $NABU_HOME и
 * домашняя папка пользователя (персональный режим). Переопределяются NABU_INDEX_ROOTS
 * (список через ":"). Не даём индексировать произвольные системные пути.
 */
function allowedRoots(): string[] {
  const roots = new Set<string>();
  const add = (p?: string): void => {
    if (!p) return;
    try {
      roots.add(realpathSync(resolve(p)));
    } catch {
      /* несуществующий корень игнорируем */
    }
  };
  const env = process.env.NABU_INDEX_ROOTS;
  if (env) for (const r of env.split(":")) add(r.trim());
  else {
    add(process.env.NABU_HOME);
    add(homedir());
  }
  return [...roots];
}

/** Проверить, что запрошенный путь — внутри разрешённого корня; вернуть его realpath. */
function assertAllowedRoot(input: string): string {
  let real: string;
  try {
    real = realpathSync(resolve(input));
  } catch {
    throw new Error(`Путь не существует или недоступен: ${input}`);
  }
  const roots = allowedRoots();
  const inside = roots.some((root) => real === root || real.startsWith(root + sep));
  if (!inside) {
    throw new Error(
      `Путь вне разрешённых корней индексации [${roots.join(", ") || "нет"}]. ` +
        `Задайте NABU_INDEX_ROOTS для расширения области.`,
    );
  }
  return real;
}

/**
 * Рекурсивно собрать текстовые файлы под root (с лимитами). Симлинки НЕ раскрываются
 * (устраняет циклы и выход за пределы sandbox); посещённые каталоги отслеживаются по realpath.
 */
function collectFiles(root: string): { files: string[]; skipped: string[]; truncated: boolean } {
  const files: string[] = [];
  const skipped: string[] = [];
  let skippedCount = 0;
  let truncated = false;
  const visited = new Set<string>();
  const note = (msg: string): void => {
    skippedCount++;
    if (skipped.length < MAX_SKIPPED_REPORTED) skipped.push(msg);
  };
  const walk = (dir: string): void => {
    if (files.length >= MAX_FILES) {
      truncated = true;
      return;
    }
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      return;
    }
    if (visited.has(real)) return; // защита от циклов
    visited.add(real);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      if (name.startsWith(".") || name === "node_modules") continue;
      const full = join(dir, name);
      let st;
      try {
        st = lstatSync(full); // lstat: не идём по симлинкам
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        note(`${full} (симлинк — пропущен)`);
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && INDEXABLE_EXT.has(extname(name).toLowerCase())) {
        const cap = BINARY_EXT.has(extname(name).toLowerCase()) ? MAX_BINARY_FILE_BYTES : MAX_FILE_BYTES;
        if (st.size > cap) {
          note(`${full} (>${cap}b)`);
          continue;
        }
        files.push(full);
      } else if (st.isFile()) {
        note(`${full} (формат не поддержан)`);
      }
    }
  };
  walk(root);
  if (skippedCount > skipped.length) skipped.push(`… ещё ${skippedCount - skipped.length} пропущено`);
  return { files, skipped, truncated };
}

reg(
  "scan_folder",
  {
    title: "Сканировать папку",
    description:
      "Рекурсивно перечислить индексируемые файлы (.md/.txt, а также .pdf и изображения .png/.jpg/.jpeg/.webp/.tiff) под path. Не читает содержимое. Лимит 500 файлов.",
    inputSchema: { path: z.string().min(1) },
    annotations: { readOnlyHint: true },
  },
  async ({ path }) => {
    const root = assertAllowedRoot(path);
    const { files, skipped, truncated } = collectFiles(root);
    const warnings = truncated ? [`Достигнут лимит ${MAX_FILES} файлов — список усечён`] : [];
    return result(`Найдено ${files.length} файлов (пропущено ${skipped.length})`, { files, skipped }, warnings);
  },
);

reg(
  "index_folder",
  {
    title: "Индексировать папку в базу знаний",
    description:
      "ЛОКАЛЬНО: сканирует path, извлекает текст (.md/.txt напрямую; .pdf через pdftotext; изображения .png/.jpg/.jpeg/.webp/.tiff через tesseract OCR), чанкует, считает эмбеддинги (Ollama) и пишет в базу знаний. Приватный контент не покидает машину. Локальная деградация: нет бинаря/пустое извлечение → файл пропускается с причиной, остальные индексируются. Идемпотентно по файлу.",
    inputSchema: {
      path: z.string().min(1),
      visibility: visibility.default("private"),
    },
  },
  async ({ path, visibility: vis }) => {
    const root = assertAllowedRoot(path);
    const { files, skipped: walkSkipped, truncated } = collectFiles(root);
    let chunksStored = 0;
    let filesIndexed = 0;
    const failed: string[] = [];
    const skipped: { file: string; reason: string }[] = []; // пропуски извлечения (нет бинаря/пусто)
    for (const file of files) {
      const source = relative(root, file) || file;
      const { text, method, error } = extractText(file);
      if (error) {
        skipped.push({ file: source, reason: error });
        console.error(`[nabu-index] ПРОПУСК ${source}: ${error}`);
        continue;
      }
      if (!text.trim()) {
        const reason =
          method === "tesseract" ? "пустой результат OCR" :
          method === "pdftotext" ? "PDF без текстового слоя (скан?) — установите tesseract для OCR" :
          "пустой файл";
        skipped.push({ file: source, reason });
        continue;
      }
      try {
        const n = await deps.knowledge.indexDocument(source, text, vis);
        chunksStored += n;
        filesIndexed++;
        console.error(`[nabu-index] ${source}: ${n} чанков (${method})`);
      } catch (err) {
        failed.push(`${file}: ${(err as Error).message}`);
      }
    }
    const warnings: string[] = [];
    if (truncated) warnings.push(`Список файлов усечён до ${MAX_FILES}`);
    if (walkSkipped.length) warnings.push(`Пропущено при обходе ${walkSkipped.length} (формат/размер/симлинк)`);
    if (skipped.length) {
      const head = skipped.slice(0, 5).map((s) => `${s.file} (${s.reason})`).join("; ");
      warnings.push(`Пропущено при извлечении ${skipped.length}: ${head}${skipped.length > 5 ? " …" : ""}`);
    }
    if (failed.length) warnings.push(`Ошибки индексации: ${failed.length}`);
    return result(
      `Проиндексировано ${filesIndexed} файлов, ${chunksStored} чанков (visibility=${vis}); пропущено ${skipped.length}`,
      { filesIndexed, chunksStored, skippedCount: skipped.length, skipped, walkSkipped, failed },
      warnings,
    );
  },
);

reg(
  "index_document",
  {
    title: "Индексировать документ (по содержимому)",
    description: "Проиндексировать один документ из переданного текста (когда файл недоступен серверу).",
    inputSchema: {
      source: z.string().min(1),
      text: z.string().min(1),
      visibility: visibility.default("private"),
    },
  },
  async ({ source, text, visibility: vis }) => {
    const n = await deps.knowledge.indexDocument(source, text, vis);
    return result(`Документ '${source}': ${n} чанков`, { source, chunks: n });
  },
);

reg(
  "search_knowledge",
  {
    title: "Поиск по базе знаний",
    description: "Семантический поиск по проиндексированным документам. Возвращает топ-K фрагментов с оценкой.",
    inputSchema: { query: z.string().min(1), topK: z.number().int().min(1).max(30).default(8) },
    annotations: { readOnlyHint: true },
  },
  async ({ query, topK }) => {
    const hits = await deps.knowledge.search(query, topK);
    return result(hits.length ? `Найдено ${hits.length} фрагментов` : "Ничего не найдено", { hits });
  },
);

reg(
  "list_notes",
  {
    title: "Список заметок",
    description:
      "Заметки пользователя по статусу (по умолчанию свежие 'fleeting') для конвейера разбора «Входящих». По возрастанию даты — сначала старые.",
    inputSchema: {
      status: z.string().default("fleeting"),
      limit: z.number().int().min(1).max(200).default(50),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ status, limit }) => {
    const notes = await deps.notes.list({ status, limit });
    return result(`Заметок (${status}): ${notes.length}`, { notes });
  },
);

reg(
  "update_note",
  {
    title: "Обновить заметку (триаж)",
    description:
      "Для конвейера разбора «Входящих» — триаж статуса/типа/доменов заметки. Обновляются только переданные поля. ВНИМАНИЕ: title хранится ПЛЕЙНТЕКСТОМ даже для vault-заметок — не переносить в него чувствительное содержимое.",
    inputSchema: {
      id: z.string().uuid(),
      status: z.string().optional(),
      type: z.string().optional(),
      domain: z.array(z.string()).optional(),
      title: z.string().optional(),
    },
  },
  async ({ id, status, type, domain, title }) => {
    const found = await deps.notes.update(id, { status, type, domain, title });
    // not-found = degraded (мягкая деградация), как у update_system_task — единая семантика.
    return found ? result("Заметка обновлена", { id }) : degraded("Заметка не найдена", { id });
  },
);

reg(
  "extract_entities_local",
  {
    title: "Извлечь сущности локально (private/vault)",
    description:
      "ЛОКАЛЬНАЯ экстракция сущностей/фактов малой моделью через Ollama — текст НЕ уходит в облако/Claude. " +
      "Для private/vault-контента: передайте noteId (сервер сам прочитает и расшифрует заметку; её текст " +
      "не попадёт в контекст) либо text. Модель: env NABU_LOCAL_LLM (по умолчанию qwen3:4b; ollama pull при отсутствии).",
    inputSchema: {
      text: z.string().min(1).max(20000).optional(),
      noteId: z.string().uuid().optional(),
    },
  },
  async ({ text, noteId }) => {
    let src = text ?? null;
    if (!src && noteId) {
      const getter = (deps.notes as unknown as { getContentDecrypted?: (id: string) => Promise<string | null> }).getContentDecrypted;
      if (typeof getter !== "function") return fail("getContentDecrypted недоступен — обновите сборку (npm run build)");
      src = await getter.call(deps.notes, noteId);
      if (!src) return fail("Заметка не найдена или пуста", { noteId });
    }
    if (!src) return fail("Передайте text или noteId");
    const base = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
    const model = process.env.NABU_LOCAL_LLM || "qwen3:4b";
    const prompt =
      "Извлеки из текста сущности и устойчивые факты о пользователе/мире. Ответь ТОЛЬКО валидным JSON вида " +
      '{"entities":[{"name":"...","type":"person|project|place|topic|org|other"}],' +
      '"facts":[{"subject":"...","predicate":"...","object":"..."}]} без пояснений.\n\nТекст:\n' + src;
    let res: Response;
    try {
      res = await fetch(`${base}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // think:false — thinking-модели (qwen3.5 и т.п.) иначе кладут вывод в поле thinking.
        body: JSON.stringify({ model, prompt, stream: false, format: "json", think: false, options: { temperature: 0 } }),
        signal: AbortSignal.timeout(Number(process.env.NABU_LOCAL_LLM_TIMEOUT_MS ?? 300_000)),
      });
    } catch (e) {
      return fail(`Ollama недоступен/таймаут: ${(e as Error).message}`);
    }
    if (!res.ok) return fail(`Ollama generate ${res.status} — модель '${model}' установлена? (ollama pull ${model})`);
    const j = (await res.json()) as { response?: string; thinking?: string };
    let parsed: { entities?: unknown[]; facts?: unknown[] };
    try {
      // fallback на thinking: старые версии Ollama игнорируют think:false у thinking-моделей
      parsed = JSON.parse(j.response || j.thinking || "");
    } catch {
      return fail(`Модель '${model}' вернула не-JSON — попробуйте другую (env NABU_LOCAL_LLM)`);
    }
    const entities = Array.isArray(parsed.entities) ? parsed.entities.slice(0, 50) : [];
    const facts = Array.isArray(parsed.facts) ? parsed.facts.slice(0, 50) : [];
    return result(
      `Локально извлечено: ${entities.length} сущностей, ${facts.length} фактов (модель ${model}${noteId ? ", текст не попадал в контекст" : ""})`,
      { entities, facts, model },
    );
  },
);

reg(
  "knowledge_stats",
  {
    title: "Статистика базы знаний",
    description: "Сколько документов и чанков проиндексировано в текущем namespace.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const s = await deps.knowledge.stats();
    return result(`Документов: ${s.documents}, чанков: ${s.chunks}`, s);
  },
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  installGracefulShutdown(deps);
  console.error("nabu-pipeline MCP server готов (stdio)");
}

main().catch((err) => {
  console.error("nabu-pipeline fatal:", err);
  process.exit(1);
});
