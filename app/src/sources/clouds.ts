/* Список облачных источников (docs/CONNECT-UX.md §2b: сервис — такой же способ подключения,
   как мост, просто со своими настройками и статусом). Раньше был один глобальный конфиг
   (sl.ns.cfg) — теперь список, поддерживающий несколько облаков одновременно (например,
   два Nightscout: свой и партнёра). getCfg()/setCfg() в nightscout.ts остаются шимом над
   «основным» облаком, чтобы старые места использования не пришлось переписывать. */
import { useSyncExternalStore } from 'react';
import { прочитатьJson, записатьJson } from '@/settings/storage';

export interface CloudConfig {
  id: string;
  kind: 'nightscout';
  name: string; // как называть в списке — обычно хост, можно переименовать
  url: string;
  token?: string;
  enabled: boolean;
  // «Забираем отсюда» (§2b): какие роли обслуживает этот источник. Ни одной включённой —
  // облако подключено, но ничего не отдаёт; честно показываем такое состояние в UI, не скрываем.
  sourceGlucose: boolean;
  sourcePumpStatus: boolean;
}

const KEY = 'sl.clouds.v1';
const LEGACY_KEY = 'sl.ns.cfg';

function genId(): string {
  return 'c' + Math.random().toString(36).slice(2, 10);
}

function hostLabel(url: string): string {
  try { return new URL(url).host || url; } catch { return url || 'Nightscout'; }
}

function migrateLegacy(): CloudConfig[] {
  const legacy = прочитатьJson<{ url?: string; token?: string; enabled?: boolean } | null>(LEGACY_KEY, null);
  if (legacy && legacy.url) {
    return [{
      id: genId(), kind: 'nightscout', name: hostLabel(legacy.url),
      url: legacy.url, token: legacy.token || '', enabled: !!legacy.enabled,
      sourceGlucose: true, sourcePumpStatus: true,
    }];
  }
  return [];
}

function load(): CloudConfig[] {
  const свои = прочитатьJson<CloudConfig[] | null>(KEY, null);
  if (свои) return свои;
  const migrated = migrateLegacy();
  if (migrated.length) save(migrated);
  return migrated;
}

function save(list: CloudConfig[]) {
  записатьJson(KEY, list);
}

let state: CloudConfig[] = load();
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }

export function getClouds(): CloudConfig[] { return state; }

export function setClouds(list: CloudConfig[]) {
  state = list;
  save(state);
  emit();
}

export function addCloud(patch: Omit<CloudConfig, 'id'>): CloudConfig {
  const c: CloudConfig = { ...patch, id: genId() };
  setClouds([...state, c]);
  return c;
}

export function updateCloud(id: string, patch: Partial<CloudConfig>) {
  setClouds(state.map((c) => (c.id === id ? { ...c, ...patch } : c)));
}

export function removeCloud(id: string) {
  setClouds(state.filter((c) => c.id !== id));
}

// «Основное» облако — первое включённое, иначе первое в списке. Нужно только для обратной
// совместимости со старым односвязным API (getCfg/setCfg в nightscout.ts).
export function primaryCloud(): CloudConfig | null {
  return state.find((c) => c.enabled) ?? state[0] ?? null;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export function useClouds(): CloudConfig[] {
  return useSyncExternalStore(subscribe, getClouds, getClouds);
}
