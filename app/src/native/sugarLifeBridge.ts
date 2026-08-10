/* JS-шим: регистрирует window.SugarLifeBridge поверх нативного Capacitor-плагина SugarLifeBridge.
   Только в нативном хосте. В браузере window.SugarLifeBridge не ставится → getBridge()
   сам подхватит Nightscout-шим. Импортировать РАНО (в main.tsx до рендера).
   ВАЖНО: sendIntent подтверждает лишь приём действия, не выполнение (см. bridge.ts). */
import { registerPlugin, Capacitor } from '@capacitor/core';
import type { SugarLifeBridge, UiSnapshot, Intent, HistoryQuery, HistoryResult } from '@/sources/bridge';

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
}
