/* JS-шим: регистрирует window.SugarLifeBridge поверх нативного Capacitor-плагина SugarLifeBridge.
   Только в нативном хосте. В браузере window.SugarLifeBridge не ставится → getBridge()
   сам подхватит Nightscout-шим. Импортировать РАНО (в main.tsx до рендера).
   ВАЖНО: sendIntent подтверждает лишь приём действия, не выполнение (см. bridge.ts). */
import { registerPlugin, Capacitor } from '@capacitor/core';
import type { SugarLifeBridge, UiSnapshot, Intent, HistoryQuery, HistoryResult } from '@/sources/bridge';
import { getClouds } from '@/sources/clouds';

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

  void передатьОблакаДвижку(bridge);
}

/* Отдать движку облака, которые человек уже настроил в вебе.

   Движок владеет источниками сам и персистит их в свою базу, но узнать про уже
   настроенный Nightscout ему неоткуда: он лежит у нас в localStorage с тех времён,
   когда движка не было. Значит при первом запуске нативной сборки надо его передать —
   иначе человек увидит пустое приложение там, где вчера были данные.

   Три отличия от первой версии этой миграции, и каждое — про реальный случай:

   • Передаём ВСЕ облака, а не основное. У нас их может быть несколько
     (sources/clouds.ts): основной Nightscout плюс зеркало, данные сливаются. getCfg()
     отдаёт только первое, и второй источник не доехал бы никогда.

   • Ключом идемпотентности берём СОДЕРЖИМОЕ, а не факт «когда-либо мигрировали».
     Человек сменил адрес или добавил второе облако — движок должен узнать. Флаг
     «мигрировали» это скрывал бы навсегда.

   • Ключ хранения по нашему шаблону sl.*, и он внесён в список сброса. Прежний
     sl-ns-migrated переживал «сброс локальных данных»: человек сбрасывал, заново вводил
     адрес — а флаг говорил «уже мигрировали», интент не уходил, движок про облако не
     знал. Приложение выглядело настроенным и не показывало ничего. Наш тест полноты
     ключей этого не поймал, потому что ищет ровно sl.* — дефисное имя проскочило мимо. */
const КЛЮЧ_ПЕРЕДАННОГО = 'sl.engine.clouds.v1';

async function передатьОблакаДвижку(bridge: SugarLifeBridge): Promise<void> {
  const облака = getClouds().filter((c) => c.enabled && c.url);
  if (!облака.length) return;

  const отпечаток = JSON.stringify(облака.map((c) => [c.url, c.token ?? '', c.sourceGlucose, c.sourcePumpStatus]));
  try { if (localStorage.getItem(КЛЮЧ_ПЕРЕДАННОГО) === отпечаток) return; } catch { /* ignore */ }

  for (const c of облака) {
    /* Потоки — по тому, что человек включил у этого источника. Зеркало может отдавать
       только глюкозу, и просить у него статус помпы значит получать пустоту вместо
       данных с основного. Лечение берём вместе с глюкозой: отдельного переключателя
       у нас нет, а еда и болюсы приходят тем же потоком. */
    const streams: Array<'glucose' | 'pump' | 'treatments'> = [];
    if (c.sourceGlucose) streams.push('glucose', 'treatments');
    if (c.sourcePumpStatus) streams.push('pump');
    if (!streams.length) continue;
    await bridge.sendIntent({ type: 'addCloudSource', url: c.url, token: c.token || null, streams });
  }
  try { localStorage.setItem(КЛЮЧ_ПЕРЕДАННОГО, отпечаток); } catch { /* ignore */ }
}
