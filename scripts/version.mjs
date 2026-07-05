#!/usr/bin/env node
// scripts/version.mjs — единая точка версионирования Nabu (см. VERSIONING.md).
// Раньше версия правилась вручную в ~8 файлах → дрейф. Здесь: показать/предложить/применить bump.
//   node scripts/version.mjs               показать текущую + предложение по коммитам
//   node scripts/version.mjs patch|minor|major   применить bump во всех файлах
//   node scripts/version.mjs auto          bump по conventional-commits с последнего тега

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const R = (p) => join(ROOT, p);

function sh(cmd) { try { return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return ""; } }

const current = JSON.parse(readFileSync(R("package.json"), "utf8")).version;
const [maj, min, pat] = current.split(".").map(Number);

// Классификация коммитов с последнего тега (conventional commits).
function suggestFromCommits() {
  const lastTag = sh("git describe --tags --abbrev=0") || "";
  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
  const log = sh(`git log ${range} --pretty=format:%s%n%b`);
  if (!log) return { level: "none", count: 0, lastTag };
  const lines = log.split("\n");
  let level = "patch", feat = 0, fix = 0, brk = 0;
  for (const l of lines) {
    if (/^feat!:|^[a-z]+!:/.test(l) || /BREAKING CHANGE/.test(l)) brk++;
    else if (/^feat(\(|:)/.test(l)) feat++;
    else if (/^(fix|docs|refactor|chore|perf|test|style)(\(|:)/.test(l)) fix++;
  }
  if (brk) level = "major"; else if (feat) level = "minor"; else level = "patch";
  return { level, feat, fix, brk, lastTag, commits: sh(`git rev-list --count ${range}`) };
}

function nextVersion(level) {
  if (level === "major") return `${maj + 1}.0.0`;
  if (level === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

// Все файлы, где живёт версия.
function versionFiles() {
  const files = [
    "package.json", "lib/package.json", ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json", "agents/registry.json",
  ];
  for (const p of globSync("mcp/*/package.json", { cwd: ROOT })) files.push(p);
  return files.filter((f) => existsSync(R(f)));
}

function applyBump(next) {
  const changed = [];
  // JSON-файлы: заменить "version": "..."
  for (const f of versionFiles()) {
    const s = readFileSync(R(f), "utf8");
    const out = s.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${next}"`);
    if (out !== s) { writeFileSync(R(f), out); changed.push(f); }
  }
  // mcp/*/src/index.ts: new McpServer({ name, version: "x" })
  for (const f of globSync("mcp/*/src/index.ts", { cwd: ROOT })) {
    const s = readFileSync(R(f), "utf8");
    const out = s.replace(/(new McpServer\(\{[^}]*version:\s*)"[^"]+"/, `$1"${next}"`);
    if (out !== s) { writeFileSync(R(f), out); changed.push(f); }
  }
  return changed;
}

const arg = process.argv[2];
const sug = suggestFromCommits();

if (!arg) {
  console.log(`Текущая версия: ${current}`);
  console.log(`С последнего тега (${sug.lastTag || "нет"}): ${sug.commits || 0} коммитов` +
    (sug.feat != null ? ` (feat:${sug.feat} fix:${sug.fix} breaking:${sug.brk})` : ""));
  console.log(`Предложение: ${sug.level.toUpperCase()} → ${nextVersion(sug.level)}`);
  console.log(`Применить: node scripts/version.mjs ${sug.level}  (или patch/minor/major/auto)`);
  process.exit(0);
}

const level = arg === "auto" ? sug.level : arg;
if (!["major", "minor", "patch"].includes(level)) {
  console.error(`Неизвестный уровень: ${arg}. Ожидаю patch|minor|major|auto.`);
  process.exit(1);
}
const next = nextVersion(level);
const changed = applyBump(next);
console.log(`${current} → ${next} (${level.toUpperCase()}). Обновлено файлов: ${changed.length}`);
console.log(`Дальше: обновить CHANGELOG.md, затем git tag v${next} и gh release create v${next}.`);
