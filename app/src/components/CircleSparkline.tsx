import type { Entry } from '@/sources/nightscout';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const LOW = 3.9, HIGH = 10.0;
const inRange = (v: number) => v >= LOW && v <= HIGH;

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

// Фоновый мини-график сахара за час внутри круга, по центру, «светофором», приглушённый.
export default function CircleSparkline({ entries, windowH = 1 }: { entries: Entry[]; windowH?: number }) {
  const W = 150, H = 150;
  const now = Date.now();
  const t0 = now - windowH * 3600e3;
  const pts = entries.filter((e) => e.t >= t0);
  if (pts.length < 2) return null;

  const vals = pts.map((p) => p.mmol);
  let vmin = Math.min(...vals), vmax = Math.max(...vals);
  if (vmax - vmin < 1) { const m = (vmin + vmax) / 2; vmin = m - 0.9; vmax = m + 0.9; }

  // по центру круга
  const yTop = 42, yBot = 108;
  const x = (t: number) => ((t - t0) / (now - t0)) * W;
  const y = (v: number) => yBot - ((clamp(v, vmin, vmax) - vmin) / (vmax - vmin)) * (yBot - yTop);

  const P = pts.map((p) => ({ x: x(p.t), y: y(p.mmol) }));
  const line = smoothPath(P);
  const area = `${line} L${W},${H} L0,${H} Z`;

  // «светофор»: цвет по значению через вертикальный градиент (верх=высоко, низ=низко)
  const col = (v: number) => (inRange(v) ? 'var(--c-glu)' : 'var(--c-danger)');
  const off = (v: number) => clamp((vmax - v) / (vmax - vmin), 0, 1) * 100;
  const stops: { o: number; c: string }[] = [{ o: 0, c: col(vmax) }];
  if (HIGH < vmax && HIGH > vmin) { const o = off(HIGH); stops.push({ o, c: col(HIGH + 0.01) }, { o, c: col(HIGH - 0.01) }); }
  if (LOW < vmax && LOW > vmin) { const o = off(LOW); stops.push({ o, c: col(LOW + 0.01) }, { o, c: col(LOW - 0.01) }); }
  stops.push({ o: 100, c: col(vmin) });
  stops.sort((a, b) => a.o - b.o);

  return (
    <svg className="circle-spark" viewBox="0 0 150 150" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <clipPath id="csClip"><circle cx="75" cy="75" r="72" /></clipPath>
        <linearGradient id="csGrad" x1="0" y1="0" x2="0" y2="1">
          {stops.map((s, i) => <stop key={i} offset={`${s.o}%`} stopColor={s.c} />)}
        </linearGradient>
      </defs>
      <g clipPath="url(#csClip)">
        <path d={area} fill="url(#csGrad)" fillOpacity="0.08" />
        <path d={line} fill="none" stroke="url(#csGrad)" strokeOpacity="0.4" strokeWidth="1.8" strokeLinecap="round" />
      </g>
    </svg>
  );
}
