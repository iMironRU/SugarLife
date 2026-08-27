import type { DeviceCatKey } from '../DeviceSection';
import type { DeviceConfig } from '@/settings/deviceConfig';
import type { Age } from '@/domain/treatmentStats';
import { pumpById, sensorById, bridgeById, pumpNeedsBridge } from '@/domain/catalog';
import { isModelKnown, isRecorded } from '@/settings/deviceConfig';
import type { Consumable } from '@/settings/changes';

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

/* `модель` — уже разрешённый ответ «какая модель выбрана» (domain/реестр.ts, #224):
   сначала движок, потом локальный конфиг. Не передали — читаем локальный сами, чтобы
   вызов без снимка (браузер, тесты) остался осмысленным. */
export function чтоЗаПрибор(
  cat: DeviceCatKey, cfg: DeviceConfig, модель: string | null = null,
): ЧтоЗаПрибор {
  const естьМодель = cat === 'sensor' || cat === 'pump';
  const modelId = модель ?? (cat === 'pump' ? cfg.pumpId : cat === 'sensor' ? cfg.sensorId : null);
  const модельИзвестна = isModelKnown(modelId);
  const записанБезМодели = естьМодель && isRecorded(modelId) && !модельИзвестна;

  const pump = cat === 'pump' ? pumpById(modelId) : null;
  const sensor = cat === 'sensor' ? sensorById(modelId) : null;
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

/* ────────── Продолжение разреза (#406, шаг 2) ──────────

   Ниже — те же ветки `cat === …`, что оставались размазанными по экрану. Каждая из них
   отвечала на вопрос, который к оформлению отношения не имеет: где взять модель этой
   категории, нужен ли ей мост, какие у неё расходники, что она забирает из облака.

   Разрез идёт по КАТЕГОРИЯМ, а не по «компонентам поменьше»: общее — заголовок,
   состояние, действия — остаётся на экране, а сюда уезжает то, чем приборы отличаются.
   Проверить это можно тестом, чего про JSX не скажешь, — и в этом главная выгода
   переноса, а не в числе строк. */

/** Модель этой категории из выбранных. У глюкометра и петли модели нет. */
export function модельКатегории(
  cat: DeviceCatKey, модели: { pumpId: string | null; sensorId: string | null },
): string | null {
  if (cat === 'pump') return модели.pumpId;
  if (cat === 'sensor') return модели.sensorId;
  return null;
}

/* СТОИТ ЛИ ЗА ЭТОЙ КАТЕГОРИЕЙ ЖЕЛЕЗКА В ЭФИРЕ.

   Только у помпы и сенсора: глюкометр вносят руками, петля — чужая программа. От этого
   зависит и мост, и поиск в эфире, и догадка о модели, и раньше вопрос задавался
   четырьмя одинаковыми `cat === 'pump' || cat === 'sensor'` в разных концах файла. */
export function своёЖелезо(cat: DeviceCatKey): cat is 'pump' | 'sensor' {
  return cat === 'pump' || cat === 'sensor';
}

/** Слот моста для этой категории. Для остальных мост не спрашиваем вовсе. */
export function слотМоста(cat: DeviceCatKey): 'pump' | 'sensor' | null {
  return cat === 'pump' ? 'pump' : cat === 'sensor' ? 'sensor' : null;
}

/* РАСХОДНИКИ СО СРОКАМИ.

   Ключ рядом с названием — чтобы отметить замену прямо здесь: событие в Nightscout может
   не появиться вовсе (проверено на живых данных), и тогда возраст врёт молча. */
export function расходники(
  cat: DeviceCatKey, ages: { sensor: Age | null; site: Age | null; reservoir: Age | null; battery: Age | null },
): [string, Age, Consumable][] {
  const пары: [string, Age | null, Consumable][] =
    cat === 'pump'
      ? [['Канюля', ages.site, 'site'], ['Резервуар', ages.reservoir, 'reservoir'], ['Батарея', ages.battery, 'battery']]
      : cat === 'sensor'
      ? [['Датчик', ages.sensor, 'sensor']]
      : [];
  return пары.filter((x): x is [string, Age, Consumable] => !!x[1]);
}

/* ЧТО РЕАЛЬНО ПРИХОДИТ ИЗ ОБЛАКА — честной строкой, а не обещанием.

   Пусто означает «оттуда по этой категории не приходит ничего», и это ответ, а не
   отсутствие ответа: человек видит, что путь настроен, но пуст. */
export function лентаОблака(
  cat: DeviceCatKey,
  прибор: { reservoir?: number | null; pumpBattery?: number | null } | null,
  естьСахар: boolean,
): string | null {
  if (cat === 'pump') {
    return [
      прибор?.reservoir != null ? Math.round(прибор.reservoir) + ' ед' : null,
      прибор?.pumpBattery != null ? прибор.pumpBattery + '%' : null,
    ].filter(Boolean).join(' · ') || null;
  }
  if (cat === 'sensor') return естьСахар ? 'сахар и тренд' : null;
  return null;
}

/** Заголовок шторки выбора модели. Слова здесь, потому что различаются только они. */
export function имяВыбораМодели(cat: DeviceCatKey): string {
  return cat === 'pump' ? 'Выбор помпы' : 'Выбор сенсора';
}
