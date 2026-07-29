import type { Entry } from '../data/nightscout';
import { smoothSeries } from '../data/chart';

export default function GlucoseChart({
  entries, windowH, low = 3.9, high = 10.0,
}: { entries: Entry[]; windowH: number; low?: number; high?: number }) {
  const W = 320, H = 190;
  const now = Date.now();
  const t0 = now - windowH * 3600e3;
  const pts = entries.filter((e) => e.t >= t0);

  const maxV = pts.length ? Math.max(...pts.map((p) => p.mmol), high) : high;
  const vmax = Math.max(15, Math.ceil(maxV + 1));
  const vmin = 2;

  const y = (v: number) => H - ((Math.max(vmin, Math.min(vmax, v)) - vmin) / (vmax - vmin)) * H;
  const buckets = Math.min(90, Math.max(24, Math.round(pts.length / 2)));
  const { line, area } = smoothSeries(pts, { w: W, h: H, vmin, vmax, buckets, t0, t1: now });

  const stepV = vmax - vmin > 16 ? 4 : 2;
  const ticks: number[] = [];
  for (let v = Math.ceil(vmin / stepV) * stepV; v <= vmax; v += stepV) ticks.push(v);

  const xLabels: string[] = [];
  const marks = 4;
  for (let i = 0; i <= marks; i++) {
    const d = new Date(t0 + ((now - t0) * i) / marks);
    xLabels.push(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
  }

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="chart-svg">
        <defs>
          <linearGradient id="gluFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--c-trend)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--c-trend)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* целевой диапазон */}
        <rect x="0" y={y(high)} width={W} height={y(low) - y(high)} fill="var(--c-glu-3)" fillOpacity="0.12" />
        <line x1="0" y1={y(high)} x2={W} y2={y(high)} stroke="var(--c-glu-3)" strokeOpacity="0.4" strokeWidth="1" strokeDasharray="4 4" />
        <line x1="0" y1={y(low)} x2={W} y2={y(low)} stroke="var(--c-danger)" strokeOpacity="0.4" strokeWidth="1" strokeDasharray="4 4" />
        {/* сетка Y */}
        {ticks.map((v) => (
          <line key={v} x1="0" y1={y(v)} x2={W} y2={y(v)} stroke="var(--color-neutral-700)" strokeOpacity="0.3" strokeWidth="1" />
        ))}
        {/* кривая глюкозы — гладкая + заливка */}
        {area && <path d={area} fill="url(#gluFill)" />}
        {line && <path d={line} fill="none" stroke="var(--c-trend)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="chart-y">
        {ticks.map((v) => (
          <span key={v} style={{ top: `${(y(v) / H) * 100}%` }}>{v}</span>
        ))}
      </div>
      <div className="chart-x">
        {xLabels.map((l, i) => <span key={i}>{l}</span>)}
      </div>
    </div>
  );
}
