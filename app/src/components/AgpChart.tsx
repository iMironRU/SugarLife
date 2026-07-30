import EChart, { cssVar } from './EChart';
import { agp, LOW, HIGH } from '../data/agp';
import { useUnit, gluValue } from '../data/units';
import type { Entry } from '../data/nightscout';

export default function AgpChart({ entries }: { entries: Entry[] }) {
  const unit = useUnit();
  const g = (mmol: number) => gluValue(mmol, unit);
  const pts = agp(entries, 48);
  const trend = cssVar('--c-trend', '#b0713d');
  const glu = cssVar('--c-glu', '#93c79b');
  const danger = cssVar('--c-danger', '#c96b7a');
  const grid = cssVar('--color-neutral-700', '#595d6c');
  const axis = cssVar('--color-neutral-400', '#b2b6ca');

  const maxV = pts.length ? Math.max(...pts.map((p) => p.p95), HIGH + 2) : 15;
  const vmaxMmol = Math.max(15, Math.ceil(maxV + 1));
  const vmax = g(vmaxMmol);
  const yMin = g(2);
  const yInterval = unit === 'mgdl' ? (vmaxMmol > 18 ? 72 : 36) : (vmaxMmol > 18 ? 4 : 2);

  const xy = (sel: (p: typeof pts[number]) => number) => pts.map((p) => [p.t, +g(sel(p)).toFixed(2)]);
  const diff = (a: (p: typeof pts[number]) => number, b: (p: typeof pts[number]) => number) =>
    pts.map((p) => [p.t, +(g(a(p)) - g(b(p))).toFixed(2)]);

  const bandBase = (data: any) => ({ type: 'line', data, stack: undefined as any, symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true, smooth: true });

  const option = {
    grid: { left: 26, right: 8, top: 10, bottom: 22 },
    xAxis: {
      type: 'value', min: 0, max: 24, interval: 6,
      axisLabel: { color: axis, fontSize: 10, formatter: (v: number) => `${v}:00` },
      axisLine: { lineStyle: { color: grid, opacity: 0.4 } }, axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value', min: yMin, max: vmax, interval: yInterval,
      axisLabel: { color: axis, fontSize: 10 },
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: grid, opacity: 0.25 } },
    },
    series: [
      // 5–95 коридор
      { ...bandBase(xy((p) => p.p05)), stack: 'outer' },
      { type: 'line', data: diff((p) => p.p95, (p) => p.p05), stack: 'outer', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: trend, opacity: 0.12 }, silent: true, smooth: true },
      // 25–75 коридор
      { ...bandBase(xy((p) => p.p25)), stack: 'inner' },
      { type: 'line', data: diff((p) => p.p75, (p) => p.p25), stack: 'inner', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: trend, opacity: 0.28 }, silent: true, smooth: true },
      // медиана
      {
        type: 'line', data: xy((p) => p.p50), symbol: 'none', smooth: true,
        lineStyle: { color: trend, width: 2.5 },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { type: 'dashed', width: 1 },
          data: [
            { yAxis: g(HIGH), lineStyle: { color: glu } },
            { yAxis: g(LOW), lineStyle: { color: danger } },
          ],
          label: { show: false },
        },
      },
    ],
  };

  if (!pts.length) return <div className="agp-empty">Недостаточно данных для AGP.</div>;
  return <EChart option={option} height={210} />;
}
