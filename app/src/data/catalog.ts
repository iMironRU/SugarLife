/* Справочники инсулинов и помп (из inbox: insulins.json + распарсенный pumps.json).
   Только чтение; выбор пользователя хранится в deviceConfig (локально). */
import insulinsData from './catalog/insulins.json';
import pumpsData from './catalog/pumps.json';

export interface Insulin {
  id: string; name: string; inn?: string; manufacturer?: string;
  generation?: string; action_type?: string; status?: string;
  concentrations?: string[]; onset?: string | null; peak?: string | null;
  duration?: string | null; year_label?: string; form?: string; notes?: string;
  region?: string; tags?: string[];
}
export interface Pump {
  id: string; manufacturer: string; model: string; type?: string | null;
  reservoir?: string | null; algorithm?: string | null; cgm?: string | null;
  status?: string | null; statusClass: string; specs?: Record<string, string>;
}

export const INSULINS = (insulinsData as { items: Insulin[] }).items;
export const PUMPS = (pumpsData as { items: Pump[] }).items;

export const insulinById = (id: string | null | undefined): Insulin | null =>
  (id ? INSULINS.find((i) => i.id === id) : null) ?? null;
export const pumpById = (id: string | null | undefined): Pump | null =>
  (id ? PUMPS.find((p) => p.id === id) : null) ?? null;

// быстрые инсулины (болюс/помпа): ультракороткие, короткие, ультрабыстрые
const FAST = new Set(['УКД', 'ультрабыстрый', 'КД']);
export const isFastInsulin = (i: Insulin): boolean => !!i.action_type && FAST.has(i.action_type);
export const isCurrentInsulin = (i: Insulin): boolean => i.status === 'актуальный';
export const isCurrentPump = (p: Pump): boolean => p.statusClass === 'актуальная';

// краткий бренд помпы (без «(бывшая …)»)
export const pumpBrand = (p: Pump): string => p.manufacturer.split(' (')[0];

/* --- Посредники подключения (трансмиттеры/мосты) ---
   Между сенсором/помпой и телефоном часто стоит железка-посредник со своим
   серийником и связью. Держим отдельным узлом (см. вкладку «Мост»). */
export interface Bridge { id: string; name: string; forWhat: string; }
export const BRIDGES: Bridge[] = [
  { id: 'riley-link', name: 'RileyLink', forWhat: 'Medtronic по радио (916/868 МГц)' },
  { id: 'orange-link', name: 'OrangeLink', forWhat: 'Medtronic по радио' },
  { id: 'emalink', name: 'EmaLink', forWhat: 'Medtronic по радио' },
  { id: 'miaomiao', name: 'MiaoMiao', forWhat: 'Libre 1 → BLE' },
  { id: 'bubble', name: 'Bubble', forWhat: 'Libre 1 → BLE' },
  { id: 'blucon', name: 'Blucon (NightRider)', forWhat: 'Libre 1 → BLE' },
  { id: 'other', name: 'Другой', forWhat: '' },
];
export const bridgeById = (id: string | null | undefined): Bridge | null =>
  (id ? BRIDGES.find((b) => b.id === id) : null) ?? null;

/* --- Сенсоры НМГ (минимальный список; полного справочника пока нет) ---
   needsBridge — сенсор сам не вещает BLE, нужен посредник (Libre 1). */
export interface Sensor { id: string; name: string; brand: string; needsBridge: boolean; current: boolean; }
export const SENSORS: Sensor[] = [
  { id: 'dexcom-g7', name: 'Dexcom G7', brand: 'Dexcom', needsBridge: false, current: true },
  { id: 'dexcom-g6', name: 'Dexcom G6', brand: 'Dexcom', needsBridge: false, current: true },
  { id: 'libre-3', name: 'FreeStyle Libre 3', brand: 'Abbott', needsBridge: false, current: true },
  { id: 'libre-2', name: 'FreeStyle Libre 2', brand: 'Abbott', needsBridge: false, current: true },
  { id: 'libre-1', name: 'FreeStyle Libre 1', brand: 'Abbott', needsBridge: true, current: false },
  { id: 'guardian-4', name: 'Guardian 4', brand: 'Medtronic', needsBridge: false, current: true },
  { id: 'simplera', name: 'Simplera Sync', brand: 'Medtronic', needsBridge: false, current: true },
  { id: 'dexcom-one', name: 'Dexcom ONE+', brand: 'Dexcom', needsBridge: false, current: true },
];
export const sensorById = (id: string | null | undefined): Sensor | null =>
  (id ? SENSORS.find((s) => s.id === id) : null) ?? null;

// Помпе может требоваться радио-мост (старые Medtronic Paradigm/5xx/7xx).
export const pumpNeedsBridge = (p: Pump | null): boolean => {
  if (!p) return false;
  const m = p.model.toLowerCase();
  const medtronic = /minimed|medtronic|paradigm/.test(p.manufacturer.toLowerCase()) || /paradigm|veo|revel/.test(m);
  return medtronic && /paradigm|veo|revel|\b5\d\d\b|\b7\d\d\b|508|507|506/.test(m);
};
