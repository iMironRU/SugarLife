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
