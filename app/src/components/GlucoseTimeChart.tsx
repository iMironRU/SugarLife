import EChart, { cssVar } from './EChart';
import type { Entry } from '../data/nightscout';

export default function GlucoseTimeChart({
  entries, windowH, low = 3.9, high = 10.0,
}: { entries: Entry[]; windowH: number; low?: number; high?: number }) {
  const now = Date.now();
  const t0 = now - windowH * 3600e3;
  const pts = entries.filter((e) => e.t >= t0).map((e) => [e.t, +e.mmol.toFixed(2)]);

  const maxV = pts.length ? Math.max(...pts.map((p) => p[1] as number), high + 2) : 15;
  const vmax = Math.max(15, Math.ceil(maxV + 1));

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
      type: 'value', min: 2, max: vmax, interval: vmax > 18 ? 4 : 2,
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
      markArea: { silent: true, itemStyle: { color: glu + '1f' }, data: [[{ yAxis: low }, { yAxis: high }]] },
      markLine: {
        silent: true, symbol: 'none', lineStyle: { type: 'dashed', width: 1 },
        data: [{ yAxis: high, lineStyle: { color: glu } }, { yAxis: low, lineStyle: { color: danger } }],
        label: { show: false },
      },
    }],
  };

  return <EChart option={option} height={210} />;
}
