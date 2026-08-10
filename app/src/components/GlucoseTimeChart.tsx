import EChart from './Chart';
import { cssVar } from './cssVar';
import { useUnit, gluValue } from '@/domain/units';
import type { Entry } from '../data/nightscout';

export default function GlucoseTimeChart({
  entries, windowH, low = 3.9, high = 10.0,
}: { entries: Entry[]; windowH: number; low?: number; high?: number }) {
  const unit = useUnit();
  const g = (mmol: number) => gluValue(mmol, unit);
  const now = Date.now();
  const t0 = now - windowH * 3600e3;
  const pts = entries.filter((e) => e.t >= t0).map((e) => [e.t, +g(e.mmol).toFixed(2)]);

  const maxVmmol = pts.length ? Math.max(...entries.filter((e) => e.t >= t0).map((e) => e.mmol), high + 2) : 15;
  const vmaxMmol = Math.max(15, Math.ceil(maxVmmol + 1));
  const vmax = g(vmaxMmol);
  const yMin = g(2);
  const yInterval = unit === 'mgdl' ? (vmaxMmol > 18 ? 72 : 36) : (vmaxMmol > 18 ? 4 : 2);

  const trend = cssVar('--c-trend', '#b0713d');
  const glu = cssVar('--c-glu', '#93c79b');
  const danger = cssVar('--c-danger', '#c96b7a');
  const grid = cssVar('--color-neutral-700', '#595d6c');
  const axis = cssVar('--color-neutral-400', '#b2b6ca');

  const option = {
    animation: false,
    grid: { left: 26, right: 8, top: 8, bottom: 20 },
    xAxis: {
      type: 'time', min: t0, max: now,
      axisLabel: { color: axis, fontSize: 10, formatter: '{HH}:{mm}' },
      axisLine: { lineStyle: { color: grid, opacity: 0.4 } }, axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value', min: yMin, max: vmax, interval: yInterval,
      axisLabel: { color: axis, fontSize: 10 },
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: grid, opacity: 0.25 } },
    },
    series: [{
      type: 'line', data: pts, symbol: 'none', smooth: true, smoothMonotone: 'x',
      lineStyle: { color: trend, width: 2.5 },
      areaStyle: {
        color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: trend + '55' }, { offset: 1, color: trend + '00' }] },
      },
      markArea: { silent: true, itemStyle: { color: glu + '1f' }, data: [[{ yAxis: g(low) }, { yAxis: g(high) }]] },
      markLine: {
        silent: true, symbol: 'none', lineStyle: { type: 'dashed', width: 1 },
        data: [{ yAxis: g(high), lineStyle: { color: glu } }, { yAxis: g(low), lineStyle: { color: danger } }],
        label: { show: false },
      },
    }],
  };

  return <EChart option={option} height={210} />;
}
