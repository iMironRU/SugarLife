/* Гладкие масштабируемые графики: агрегация по бакетам + сглаживание Catmull-Rom. */
import type { Entry } from './nightscout';

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// Усреднение точек по времени в count бакетов (сглаживает шум, масштабируется на любой период)
export function bucketize(entries: Entry[], count: number): { t: number; mmol: number }[] {
  if (entries.length <= count) return entries.map((e) => ({ t: e.t, mmol: e.mmol }));
  const t0 = entries[0].t, t1 = entries[entries.length - 1].t;
  const span = (t1 - t0) || 1;
  const buckets = Array.from({ length: count }, () => ({ sum: 0, n: 0, tsum: 0 }));
  for (const e of entries) {
    let idx = Math.floor(((e.t - t0) / span) * count);
    if (idx >= count) idx = count - 1; if (idx < 0) idx = 0;
    const b = buckets[idx]; b.sum += e.mmol; b.n++; b.tsum += e.t;
  }
  return buckets.filter((b) => b.n > 0).map((b) => ({ t: b.tsum / b.n, mmol: b.sum / b.n }));
}

// Гладкий путь через точки (Catmull-Rom → кубические безье)
export function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0].x},${pts[0].y}` : '';
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  const k = 1 / 6;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) * k, c1y = p1.y + (p2.y - p0.y) * k;
    const c2x = p2.x - (p3.x - p1.x) * k, c2y = p2.y - (p3.y - p1.y) * k;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

export interface SeriesOpts {
  w: number; h: number; vmin: number; vmax: number;
  buckets?: number; t0?: number; t1?: number;
}
// Гладкая линия + площадь под ней в системе координат w×h
export function smoothSeries(entries: Entry[], o: SeriesOpts): { line: string; area: string } {
  const bs = bucketize(entries, o.buckets ?? 64);
  if (bs.length < 2) return { line: '', area: '' };
  const T0 = o.t0 ?? bs[0].t;
  const T1 = o.t1 ?? bs[bs.length - 1].t;
  const dt = (T1 - T0) || 1;
  const x = (t: number) => ((t - T0) / dt) * o.w;
  const y = (v: number) => o.h - ((clamp(v, o.vmin, o.vmax) - o.vmin) / (o.vmax - o.vmin)) * o.h;
  const pts = bs.map((b) => ({ x: x(b.t), y: y(b.mmol) }));
  const line = smoothPath(pts);
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${o.h} L${pts[0].x.toFixed(1)},${o.h} Z`;
  return { line, area };
}
