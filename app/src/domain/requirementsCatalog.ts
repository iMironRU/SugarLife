/* Каталог требований (docs/CONNECT-UX.md §7a): «назови устройство → скажем, поддерживаем ли
   и что нужно». Отдельно от каталогов SENSORS/PUMPS (те — для учёта выбранной модели);
   этот — компактный, курируемый, только про совместимость и требования к подключению.
   Данные — из docs/DEVICE-BLE-CATALOG.md (провенанс: Juggluco/rileylink_ios/xDrip+ и т.п.). */
export type Support = 'direct' | 'bridge' | 'blocked';

export interface RequirementEntry {
  id: string;
  name: string;
  brand: string;
  category: 'sensor' | 'pump' | 'meter' | 'pen';
  support: Support;
  requirement: string; // что нужно (человекочитаемо)
}

export const REQUIREMENTS: RequirementEntry[] = [
  { id: 'medtronic-paradigm-5xx-7xx', name: 'Paradigm 5xx/7xx', brand: 'Medtronic', category: 'pump', support: 'bridge', requirement: 'радиомост OrangeLink/RileyLink' },
  { id: 'libre-1', name: 'FreeStyle Libre 1', brand: 'Abbott', category: 'sensor', support: 'bridge', requirement: 'трансмиттер MiaoMiao/Bubble (клеится)' },
  { id: 'libre-2', name: 'FreeStyle Libre 2', brand: 'Abbott', category: 'sensor', support: 'direct', requirement: 'ничего' },
  { id: 'libre-3', name: 'FreeStyle Libre 3', brand: 'Abbott', category: 'sensor', support: 'direct', requirement: 'ничего' },
  { id: 'dexcom-g6', name: 'Dexcom G6', brand: 'Dexcom', category: 'sensor', support: 'direct', requirement: 'ничего' },
  { id: 'dexcom-one', name: 'Dexcom ONE+', brand: 'Dexcom', category: 'sensor', support: 'direct', requirement: 'ничего' },
  { id: 'sibionics-gs1', name: 'Sibionics GS1', brand: 'Sibionics', category: 'sensor', support: 'direct', requirement: 'QR-активация' },
  { id: 'meter-standard', name: 'Contour Next / Accu-Chek / OneTouch', brand: 'разные', category: 'meter', support: 'direct', requirement: 'ничего (стандартный BLE-профиль глюкометра)' },
  { id: 'novopen', name: 'NovoPen 6 / Echo Plus', brand: 'Novo Nordisk', category: 'pen', support: 'direct', requirement: 'NFC-тап после укола' },
  { id: 'inpen', name: 'InPen', brand: 'Medtronic', category: 'pen', support: 'direct', requirement: 'ничего (BLE)' },
  { id: 'omnipod', name: 'Omnipod', brand: 'Insulet', category: 'pump', support: 'blocked', requirement: 'режим управления (мониторинг невозможен)' },
];

export const supportLabel = (s: Support): string =>
  s === 'direct' ? '✓ поддерживаем' : s === 'bridge' ? '✓ через мост' : '⛔ пока не мониторится';

export const categoryLabel = (c: RequirementEntry['category']): string =>
  c === 'sensor' ? 'Сенсор (НМГ)' : c === 'pump' ? 'Ввод инсулина' : c === 'meter' ? 'Глюкометр' : 'Умная ручка';
