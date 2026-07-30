import type { Entry } from '../data/nightscout';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  const k = 1 / 6;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) * k, c1y = p1.y + (p2.y - p0.y) * k;
    const c2x = p2.x - (p3.x - p1.x) * k, c2y = p2.y - (p3.y - p1.y) * k;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

// Фоновый мини-график сахара за последний час внутри круга.
export default function CircleSparkline({ entries, windowH = 1 }: { entries: Entry[]; windowH?: number }) {
  const W = 150, H = 150;
  const now = Date.now();
  const t0 = now - windowH * 3600e3;
  const pts = entries.filter((e) => e.t >= t0);
  if (pts.length < 2) return null;

  const vals = pts.map((p) => p.mmol);
  let vmin = Math.min(...vals), vmax = Math.max(...vals);
  if (vmax - vmin < 1) { const m = (vmin + vmax) / 2; vmin = m - 0.75; vmax = m + 0.75; } // не даём линии быть плоской
  const yTop = 84, yBot = 140; // рисуем в нижней части круга, за цифрой
  const x = (t: number) => ((t - t0) / (now - t0)) * W;
  const y = (v: number) => yBot - ((clamp(v, vmin, vmax) - vmin) / (vmax - vmin)) * (yBot - yTop);

  const P = pts.map((p) => ({ x: x(p.t), y: y(p.mmol) }));
  const line = smoothPath(P);
  const area = `${line} L${W},${H} L0,${H} Z`;
  const id = 'csClip';

  return (
    <svg className="circle-spark" viewBox="0 0 150 150" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <clipPath id={id}><circle cx="75" cy="75" r="72" /></clipPath>
        <linearGradient id="csFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--c-glu)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--c-glu)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id})`}>
        <path d={area} fill="url(#csFill)" />
        <path d={line} fill="none" stroke="var(--c-glu)" strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}
