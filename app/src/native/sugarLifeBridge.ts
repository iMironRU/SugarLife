/* JS-шим: регистрирует window.SugarLifeBridge поверх нативного Capacitor-плагина SugarLifeBridge.
   Только в нативном хосте. В браузере window.SugarLifeBridge не ставится → getBridge()
   сам подхватит Nightscout-шим. Импортировать РАНО (в main.tsx до рендера).
   ВАЖНО: sendIntent подтверждает лишь приём действия, не выполнение (см. bridge.ts). */
import { registerPlugin, Capacitor } from '@capacitor/core';
import type { SugarLifeBridge, UiSnapshot, Intent, HistoryQuery, HistoryResult } from '@/sources/bridge';
import { getCfg } from '@/sources/nightscout';

interface NativePlugin {
  requestSnapshot(): Promise<{ json: string }>;
  sendIntent(o: { json: string }): Promise<{ json: string }>;
  query(o: { json: string }): Promise<{ json: string }>;
  addListener(event: 'snapshot', cb: (e: { json: string }) => void): Promise<{ remove: () => void }>;
}

const Native = registerPlugin<NativePlugin>('SugarLifeBridge');

/* Ревизию НЕ прописываем числом. Этот файл — прозрачная передача JSON туда-обратно,
   собственной версии у него нет: настоящую ревизию знает движок и сообщает её в каждом
   снимке. Раньше здесь стояло '1.1' намертво, и это было прямое враньё — движок к тому
   моменту ушёл на 1.7. Хуже того, по этому числу getBridge решает, совместим ли мост:
   застрявшая цифра однажды пропустила бы несовместимый мост или отвергла бы годный.

   До первого снимка отвечаем той ревизией, которую выражают наши типы, — иначе мост
   был бы отвергнут ровно в тот момент, когда его впервые спрашивают. */
const ОЖИДАЕМАЯ = '1.7';
let ревизия = ОЖИДАЕМАЯ;
const принять = (json: string): UiSnapshot => {
  const s = JSON.parse(json) as UiSnapshot;
  if (s.bridgeRevision) ревизия = s.bridgeRevision;
  return s;
};

if (Capacitor.isNativePlatform()) {
  const bridge: SugarLifeBridge = {
    get bridgeRevision() { return ревизия; },
    subscribe(cb: (s: UiSnapshot) => void): () => void {
      let handle: { remove: () => void } | null = null;
      Native.addListener('snapshot', (e) => cb(принять(e.json))).then((h) => { handle = h; });
      Native.requestSnapshot().then((r) => cb(принять(r.json)));
      return () => handle?.remove();
    },
    requestSnapshot(): Promise<UiSnapshot> {
      return Native.requestSnapshot().then((r) => принять(r.json));
    },
    sendIntent(i: Intent) {
      return Native.sendIntent({ json: JSON.stringify(i) }).then((r) => JSON.parse(r.json));
    },
    query(q: HistoryQuery): Promise<HistoryResult> {
      return Native.query({ json: JSON.stringify(q) }).then((r) => JSON.parse(r.json) as HistoryResult);
    },
  };
  window.SugarLifeBridge = bridge;

  // Миграция NS-конфига из localStorage в движок: движок сам поднимет облачный источник (glucose/pump/
  // treatments) и его снимок понесёт реальные данные — тогда getBridge отдаёт нативный движок, а не NS-шим.
  // Идемпотентно по флагу. (Дальше движок владеет NS сам, персистит в свою БД.)
  const cfg = getCfg();
  if (cfg?.enabled && cfg.url && !localStorage.getItem('sl-ns-migrated')) {
    void bridge.sendIntent({
      type: 'addCloudSource', url: cfg.url, token: cfg.token || null,
      streams: ['glucose', 'pump', 'treatments'],
    });
    localStorage.setItem('sl-ns-migrated', '1');
  }
}
