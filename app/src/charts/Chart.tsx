import { lazy, Suspense } from 'react';
import { готовыйГрафик } from './warm';

/* Ленивая обёртка над EChart. echarts — самая тяжёлая зависимость приложения и нужна
   только на трёх вкладках («НМГ», «Инсулин», «Метрики»), а грузилась в общем куске
   вместе с оболочкой и задерживала первый экран. Здесь она выносится в отдельный чанк.

   Прогретый кусок рисуется сразу, без Suspense: заглушке неоткуда мигнуть даже на
   кадр (прогрев — в charts/warm.ts, запускается в простое после первого экрана).
   Пока чанк всё же едет — держим место графика пустым блоком той же высоты, чтобы
   вёрстка не прыгала. */

const EChart = lazy(() => import('./EChart'));

export default function Chart({ option, height = 200 }: { option: any; height?: number }) {
  const Готовый = готовыйГрафик();
  if (Готовый) return <Готовый option={option} height={height} />;
  return (
    <Suspense fallback={<div style={{ height }} />}>
      <EChart option={option} height={height} />
    </Suspense>
  );
}
