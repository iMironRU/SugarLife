/* JS-шим: регистрирует window.SugarLifeBridge поверх нативного Capacitor-плагина SugarLifeBridge.
   Только в нативном хосте. В браузере window.SugarLifeBridge не ставится → getBridge()
   сам подхватит Nightscout-шим. Импортировать РАНО (в main.tsx до рендера).
   ВАЖНО: sendIntent подтверждает лишь приём действия, не выполнение (см. bridge.ts). */
import { registerPlugin, Capacitor } from '@capacitor/core';
import type { SugarLifeBridge, UiSnapshot, Intent, HistoryQuery, HistoryResult } from '../data/bridge';
import { getCfg } from '../data/nightscout';
import { putEntries } from '../data/db';
import { diffBleActivity } from '../data/bleActivity';

/** Тренд движка → NS-направление (для локального Entry). Единый формат для таблицы/графика. */
function trendToDir(t?: string | null): string {
  switch (t) {
    case 'RisingRapidly': return 'DoubleUp';
    case 'Rising': return 'SingleUp';
    case 'RisingSlowly': return 'FortyFiveUp';
    case 'FallingSlowly': return 'FortyFiveDown';
    case 'Falling': return 'SingleDown';
    case 'FallingRapidly': return 'DoubleDown';
    default: return 'Flat';
  }
}

interface NativePlugin {
  requestSnapshot(): Promise<{ json: string }>;
  sendIntent(o: { json: string }): Promise<{ json: string }>;
  query(o: { json: string }): Promise<{ json: string }>;
  addListener(event: 'snapshot', cb: (e: { json: string }) => void): Promise<{ remove: () => void }>;
}

const Native = registerPlugin<NativePlugin>('SugarLifeBridge');

if (Capacitor.isNativePlatform()) {
  const bridge: SugarLifeBridge = {
    bridgeRevision: '1.1',
    subscribe(cb: (s: UiSnapshot) => void): () => void {
      let handle: { remove: () => void } | null = null;
      Native.addListener('snapshot', (e) => cb(JSON.parse(e.json) as UiSnapshot)).then((h) => { handle = h; });
      Native.requestSnapshot().then((r) => cb(JSON.parse(r.json) as UiSnapshot));
      return () => handle?.remove();
    },
    requestSnapshot(): Promise<UiSnapshot> {
      return Native.requestSnapshot().then((r) => JSON.parse(r.json) as UiSnapshot);
    },
    sendIntent(i: Intent) {
      return Native.sendIntent({ json: JSON.stringify(i) }).then((r) => JSON.parse(r.json));
    },
    query(q: HistoryQuery): Promise<HistoryResult> {
      return Native.query({ json: JSON.stringify(q) }).then((r) => JSON.parse(r.json) as HistoryResult);
    },
  };
  window.SugarLifeBridge = bridge;

  // ЕДИНАЯ история: движок — источник правды для глюкозы (сенсор + NS вместе). Синхронизируем его историю в
  // локальную БД (putEntries) → НМГ-таблица/график/строка возраста видят СЕНСОР, а не только NS. Троттлим по
  // снимкам (при новых данных), плюс раз на старте.
  let lastGlucoseSync = 0;
  const syncEngineGlucose = async () => {
    try {
      const now = Date.now();
      const res = await bridge.query?.({ kind: 'Glucose', fromMs: now - 24 * 3600e3, toMs: now });
      if (!res) return;
      const entries = res.glucose
        .filter((g) => g.mmol != null)
        .map((g) => ({ t: g.atMs, mmol: g.mmol as number, mgdl: Math.round((g.mmol as number) * 18), dir: trendToDir(g.trend) }));
      if (entries.length) await putEntries(entries);
    } catch { /* движок ещё не готов — повторим на следующем снимке */ }
  };
  bridge.subscribe((s) => {
    // Ощутимый захват/освобождение BLE: диффим статусы устройств → вибро + баннер на переходах.
    try { diffBleActivity(s.devices || []); } catch { /* без сенсорики не критично */ }
    const now = Date.now();
    if (now - lastGlucoseSync > 12000) { lastGlucoseSync = now; void syncEngineGlucose(); }
  });
  void syncEngineGlucose();

  // Источник правды теперь БД движка: он сам персистит NS-конфиг и переподнимает облачный источник на
  // старте. Здесь — ОДНОРАЗОВАЯ миграция старого localStorage-конфига в БД (для уже настроенных
  // пользователей); дальше движок владеет им сам. При смене NS в UI addCloudSource обновит запись в БД.
  const cfg = getCfg();
  if (cfg?.enabled && cfg.url && !localStorage.getItem('sl-ns-migrated')) {
    void bridge.sendIntent({
      type: 'addCloudSource', url: cfg.url, token: cfg.token || null,
      streams: ['glucose', 'pump', 'treatments'],
    });
    localStorage.setItem('sl-ns-migrated', '1');
  }
}
