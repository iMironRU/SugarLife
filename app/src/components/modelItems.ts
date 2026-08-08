/* Готовые списки для CatalogPicker: модели помп/сенсоров и мосты.
   Один источник на всё приложение — и карточка устройства, и мастер первого запуска
   показывают одинаковый список в одинаковом порядке. Раньше он собирался в двух местах
   и успел разъехаться (в одном помпы сортировались по бренду, в другом нет). */
import { type PickerItem } from './CatalogPicker';
import {
  PUMPS, SENSORS, BRIDGES, INSULINS, pumpById, sensorById, pumpBrand,
  isCurrentPump, isFastInsulin, isCurrentInsulin,
} from '../data/catalog';
import { UNKNOWN_MODEL, isModelKnown } from '../data/deviceConfig';

/* «Не знаю модель» — полноценный выбор, а не отказ (docs/CONNECT-UX.md §2b):
   запись в реестре появляется, данные из облака идут, модель уточняется позже. */
const unknownModelItem: PickerItem = {
  id: UNKNOWN_MODEL,
  title: 'Не знаю модель',
  subtitle: 'запишем устройство, данные пойдут через облако',
  current: true,
};

export const pumpItems: PickerItem[] = [unknownModelItem, ...PUMPS
  .map((p) => ({ id: p.id, title: p.model, subtitle: pumpBrand(p), meta: p.reservoir || '', current: isCurrentPump(p) }))
  .sort((a, b) => Number(b.current) - Number(a.current) || a.subtitle.localeCompare(b.subtitle) || a.title.localeCompare(b.title))];

export const sensorItems: PickerItem[] = [unknownModelItem, ...SENSORS
  .map((s) => ({ id: s.id, title: s.name, subtitle: s.brand, meta: s.needsBridge ? 'нужен мост' : '', current: s.current }))
  .sort((a, b) => Number(b.current) - Number(a.current) || a.title.localeCompare(b.title))];

export const bridgeItems: PickerItem[] = BRIDGES.map((b) => ({ id: b.id, title: b.name, subtitle: b.forWhat, current: true }));

/* Инсулин помпы. В помпе он ОДИН быстрый — идёт и на базал, и на болюс, поэтому
   «актуальными» считаем только быстрые. Живёт здесь же: это атрибут помпы, а список
   должен быть один на приложение. */
export const insulinItems: PickerItem[] = INSULINS
  .map((i) => ({
    id: i.id, title: i.name,
    subtitle: [i.action_type, i.manufacturer].filter(Boolean).join(' · '),
    meta: (i.concentrations || []).join('/'),
    current: isFastInsulin(i) && isCurrentInsulin(i),
  }))
  .sort((a, b) => Number(b.current) - Number(a.current) || a.title.localeCompare(b.title));

export const modelItems = (cat: 'pump' | 'sensor'): PickerItem[] => (cat === 'pump' ? pumpItems : sensorItems);

/* Как назвать выбранную модель в строке. Три состояния записи (§2b) — три подписи;
   fallback нужен для id, которого больше нет в справочнике (устарел/переименован). */
export function modelTitle(cat: 'pump' | 'sensor', id: string | null): string | null {
  if (id == null) return null;
  if (!isModelKnown(id)) return cat === 'pump' ? 'помпа · модель не указана' : 'сенсор · модель не указана';
  const name = cat === 'pump' ? pumpById(id)?.model : sensorById(id)?.name;
  return name ?? 'модель не из справочника';
}
