// folder-index.ts — обход папки + локальное извлечение текста + индексация в базу знаний с
// колбэком прогресса. Общий для CLI (`nabu index`) и Telegram (загрузка ZIP → фон + прогресс).
// Тяжёлое (чтение/pdftotext/эмбеддинги) — локально; текст не покидает машину.

import { readdirSync, statSync, readFileSync, realpathSync } from "node:fs";
import { join, extname, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import type { KnowledgeRepository, KnowledgeKind } from "./repositories/knowledge.js";
import type { Visibility } from "./types.js";

const TEXT_EXT = new Set([".md", ".markdown", ".txt", ".text", ".rst", ".org", ".csv", ".json", ".yaml", ".yml"]);
const PDF_EXT = new Set([".pdf"]);
const DOC_EXT = new Set([".docx", ".odt", ".rtf", ".epub"]); // офисные форматы через pandoc/unzip
const INDEXABLE = new Set([...TEXT_EXT, ...PDF_EXT, ...DOC_EXT]);
const MAX_FILES = Number(process.env.NABU_INDEX_MAX_FILES) || 5000;
const MAX_FILE_BYTES = Number(process.env.NABU_INDEX_MAX_FILE_BYTES) || 5_000_000;

export interface IndexProgress { done: number; total: number; file: string; chunks: number; skipped: number; }
export interface FolderIndexResult { files: number; chunks: number; skipped: number; truncated: boolean; }

/** Рекурсивно собрать индексируемые файлы (лимит MAX_FILES; skip симлинки/скрытые/бинарь). */
function collectFiles(root: string): { files: string[]; skipped: number; truncated: boolean } {
  const files: string[] = [];
  let skipped = 0, truncated = false;
  const walk = (dir: string): void => {
    if (files.length >= MAX_FILES) { truncated = true; return; }
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      if (name.startsWith(".") || name === "node_modules") continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; } // не идём по битым/симлинкам
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) {
        if (!INDEXABLE.has(extname(name).toLowerCase())) { continue; }
        if (st.size > MAX_FILE_BYTES) { skipped++; continue; }
        files.push(full);
      }
    }
  };
  walk(root);
  return { files, skipped, truncated };
}

/** Локально извлечь текст: pdf → pdftotext; docx/odt/rtf/epub → pandoc (или unzip для docx);
 *  прочее → utf8. Всё локально, текст не покидает машину. Пустой текст → пропуск. */
export function extractFileText(file: string): string {
  const ext = extname(file).toLowerCase();
  if (PDF_EXT.has(ext)) {
    const r = spawnSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    return r.error || r.status !== 0 ? "" : (r.stdout || "").replace(/\f/g, "").replace(/\n{3,}/g, "\n\n");
  }
  if (DOC_EXT.has(ext)) {
    // pandoc — лучший вариант (docx/odt/rtf/epub). Fallback для docx: unzip word/document.xml + strip.
    const p = spawnSync("pandoc", [file, "-t", "plain", "--wrap=none"], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    if (!p.error && p.status === 0 && (p.stdout || "").trim()) return p.stdout.replace(/\n{3,}/g, "\n\n");
    if (ext === ".docx") {
      const u = spawnSync("unzip", ["-p", file, "word/document.xml"], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
      if (!u.error && u.status === 0 && u.stdout) {
        return u.stdout
          .replace(/<w:p[ >]/g, "\n<w:p ").replace(/<\/w:p>/g, "\n") // абзацы → переводы строк
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/\n{3,}/g, "\n\n").trim();
      }
    }
    return ""; // не смогли извлечь — пропуск (с честным skip в вызывающем)
  }
  try { return readFileSync(file, "utf8"); } catch { return ""; }
}

/**
 * Проиндексировать папку в базу знаний с прогрессом. onProgress зовётся после каждого файла.
 * kind='personal' (заметки о пользователе) или 'library' (справочные источники) + domain.
 */
export async function indexFolder(
  knowledge: KnowledgeRepository,
  root: string,
  opts: { onProgress?: (p: IndexProgress) => void; kind?: KnowledgeKind; domain?: string; visibility?: Visibility; signal?: AbortSignal } = {},
): Promise<FolderIndexResult> {
  const abs = realpathSync(resolve(root));
  const { files, skipped: walkSkipped, truncated } = collectFiles(abs);
  let done = 0, chunks = 0, skipped = walkSkipped;
  for (const file of files) {
    if (opts.signal?.aborted) break;
    const text = extractFileText(file);
    if (text.trim()) {
      try {
        chunks += await knowledge.indexDocument(file, text, {
          kind: opts.kind ?? "personal", visibility: opts.visibility, domain: opts.domain, title: file.slice(abs.length + 1) || file, origin: file,
        });
      } catch { skipped++; }
    } else { skipped++; }
    done++;
    opts.onProgress?.({ done, total: files.length, file, chunks, skipped });
  }
  return { files: files.length, chunks, skipped, truncated };
}

/** Разрешённые корни (sandbox): NABU_HOME + home, или NABU_INDEX_ROOTS. Как в pipeline-server. */
export function isUnderAllowedRoot(input: string): boolean {
  const roots: string[] = [];
  const env = process.env.NABU_INDEX_ROOTS;
  const add = (p?: string): void => { if (p) { try { roots.push(realpathSync(resolve(p))); } catch { /* */ } } };
  if (env) for (const r of env.split(":")) add(r.trim());
  else { add(process.env.NABU_HOME); add(process.env.HOME || process.env.USERPROFILE); }
  let real: string;
  try { real = realpathSync(resolve(input)); } catch { return false; }
  return roots.some((r) => real === r || real.startsWith(r + sep));
}
