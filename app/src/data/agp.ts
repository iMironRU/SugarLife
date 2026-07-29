/* AGP / консенсус CGM (Battelino 2019, Bergenstal GMI 2018).
   Стандартные зоны (ммоль/л): <3.0 очень низко · 3.0–3.9 низко · 3.9–10.0 цель ·
   10.0–13.9 высоко · >13.9 очень высоко. */
import type { Entry } from './nightscout';

const MGDL = 18.0;
export const LOW = 3.9, HIGH = 10.0, VLOW = 3.0, VHIGH = 13.9;

export interface Stats {
  n: number; veryLow: number; low: number; target: number; high: number; veryHigh: number;
  tbr: number; tar: number; mean: number; sd: number; cv: number; gmi: number;
}

export function stats(entries: Entry[]): Stats | null {
  const v = entries.map((e) => e.mmol);
  const n = v.length;
  if (!n) return null;
  const pct = (f: (x: number) => boolean) => (v.filter(f).length / n) * 100;
  const veryLow = pct((x) => x < VLOW);
  const low = pct((x) => x >= VLOW && x < LOW);
  const target = pct((x) => x >= LOW && x <= HIGH);
  const high = pct((x) => x > HIGH && x <= VHIGH);
  const veryHigh = pct((x) => x > VHIGH);
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const cv = mean ? (sd / mean) * 100 : 0;
  const gmi = 3.31 + 0.02392 * (mean * MGDL); // среднее в мг/дл
  return { n, veryLow, low, target, high, veryHigh, tbr: veryLow + low, tar: high + veryHigh, mean, sd, cv, gmi };
}

export interface AgpPoint { t: number; p05: number; p25: number; p50: number; p75: number; p95: number; }

function percentile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// Перцентили глюкозы по времени суток (AGP «типовой день»)
export function agp(entries: Entry[], buckets = 48): AgpPoint[] {
  const groups: number[][] = Array.from({ length: buckets }, () => []);
  for (const e of entries) {
    const d = new Date(e.t);
    const sec = d.getHours() * 3600 + d.getMinutes() * 60;
    const idx = Math.min(buckets - 1, Math.floor((sec / 86400) * buckets));
    groups[idx].push(e.mmol);
  }
  return groups.map((arr, idx) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return {
      t: (idx / buckets) * 24,
      p05: percentile(s, 0.05), p25: percentile(s, 0.25), p50: percentile(s, 0.5),
      p75: percentile(s, 0.75), p95: percentile(s, 0.95),
    };
  }).filter((g): g is AgpPoint => g != null);
}
