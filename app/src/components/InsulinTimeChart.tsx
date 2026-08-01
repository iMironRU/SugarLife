import EChart, { cssVar } from './EChart';
import type { Treatment } from '../data/nightscout';

/* График подачи инсулина: ступенчатая кривая базала (ед/ч) из temp basal +
   болюсы столбиками (ед) на второй оси. Всё из реальных treatments Nightscout. */
export default function InsulinTimeChart({
  tempBasals, boluses, windowH, baseBasal,
}: {
  tempBasals: Treatment[]; boluses: Treatment[]; windowH: number; baseBasal?: number | null;
}) {
  const now = Date.now();
  const t0 = now - windowH * 3600e3;

  // ступенчатая подача базала: берём чуть шире окна слева, чтобы ступень дошла до края
  const basalPts = tempBasals
    .filter((t) => t.rate != null && t.t >= t0 - 6 * 3600e3)
    .map((t) => [t.t, +(t.rate as number).toFixed(2)] as [number, number]);
  // добить ступень до «сейчас» последним значением
  if (basalPts.length) basalPts.push([now, basalPts[basalPts.length - 1][1]]);

  const bolusPts = boluses
    .filter((b) => (b.insulin ?? 0) > 0 && b.t >= t0)
    .map((b) => [b.t, +(b.insulin as number).toFixed(2)] as [number, number]);

  const ins = cssVar('--c-ins', '#63c0cc');
  const carb = cssVar('--c-carb', '#e0b64f');
  const grid = cssVar('--color-neutral-700', '#595d6c');
  const axis = cssVar('--color-neutral-400', '#b2b6ca');

  const maxRate = Math.max(1, baseBasal ?? 0, ...basalPts.map((p) => p[1]));
  const rateMax = Math.ceil((maxRate + 0.4) * 2) / 2; // до ближайшие 0.5
  const maxBolus = Math.max(2, ...bolusPts.map((p) => p[1]));
  const hasBolus = bolusPts.length > 0;

  const option = {
    animation: false,
    grid: { left: 34, right: hasBolus ? 30 : 10, top: 10, bottom: 20 },
    xAxis: {
      type: 'time', min: t0, max: now,
      axisLabel: { color: axis, fontSize: 10, formatter: '{HH}:{mm}' },
      axisLine: { lineStyle: { color: grid, opacity: 0.4 } }, axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: 'value', min: 0, max: rateMax,
        axisLabel: { color: axis, fontSize: 10, formatter: '{value}' },
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { lineStyle: { color: grid, opacity: 0.25 } },
      },
      {
        type: 'value', min: 0, max: Math.ceil(maxBolus), position: 'right', show: hasBolus,
        axisLabel: { color: axis, fontSize: 10, formatter: '{value}' },
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'базал', type: 'line', step: 'end', data: basalPts, symbol: 'none',
        lineStyle: { color: ins, width: 2 },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: ins + '55' }, { offset: 1, color: ins + '00' }] },
        },
        // базовая скорость профиля — пунктиром для ориентира
        markLine: baseBasal != null ? {
          silent: true, symbol: 'none', lineStyle: { type: 'dashed', width: 1, color: ins + '99' },
          data: [{ yAxis: +baseBasal.toFixed(2) }], label: { show: false },
        } : undefined,
      },
      {
        name: 'болюс', type: 'bar', yAxisIndex: 1, data: bolusPts, barWidth: 5, barMinHeight: 2,
        itemStyle: { color: carb, borderRadius: [2, 2, 0, 0] },
        label: { show: true, position: 'top', color: carb, fontSize: 9, formatter: (p: { value: [number, number] }) => p.value[1] },
      },
    ],
  };

  return <EChart option={option} height={200} />;
}
