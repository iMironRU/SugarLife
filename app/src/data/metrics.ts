import type { Entry } from './nightscout';

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

// Спарклайн (area + line) из entries в системе координат w×h
export function sparkline(entries: Entry[], w: number, h: number, vmin: number, vmax: number) {
  if (entries.length < 2) return { area: '', line: '' };
  const step = Math.max(1, Math.floor(entries.length / 60));
  const pts = entries.filter((_, i) => i % step === 0);
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t || t0 + 1;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * w;
  const y = (v: number) => h - ((Math.max(vmin, Math.min(vmax, v)) - vmin) / (vmax - vmin)) * h;
  const line = pts.map((p, i) => (i ? 'L' : 'M') + x(p.t).toFixed(1) + ',' + y(p.mmol).toFixed(1)).join(' ');
  const area = line + ` L${w},${h} L0,${h} Z`;
  return { line, area };
}
