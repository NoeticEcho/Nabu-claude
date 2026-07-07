// sitegen.ts — встроенный лёгкий генератор статических сайтов (OlimpOS P6). Markdown → HTML без
// внешних зависимостей (надёжно на слабом хосте; Astro/JAMstack — опционально через песочницу позже).
// Источник — папка .md проекта; результат — статический сайт (index + страницы + навигация + тема).

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join, extname, basename, resolve } from "node:path";

/** Экранирование HTML. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Минимальный, но достаточный Markdown→HTML: заголовки, списки, код, цитаты, жирный/курсив,
 *  ссылки, инлайн-код, абзацы. Экранирует HTML в тексте (безопасно для пользовательского контента). */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inCode = false, codeLang = "", para: string[] = [], listType: "ul" | "ol" | null = null;
  const inline = (t: string): string =>
    esc(t)
      .replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join(" ")}</p>`); para = []; } };
  const flushList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  for (const raw of lines) {
    const line = raw;
    if (/^```/.test(line)) {
      if (inCode) { out.push("</code></pre>"); inCode = false; }
      else { flushPara(); flushList(); inCode = true; codeLang = line.slice(3).trim(); out.push(`<pre><code data-lang="${esc(codeLang)}">`); }
      continue;
    }
    if (inCode) { out.push(esc(line)); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const lvl = h[1]!.length; flushPara(); flushList(); out.push(`<h${lvl}>${inline(h[2]!)}</h${lvl}>`); continue; }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const want = ul ? "ul" : "ol";
      if (listType !== want) { flushList(); out.push(`<${want}>`); listType = want; }
      out.push(`<li>${inline((ul ? ul[1]! : ol![1]!))}</li>`);
      continue;
    }
    const q = line.match(/^>\s?(.*)$/);
    if (q) { flushPara(); flushList(); out.push(`<blockquote>${inline(q[1]!)}</blockquote>`); continue; }
    if (line.trim() === "") { flushPara(); flushList(); continue; }
    para.push(line);
  }
  if (inCode) out.push("</code></pre>");
  flushPara(); flushList();
  return out.join("\n");
}

const PAGE = (title: string, body: string, nav: string): string => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light dark}
body{max-width:760px;margin:0 auto;padding:24px 18px;font:16px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
nav{display:flex;flex-wrap:wrap;gap:10px;padding-bottom:14px;margin-bottom:18px;border-bottom:1px solid #8884}
nav a{text-decoration:none;color:#4f8cff}
h1,h2,h3{line-height:1.25}
pre{background:#8881;padding:12px;border-radius:8px;overflow:auto}
code{background:#8881;padding:1px 5px;border-radius:4px}
pre code{background:none;padding:0}
blockquote{margin:0;padding:2px 14px;border-left:3px solid #4f8cff;opacity:.85}
img{max-width:100%}
footer{margin-top:40px;padding-top:14px;border-top:1px solid #8884;font-size:13px;opacity:.6}
</style></head><body>
<nav>${nav}</nav>
<main>${body}</main>
<footer>Сгенерировано Nabu · OlimpOS</footer>
</body></html>`;

export interface SiteResult { pages: number; outDir: string; }

/**
 * Сгенерировать статический сайт: все .md из srcDir → HTML в outDir, с навигацией. Файл `index.md`
 * (или первый по алфавиту) становится index.html. Прочие ассеты (png/jpg/svg/css) копируются.
 */
export function generateSite(srcDir: string, outDir: string, opts: { title?: string } = {}): SiteResult {
  if (!existsSync(srcDir)) throw new Error(`нет папки источника: ${srcDir}`);
  mkdirSync(outDir, { recursive: true });
  const entries = readdirSync(srcDir).filter((f) => !f.startsWith("."));
  const mdFiles = entries.filter((f) => extname(f).toLowerCase() === ".md").sort((a, b) =>
    (a.toLowerCase() === "index.md" ? -1 : b.toLowerCase() === "index.md" ? 1 : a.localeCompare(b)));
  const siteTitle = opts.title || "Nabu Space";
  // навигация
  const navItems = mdFiles.map((f) => {
    const name = basename(f, ".md");
    const href = name.toLowerCase() === "index" ? "index.html" : `${name}.html`;
    const label = name.toLowerCase() === "index" ? "Главная" : name.replace(/[-_]/g, " ");
    return `<a href="${esc(href)}">${esc(label)}</a>`;
  }).join("");
  let pages = 0;
  for (const f of mdFiles) {
    const md = readFileSync(join(srcDir, f), "utf8");
    const name = basename(f, ".md");
    const outName = name.toLowerCase() === "index" ? "index.html" : `${name}.html`;
    const h1 = (md.match(/^#\s+(.*)$/m)?.[1]) || name;
    writeFileSync(join(outDir, outName), PAGE(`${h1} — ${siteTitle}`, renderMarkdown(md), navItems));
    pages++;
  }
  // если нет index.md — сделать index.html из первого файла
  if (mdFiles.length && !mdFiles.some((f) => f.toLowerCase() === "index.md")) {
    const first = basename(mdFiles[0]!, ".md");
    copyFileSync(join(outDir, `${first}.html`), join(outDir, "index.html"));
  }
  // копировать ассеты
  for (const f of entries) {
    if ([".png", ".jpg", ".jpeg", ".svg", ".gif", ".css", ".webp"].includes(extname(f).toLowerCase())) {
      try { copyFileSync(join(srcDir, f), join(outDir, f)); } catch { /* */ }
    }
  }
  return { pages, outDir };
}

/** Безопасное разрешение пути внутри корня сайтов (анти-traversal для сервинга /s/<slug>/<path>). */
export function resolveSitePath(siteRoot: string, slug: string, relPath: string): string | null {
  const safeSlug = String(slug).replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeSlug) return null;
  const base = resolve(siteRoot, safeSlug);
  const target = resolve(base, "." + (relPath.startsWith("/") ? relPath : "/" + relPath));
  const rel = relPath === "" || relPath === "/" ? "index.html" : relPath.replace(/^\//, "");
  const full = resolve(base, rel);
  return (full === base || full.startsWith(base + "/")) ? full : null;
}
