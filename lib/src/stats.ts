// Чистая статистика на TypeScript (без внешних зависимостей) для аналитических агентов
// forecaster (#35), correlation-finder (#23), anomaly-detector (#36), metrics-tracker (#34).
// Заменяет python-воркеры: тяжёлое считается локально в Node, детерминированно.

export interface Point {
  t: number; // epoch ms
  v: number;
}

// ── Базовые ──
export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function variance(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1);
}

export function std(xs: number[]): number {
  return Math.sqrt(variance(xs));
}

export function quantile(xsIn: number[], q: number): number {
  const xs = [...xsIn].sort((a, b) => a - b);
  if (xs.length === 0) return NaN;
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const loV = xs[lo] as number;
  if (lo === hi) return loV;
  const hiV = xs[hi] as number;
  return loV + (hiV - loV) * (pos - lo);
}

export function median(xs: number[]): number {
  return quantile(xs, 0.5);
}

// ── Корреляция ──
export function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return NaN;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - mx;
    const dy = (y[i] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}

function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && (idx[j + 1] as [number, number])[0] === (idx[i] as [number, number])[0]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[(idx[k] as [number, number])[1]] = avgRank;
    i = j + 1;
  }
  return r;
}

export function spearman(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return NaN;
  return pearson(rank(x.slice(0, n)), rank(y.slice(0, n)));
}

/** t-статистика значимости корреляции и приближённый двусторонний p-value. */
export function corrPValue(r: number, n: number): number {
  if (!isFinite(r) || n < 4 || Math.abs(r) >= 1) return NaN;
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  // приближение по нормали (df большие) — консервативно
  const z = Math.abs(t);
  const p = 2 * (1 - normalCdf(z));
  return Math.max(0, Math.min(1, p));
}

function normalCdf(z: number): number {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Нормированная взаимная информация (бинировка), 0..1 — для нелинейных связей. */
export function mutualInformation(x: number[], y: number[], bins = 8): number {
  const n = Math.min(x.length, y.length);
  if (n < 8) return NaN;
  const bx = binIndices(x.slice(0, n), bins);
  const by = binIndices(y.slice(0, n), bins);
  const pxy = new Map<string, number>();
  const px = new Array<number>(bins).fill(0);
  const py = new Array<number>(bins).fill(0);
  for (let i = 0; i < n; i++) {
    const a = bx[i] as number;
    const b = by[i] as number;
    px[a] = (px[a] as number) + 1;
    py[b] = (py[b] as number) + 1;
    const key = a + "," + b;
    pxy.set(key, (pxy.get(key) ?? 0) + 1);
  }
  let mi = 0;
  for (const [key, c] of pxy) {
    const [a, b] = key.split(",").map(Number) as [number, number];
    const p = c / n;
    mi += p * Math.log2(p / (((px[a] as number) / n) * ((py[b] as number) / n)));
  }
  const hx = entropy(px, n);
  const hy = entropy(py, n);
  const denom = Math.min(hx, hy);
  return denom > 0 ? Math.max(0, Math.min(1, mi / denom)) : 0;
}

function minOf(xs: number[]): number {
  let m = Infinity;
  for (const v of xs) if (v < m) m = v;
  return m;
}
function maxOf(xs: number[]): number {
  let m = -Infinity;
  for (const v of xs) if (v > m) m = v;
  return m;
}

function binIndices(xs: number[], bins: number): number[] {
  const lo = minOf(xs);
  const hi = maxOf(xs);
  const span = hi - lo || 1;
  return xs.map((v) => Math.min(bins - 1, Math.floor(((v - lo) / span) * bins)));
}

function entropy(counts: number[], n: number): number {
  let h = 0;
  for (const c of counts) {
    if (c > 0) {
      const p = c / n;
      h -= p * Math.log2(p);
    }
  }
  return h;
}

// ── Прогноз (Holt's linear trend / SES) ──
export interface ForecastPoint {
  step: number;
  value: number;
  ciLow: number;
  ciHigh: number;
}
export interface ForecastResult {
  method: string;
  points: ForecastPoint[];
  confidence: number; // 0..1, грубая метрика по R²/остаткам
}

export function forecast(values: number[], horizon: number): ForecastResult {
  const n = values.length;
  if (n < 4) {
    const last = n > 0 ? (values[n - 1] as number) : 0;
    return {
      method: "insufficient-data",
      points: Array.from({ length: horizon }, (_, i) => ({ step: i + 1, value: last, ciLow: last, ciHigh: last })),
      confidence: 0,
    };
  }
  // Holt's linear: level + trend
  const alpha = 0.4;
  const beta = 0.2;
  let level = values[0] as number;
  let trend = (values[1] as number) - (values[0] as number);
  const fitted: number[] = [level];
  for (let i = 1; i < n; i++) {
    const prevLevel = level;
    const y = values[i] as number;
    level = alpha * y + (1 - alpha) * (prevLevel + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    fitted.push(prevLevel + trend);
  }
  // остатки
  const resid: number[] = [];
  for (let i = 1; i < n; i++) resid.push((values[i] as number) - (fitted[i] as number));
  const sigma = std(resid);
  const points: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const v = level + h * trend;
    const ci = 1.96 * sigma * Math.sqrt(h);
    points.push({ step: h, value: round(v), ciLow: round(v - ci), ciHigh: round(v + ci) });
  }
  // confidence: 1 - нормированная ошибка
  const denom = std(values) || 1;
  const confidence = Math.max(0, Math.min(1, 1 - sigma / denom));
  return { method: "holt-linear", points, confidence: round(confidence) };
}

// ── Аномалии (EWMA + z-score, плюс IQR) ──
export interface Anomaly {
  index: number;
  t: number;
  value: number;
  z: number;
  kind: "spike" | "drop";
  severity: "low" | "medium" | "high";
}

export function detectAnomalies(points: Point[], zThreshold = 3, alpha = 0.3): Anomaly[] {
  const n = points.length;
  if (n < 5) return [];
  const values = points.map((p) => p.v);
  const globalStd = std(values) || 1;
  let ewma = values[0] as number;
  let ewmvar = variance(values.slice(0, Math.min(5, n))) || globalStd * globalStd;
  const out: Anomaly[] = [];
  for (let i = 1; i < n; i++) {
    const v = values[i] as number;
    const localStd = Math.sqrt(ewmvar) || globalStd;
    const z = (v - ewma) / (localStd || 1);
    if (Math.abs(z) >= zThreshold) {
      out.push({
        index: i,
        t: (points[i] as Point).t,
        value: v,
        z: round(z),
        kind: z > 0 ? "spike" : "drop",
        severity: Math.abs(z) >= zThreshold * 1.8 ? "high" : Math.abs(z) >= zThreshold * 1.3 ? "medium" : "low",
      });
    }
    // обновление EWMA
    const diff = v - ewma;
    ewma = ewma + alpha * diff;
    ewmvar = (1 - alpha) * (ewmvar + alpha * diff * diff);
  }
  return out;
}

// ── Агрегаты ──
export interface Aggregates {
  count: number;
  sum: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stddev: number;
}

export function aggregate(values: number[]): Aggregates {
  if (values.length === 0) {
    return { count: 0, sum: 0, mean: NaN, median: NaN, min: NaN, max: NaN, stddev: NaN };
  }
  return {
    count: values.length,
    sum: round(values.reduce((a, b) => a + b, 0)),
    mean: round(mean(values)),
    median: round(median(values)),
    min: minOf(values),
    max: maxOf(values),
    stddev: round(std(values)),
  };
}

/** Выровнять два ряда по суточным бакетам (среднее за день) для корреляции. */
export function alignByDay(a: Point[], b: Point[]): { x: number[]; y: number[] } {
  const day = (t: number): number => Math.floor(t / 86_400_000);
  const bucket = (pts: Point[]): Map<number, number> => {
    const acc = new Map<number, number[]>();
    for (const p of pts) {
      const d = day(p.t);
      const arr = acc.get(d) ?? [];
      arr.push(p.v);
      acc.set(d, arr);
    }
    const m = new Map<number, number>();
    for (const [d, vs] of acc) m.set(d, mean(vs));
    return m;
  };
  const ma = bucket(a);
  const mb = bucket(b);
  const x: number[] = [];
  const y: number[] = [];
  for (const [d, va] of ma) {
    const vb = mb.get(d);
    if (vb !== undefined) {
      x.push(va);
      y.push(vb);
    }
  }
  return { x, y };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
