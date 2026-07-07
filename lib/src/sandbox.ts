// sandbox.ts — изолированные песочницы проектов (OlimpOS P5). Выполнение кода проекта — в эфемерном
// docker-контейнере: монтируется ТОЛЬКО рабочая папка проекта, по умолчанию без сети, с лимитами
// CPU/RAM и таймаутом. Хост, секреты и данные других тенантов недоступны (инвариант sandbox-изоляции).
//
// Git-операции (clone/commit/push/PR) — тоже в песочнице; push/PR наружу считаются высокорисковыми и
// должны проходить через approval (governance) вне модели — этот модуль их только исполняет по команде.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve, sep, dirname } from "node:path";

export interface SandboxRunResult { code: number; stdout: string; stderr: string; timedOut: boolean; }

/** Корень песочниц: NABU_SANDBOX_ROOT или <NABU_HOME>/spaces. */
export function sandboxRoot(): string {
  return process.env.NABU_SANDBOX_ROOT
    || join(process.env.NABU_HOME || join(process.env.HOME || ".", "nabu"), "spaces");
}

/** Рабочая папка проекта по slug/namespace. Создаётся при необходимости. Только внутри sandboxRoot. */
export function projectDir(spaceSlug: string): string {
  const safe = spaceSlug.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "space";
  const dir = join(sandboxRoot(), safe);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Проверка, что путь внутри рабочей папки — SYMLINK-SAFE (AUDIT R8 M4).
 * Раньше сверялся лишь лексический `resolve()`, не разворачивающий symlink-компоненты: код в
 * контейнере (sandbox_run, где /work↔workdir) мог создать `ln -s /etc evil`, после чего
 * read/writeSandboxFile("evil/…") следовали по symlink на ХОСТ. Теперь берём realpath самого
 * глубокого СУЩЕСТВУЮЩЕГО предка цели (цель при записи может ещё не существовать) и сверяем
 * реальный путь с realpath(workdir) — любой symlink-предок, уводящий наружу, отвергается.
 */
function withinWorkdir(workdir: string, target: string): boolean {
  const root = realpathSync(resolve(workdir));
  const abs = resolve(workdir, target);
  let probe = abs;
  while (!existsSync(probe) && probe !== dirname(probe)) probe = dirname(probe);
  let realProbe: string;
  try { realProbe = realpathSync(probe); } catch { return false; }
  const resolved = realProbe + abs.slice(probe.length); // realpath предка + лексический хвост
  return resolved === root || resolved.startsWith(root + sep);
}

/** Записать файл внутри песочницы (относительный путь; traversal запрещён). */
export function writeSandboxFile(workdir: string, relPath: string, content: string): void {
  if (!withinWorkdir(workdir, relPath)) throw new Error(`путь вне песочницы: ${relPath}`);
  const full = resolve(workdir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

/** Прочитать файл из песочницы. */
export function readSandboxFile(workdir: string, relPath: string): string {
  if (!withinWorkdir(workdir, relPath)) throw new Error(`путь вне песочницы: ${relPath}`);
  return readFileSync(resolve(workdir, relPath), "utf8");
}

/**
 * Выполнить команду в ИЗОЛИРОВАННОМ эфемерном docker-контейнере.
 * По умолчанию: без сети (--network none), лимиты RAM/CPU, только workdir смонтирован в /work,
 * непривилегированно. network:true — для git/npm (bridge). Таймаут — жёсткий kill.
 */
export function runInSandbox(
  workdir: string,
  command: string,
  opts: { image?: string; network?: boolean; timeoutMs?: number; memory?: string; cpus?: string } = {},
): Promise<SandboxRunResult> {
  const image = opts.image || process.env.NABU_SANDBOX_IMAGE || "node:20-alpine";
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const cname = `nabu-sbx-${randomUUID().slice(0, 12)}`; // именуем контейнер → можем убить по имени при таймауте
  const args = [
    "run", "--rm", "--name", cname,
    "--network", opts.network ? "bridge" : "none",
    "--memory", opts.memory || "512m",
    "--cpus", opts.cpus || "1",
    "--pids-limit", "256",
    "--security-opt", "no-new-privileges",
    "-v", `${realpathSync(workdir)}:/work`,
    "-w", "/work",
    image,
    "sh", "-c", command,
  ];
  return new Promise((res) => {
    let out = "", err = "", done = false, timedOut = false;
    const child = spawn("docker", args, { windowsHide: true });
    const timer = setTimeout(() => {
      timedOut = true;
      // AUDIT R8 M5: child.kill("SIGKILL") убивает лишь docker-CLI-клиент, а НЕ контейнер (при
      // `docker run` сигнал не проксируется в контейнер). Форсированно удаляем контейнер по имени —
      // это его останавливает и снимает CPU/RAM, иначе зациклившаяся команда пережила бы таймаут.
      try { spawn("docker", ["rm", "-f", cname], { windowsHide: true }).on("error", () => { /* docker мог уже убрать (--rm) */ }); } catch { /* */ }
      try { child.kill("SIGKILL"); } catch { /* */ }
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on("data", (d) => { out += d; if (out.length > 2_000_000) out = out.slice(-2_000_000); });
    child.stderr?.on("data", (d) => { err += d; if (err.length > 500_000) err = err.slice(-500_000); });
    const finish = (code: number) => { if (done) return; done = true; clearTimeout(timer); res({ code, stdout: out, stderr: err, timedOut }); };
    child.on("error", (e) => { err += String(e.message); finish(-1); });
    child.on("close", (code) => finish(code ?? -1));
  });
}

// ── Git-хелперы (в песочнице, network:true). push/PR — высокорисковые: только по approval. ──

/** git clone <remote> в рабочую папку (network). Токен — через env GIT_ASKPASS/URL с credentials извне. */
export function gitClone(workdir: string, remote: string, opts: { image?: string } = {}): Promise<SandboxRunResult> {
  const safe = remote.replace(/'/g, "");
  return runInSandbox(workdir, `git clone '${safe}' . 2>&1 || (echo 'clone failed' && exit 1)`, {
    image: opts.image || "alpine/git", network: true, timeoutMs: 180_000,
  });
}

/** git add -A && commit -m. Локально в песочнице (безопасно, без сети). */
export function gitCommit(workdir: string, message: string): Promise<SandboxRunResult> {
  const m = message.replace(/'/g, "’");
  return runInSandbox(workdir, `git add -A && git -c user.email=nabu@olimpos -c user.name=Nabu commit -m '${m}'`, {
    image: "alpine/git", network: false, timeoutMs: 60_000,
  });
}

/** git status --porcelain (диагностика). */
export function gitStatus(workdir: string): Promise<SandboxRunResult> {
  return runInSandbox(workdir, "git status --porcelain -b", { image: "alpine/git", network: false, timeoutMs: 30_000 });
}

/**
 * git push — ВЫСОКОРИСКОВОЕ (external write). Только после approval (проверяется в MCP-слое).
 * remote — authenticated URL (может содержать токен) или origin; branch — целевая ветка.
 * network:true. Токен НЕ логируется вызывающим (маскировать при аудите).
 */
export function gitPush(workdir: string, opts: { remote?: string; branch?: string } = {}): Promise<SandboxRunResult> {
  const remote = (opts.remote || "origin").replace(/'/g, "");
  const branch = (opts.branch || "HEAD").replace(/[^a-zA-Z0-9._/-]/g, "");
  const dest = branch === "HEAD" ? "HEAD" : `HEAD:${branch}`;
  return runInSandbox(workdir, `git push '${remote}' ${dest} 2>&1`, {
    image: "alpine/git", network: true, timeoutMs: 120_000,
  });
}

/** Доступен ли docker (для graceful degradation). */
export function dockerAvailable(): Promise<boolean> {
  return new Promise((res) => {
    const c = spawn("docker", ["version", "--format", "{{.Server.Version}}"], { windowsHide: true });
    c.on("error", () => res(false));
    c.on("close", (code) => res(code === 0));
  });
}

export { existsSync as sandboxExists };
