import type { DevPoint } from '@/domain/types';

/* Сколько на самом деле осталось, когда помпа показывает мало.

   Процент заряда сам по себе не отвечает на вопрос «успею ли до утра», и вот почему —
   разбор девяноста дней реальных данных, десять замен:

   • Помпа НИКОГДА не показывает ноль. Дно шкалы — 1%, события «стало 0%» в данных не
     существует вовсе. То есть «1%» это не «вот-вот выключится».
   • На этом 1% помпа продолжает работать: медиана 9,6 часа, максимум 58,9 — двое с
     половиной суток. Среднее (22 ч) тут врёт: его вытягивают два длинных случая,
     опираться надо на медиану.
   • Шкала грубая и нелинейная: наблюдалось 75 → 44 → 29 → 22 → 3 → 1.

   Отсюда единственный честный ответ — не формула, а собственная история человека:
   «в прошлые разы после N% помпа работала ещё столько-то». Ответ зависит от химии
   батарейки (у литиевой кривая разряда почти плоская до конца, у алкалиновой падает
   раньше), поэтому тип мы храним рядом (settings/deviceConfig) и говорим о нём вслух,
   а не подмешиваем в расчёт чужие кривые.

   Замену определяем по подъёму заряда: батарейку не «доливают», и рост на треть шкалы
   разом — это установка новой. Здесь это надёжно, в отличие от резервуара, где скачки
   вверх бывают глюком чтения (см. treatmentStats). */

const ПОДЪЁМ = 30; // на столько процентных пунктов вырос заряд = поставили новую

export interface BatteryRuntime {
  /* Дно шкалы — наименьшее, что помпа показывала ПЕРЕД заменой. Пока замены не
     видели, это не дно, а просто текущий заряд: на трёх днях истории получалось
     «дно 14%», хотя человек до дна ещё не дошёл. Поэтому без цикла — null. */
  floorPct: number | null;
  /** Медиана времени работы после выхода на дно шкалы, часы. */
  medianHours: number | null;
  /** Сколько замен наблюдали — без этого числа медиана не значит ничего. */
  cycles: number;
  /** Часы работы на дне по каждому наблюдённому циклу (для проверки и отладки). */
  samples: number[];
}

export function batteryRuntime(points: DevPoint[]): BatteryRuntime {
  const s = points
    .filter((p) => p.pumpBattery != null)
    .sort((a, b) => a.t - b.t) as (DevPoint & { pumpBattery: number })[];
  if (s.length < 2) return { floorPct: null, medianHours: null, cycles: 0, samples: [] };

  const floorPct = Math.min(...s.map((p) => p.pumpBattery));

  /* Для каждой замены ищем, когда заряд впервые опустился на дно ПЕРЕД ней. Считаем
     от первого касания дна, а не от последнего показания: именно с этого момента
     человек видит «1%» и начинает гадать, сколько осталось. */
  const samples: number[] = [];
  let наДнеС: number | null = null;
  for (let i = 1; i < s.length; i++) {
    const пред = s[i - 1], тек = s[i];
    if (тек.pumpBattery - пред.pumpBattery >= ПОДЪЁМ) {
      if (наДнеС != null) samples.push((пред.t - наДнеС) / 3600e3);
      наДнеС = null;
      continue;
    }
    if (тек.pumpBattery <= floorPct && наДнеС == null) наДнеС = тек.t;
  }

  return {
    floorPct: samples.length ? floorPct : null,
    medianHours: медиана(samples),
    cycles: samples.length,
    samples,
  };
}

function медиана(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type BatteryKind = 'alkaline' | 'lithium' | 'nimh';

export const BATTERY_KINDS: { id: BatteryKind; name: string; note: string }[] = [
  { id: 'alkaline', name: 'Алкалиновая', note: 'заряд падает раньше конца — процент занижает запас' },
  { id: 'lithium', name: 'Литиевая', note: 'кривая почти плоская до конца — процент долго держится высоким' },
  { id: 'nimh', name: 'Аккумулятор (NiMH)', note: 'напряжение ниже щелочной, помпа занижает процент с самого начала' },
];

export const batteryKindName = (k: BatteryKind | null | undefined): string | null =>
  BATTERY_KINDS.find((b) => b.id === k)?.name ?? null;
