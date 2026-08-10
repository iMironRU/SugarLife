import { lazy, Suspense } from 'react';

/* Ленивая обёртка над EChart. echarts — самая тяжёлая зависимость приложения и нужна
   только на трёх вкладках («НМГ», «Инсулин», «Метрики»), а грузилась в общем куске
   вместе с оболочкой и задерживала первый экран. Здесь она выносится в отдельный чанк.
   Пока чанк едет — держим место графика пустым блоком той же высоты, чтобы вёрстка
   не прыгала. */
const EChart = lazy(() => import('./EChart'));

export default function Chart({ option, height = 200 }: { option: any; height?: number }) {
  return (
    <Suspense fallback={<div style={{ height }} />}>
      <EChart option={option} height={height} />
    </Suspense>
  );
}
