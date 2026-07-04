// hardware.mjs — инвентаризация локальной машины + каталог локальных моделей Ollama.
// Zero-dep: только node-builtins + опрос системных бинарников. Помогает пользователю выбрать
// модель для «локального мозга» (T1), которую его железо реально потянет.

import { totalmem, freemem, cpus, platform } from "node:os";
import { spawnSync } from "node:child_process";

function sh(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 5000 });
    return r.status === 0 ? (r.stdout || "").trim() : null;
  } catch { return null; }
}

/** Обнаружить GPU и объём видеопамяти (ГБ). Возвращает { kind, vramGb } или null. */
function detectGpu() {
  // NVIDIA
  const nv = sh("nvidia-smi", ["--query-gpu=memory.total", "--format=csv,noheader,nounits"]);
  if (nv) {
    const mb = Math.max(...nv.split("\n").map((x) => Number(x.trim())).filter(Number.isFinite));
    if (mb > 0) return { kind: "nvidia", vramGb: +(mb / 1024).toFixed(1) };
  }
  // Apple Silicon: единая память (metal). Отдельной VRAM нет — модель делит RAM.
  if (platform() === "darwin") {
    const brand = sh("sysctl", ["-n", "machdep.cpu.brand_string"]) || "";
    const isArm = /Apple/.test(brand) || sh("uname", ["-m"]) === "arm64";
    if (isArm) return { kind: "apple-metal", vramGb: null }; // делит RAM
  }
  // AMD ROCm
  const rocm = sh("rocm-smi", ["--showmeminfo", "vram", "--csv"]);
  if (rocm && /vram/i.test(rocm)) return { kind: "amd-rocm", vramGb: null };
  return null;
}

/** Инвентаризация: RAM, CPU, GPU. */
export function inventory() {
  const ramGb = +(totalmem() / 1e9).toFixed(1);
  const freeGb = +(freemem() / 1e9).toFixed(1);
  const cores = cpus().length;
  const gpu = detectGpu();
  // «Бюджет модели» — сколько ГБ реально доступно под веса: на GPU это VRAM, иначе ~60% RAM
  // (ОС + Postgres + TypeDB + сам Nabu тоже едят память).
  const budgetGb = gpu?.vramGb ?? +(ramGb * 0.6).toFixed(1);
  return { ramGb, freeGb, cores, gpu, budgetGb, platform: platform() };
}

// ── Каталог локальных моделей (курируемый; ollama.com/models) ──
// ramFloorGb — минимум «бюджета модели» (VRAM или ~60% RAM) для комфортной работы.
// role: chat (локальный мозг T1) · embed (эмбеддинги) · vision (фото→память).
// Актуальность тегов/новых релизов — сверять на ollama.com; здесь — проверенные ориентиры.
export const MODEL_CATALOG = [
  // — быстрый тест (точность низкая, скорость высокая; для проверки механики) —
  { name: "gemma3:270m-it-qat", role: "chat", ramFloorGb: 1, tier: "test",
    note: "крошечная/быстрая; инструменты НЕ вызывает — только smoke-тест конвейера, не рабочий мозг" },
  // — chat / локальный мозг —
  { name: "qwen3.5:0.8b", role: "chat", ramFloorGb: 2, tier: "min",
    note: "минимальный рабочий мозг T1; tool-calling есть, точность скромная" },
  { name: "llama3.2:3b", role: "chat", ramFloorGb: 4, tier: "balanced",
    note: "хороший баланс скорость/качество для CPU-ноутбука" },
  { name: "qwen3:4b", role: "chat", ramFloorGb: 5, tier: "balanced",
    note: "сильный tool-calling; на CPU медленный, комфортно с GPU" },
  { name: "gemma3:4b", role: "chat", ramFloorGb: 5, tier: "balanced",
    note: "качественный ассистент, мультиязычный" },
  { name: "qwen3:8b", role: "chat", ramFloorGb: 9, tier: "quality",
    note: "заметно точнее; нужен GPU или много RAM" },
  { name: "gpt-oss:20b", role: "chat", ramFloorGb: 16, tier: "quality",
    note: "кандидат на прохождение evals Совета (T2); GPU обязателен" },
  // — embeddings —
  { name: "nomic-embed-text-v2-moe:latest", role: "embed", ramFloorGb: 2, tier: "default",
    note: "эмбеддинги по умолчанию (768-dim, task-префиксы)" },
  { name: "qwen3-embedding:0.6b", role: "embed", ramFloorGb: 1, tier: "min",
    note: "лёгкая альтернатива эмбеддингов" },
  // — vision (фото→память) —
  { name: "qwen2.5vl:3b", role: "vision", ramFloorGb: 5, tier: "balanced",
    note: "извлечение текста/описание с фото локально (NABU_VISION_MODEL)" },
  { name: "gemma3:4b", role: "vision", ramFloorGb: 5, tier: "balanced",
    note: "мультимодальна — годится и для vision" },
];

/** Пометить каталог пригодностью под конкретное железо. */
export function annotateForHardware(hw, catalog = MODEL_CATALOG) {
  return catalog.map((m) => ({
    ...m,
    fits: m.ramFloorGb <= hw.budgetGb,
    headroom: +(hw.budgetGb - m.ramFloorGb).toFixed(1),
  }));
}

/** Рекомендации по ролям под железо. chat — скорость-осознанно (крупная, но «минуты/ответ»
 * модель на слабом CPU — плохая рекомендация: предпочитаем крупнейшую, что НЕ «медленно»). */
export function recommend(hw, catalog = MODEL_CATALOG) {
  const fit = annotateForHardware(hw, catalog).filter((m) => m.fits);
  const bestBySize = (list) => list.slice().sort((a, b) => b.ramFloorGb - a.ramFloorGb)[0] || null;
  const embed = bestBySize(fit.filter((m) => m.role === "embed"));
  const vision = bestBySize(fit.filter((m) => m.role === "vision" && m.tier !== "test"));
  const chats = fit.filter((m) => m.role === "chat" && m.tier !== "test");
  const usable = chats.filter((m) => !/медленно/i.test(speedNote(hw, m))); // приемлемая скорость
  const chat = bestBySize(usable) || bestBySize(chats); // иначе — крупнейшая влезающая (с caveat в speedNote)
  return { chat, embed, vision };
}

/** Оценка скорости chat-модели на этом железе (грубо): warn при CPU + мало ядер. */
export function speedNote(hw, m) {
  if (m.role !== "chat") return "";
  if (hw.gpu && hw.gpu.vramGb != null && hw.gpu.vramGb >= m.ramFloorGb) return "быстро (GPU)";
  if (hw.gpu && hw.gpu.vramGb == null) return "GPU (скорость зависит от VRAM — сверьте вручную)";
  // CPU: скорость ~ падает с размером модели и растёт с числом ядер.
  if (m.ramFloorGb <= 1) return hw.cores >= 4 ? "быстро" : "терпимо (мелкая)";
  if (m.ramFloorGb <= 4) return hw.cores >= 8 ? "терпимо" : "МЕДЛЕННО на CPU (минуты/ответ)";
  return "ОЧЕНЬ медленно на CPU — нужен GPU";
}

/** Человекочитаемая сводка железа. */
export function describeHardware(hw) {
  const g = hw.gpu
    ? (hw.gpu.vramGb ? `${hw.gpu.kind} ${hw.gpu.vramGb} ГБ VRAM` : hw.gpu.kind)
    : "нет (CPU-инференс)";
  return `RAM ${hw.ramGb} ГБ (свободно ${hw.freeGb}) · CPU ${hw.cores} ядер · GPU: ${g} · бюджет модели ≈ ${hw.budgetGb} ГБ`;
}
