import type { DeviceCatKey } from '../DeviceSection';
import type { DeviceConfig } from '@/settings/deviceConfig';
import type { Age } from '@/domain/treatmentStats';
import { pumpById, sensorById, bridgeById, pumpNeedsBridge } from '@/domain/catalog';
import { isModelKnown, isRecorded } from '@/settings/deviceConfig';

/* Чем этот прибор отличается от остальных — в одном месте (#406).

   В `DeviceSection` было сорок веток `cat === 'pump' ? … : cat === 'sensor' ? …`,
   размазанных по всему файлу: где взять модель, где мост, что писать в подсказке, какие
   расходники считать. Чтобы поправить одно поведение, приходилось держать в голове все
   четыре прибора сразу — а держать их в голове ровно и есть та работа, которую человек
   делает хуже машины.

   Здесь один ответ на вопрос «что значит эта категория». Ветки остались, но собрались:
   их видно списком, и добавление пятого прибора — правка одного файла, а не поиск по
   восьмистам строкам.

   СЛОВ ЗДЕСЬ НЕТ. Подсказка про мост — формулировка, она живёт в слова/приборы.ts
   (#324); отсюда уезжает только факт: нужен мост этой модели или нет. */

export interface ЧтоЗаПрибор {
  /** Есть ли у категории модель из справочника: у глюкометра и петли её нет. */
  естьМодель: boolean;
  modelId: string | null;
  модельИзвестна: boolean;
  /** Прибор записан, но модель не выбрана: мы не знаем, нужен ли ему мост. */
  записанБезМодели: boolean;
  имяМодели: string | null;
  /** Мост показываем, только когда знаем модель: иначе гадали бы за человека. */
  естьМост: boolean;
  bridgeId: string | null;
  имяМостаИзНастроек: string | null;
  /** Нужен ли этой модели мост — факт из справочника, а не наша догадка. */
  мостОбязателен: boolean;
}

export function чтоЗаПрибор(cat: DeviceCatKey, cfg: DeviceConfig): ЧтоЗаПрибор {
  const естьМодель = cat === 'sensor' || cat === 'pump';
  const modelId = cat === 'pump' ? cfg.pumpId : cat === 'sensor' ? cfg.sensorId : null;
  const модельИзвестна = isModelKnown(modelId);
  const записанБезМодели = естьМодель && isRecorded(modelId) && !модельИзвестна;

  const pump = cat === 'pump' ? pumpById(cfg.pumpId) : null;
  const sensor = cat === 'sensor' ? sensorById(cfg.sensorId) : null;
  const bridgeId = cat === 'pump' ? cfg.bridgePumpId : cat === 'sensor' ? cfg.bridgeSensorId : null;

  return {
    естьМодель,
    modelId,
    модельИзвестна,
    записанБезМодели,
    имяМодели: записанБезМодели ? 'не указана'
      : cat === 'pump' ? (pump?.model ?? null) : cat === 'sensor' ? (sensor?.name ?? null) : null,
    естьМост: естьМодель && модельИзвестна,
    bridgeId,
    имяМостаИзНастроек: bridgeById(bridgeId)?.name ?? null,
    мостОбязателен: cat === 'pump' ? pumpNeedsBridge(pump) : !!sensor?.needsBridge,
  };
}

/* Возраст расходника словами: до суток — часы, дальше дни. Точность выше человеку не
   нужна, а «26 ч» вместо «1 дн» заставляет считать в уме. */
export const ageText = (a: Age): string => (a.days >= 1 ? `${a.days} дн` : `${a.hours} ч`);

/* Куда писать выбранное и как назвать модель — тоже по категории (#406).

   Эти три ветки жили в теле экрана и повторялись при каждом обращении: ключ настройки для
   модели, ключ для моста, откуда взять имя. Одна и та же мысль «сенсор или помпа»,
   размноженная по файлу; забыть её в одном месте — значит записать выбор помпы в поле
   сенсора и не заметить.

   Категорий без модели это не касается: у глюкометра и петли выбирать нечего, и функции
   честно отвечают `null`, а не подставляют сенсор по умолчанию. */
export interface КлючиВыбора {
  модель: 'pumpId' | 'sensorId' | null;
  мост: 'bridgePumpId' | 'bridgeSensorId' | null;
}

export function ключиВыбора(cat: DeviceCatKey): КлючиВыбора {
  if (cat === 'pump') return { модель: 'pumpId', мост: 'bridgePumpId' };
  if (cat === 'sensor') return { модель: 'sensorId', мост: 'bridgeSensorId' };
  return { модель: null, мост: null };
}

/** Имя модели по её id — из того справочника, который относится к этой категории. */
export function имяМоделиПоId(cat: DeviceCatKey, id: string): string {
  if (cat === 'pump') return pumpById(id)?.model ?? '';
  if (cat === 'sensor') return sensorById(id)?.name ?? '';
  return '';
}

/** Ключ драйвера выбранной модели: по нему движок понимает, чем её читать. */
export function драйверМодели(cat: DeviceCatKey, id: string): string | null {
  if (cat === 'pump') return pumpById(id)?.driverKey ?? null;
  if (cat === 'sensor') return sensorById(id)?.driverKey ?? null;
  return null;
}
