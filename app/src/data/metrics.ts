import type { Entry } from './nightscout';
import { smoothSeries } from './chart';

export interface GlucoseStats {
  tir: number; above: number; below: number; avg: number; sd: number; n: number;
}

// Стандартный диапазон TIR: 3.9–10.0 ммоль/л
export function glucoseStats(entries: Entry[], lowMmol = 3.9, highMmol = 10.0): GlucoseStats | null {
  const vals = entries.map((e) => e.mmol);
  const n = vals.length;
  if (!n) return null;
  const inRange = vals.filter((v) => v >= lowMmol && v <= highMmol).length;
  const above = vals.filter((v) => v > highMmol).length;
  const below = vals.filter((v) => v < lowMmol).length;
  const avg = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - avg) ** 2, 0) / n);
  return {
    tir: Math.round((inRange / n) * 100),
    above: Math.round((above / n) * 100),
    below: Math.round((below / n) * 100),
    avg, sd, n,
  };
}

// Гладкий спарклайн (area + line) из entries в системе координат w×h
export function sparkline(entries: Entry[], w: number, h: number, vmin: number, vmax: number) {
  return smoothSeries(entries, { w, h, vmin, vmax, buckets: 56 });
}
