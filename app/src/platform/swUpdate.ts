/* Состояние обновления веб-версии (PWA).

   Раньше «есть ли обновление» узнавалось только нажатием кнопки, а результат
   («перезагрузится или нет», «применилось или нет») человеку не сообщался.
   Теперь наличие обновления — это СОСТОЯНИЕ: приложение слушает service worker
   и знает ответ постоянно, а кнопка лишь применяет уже известное.

   Проверяем в фоне: при запуске, при возврате из фона и раз в час — чтобы
   «актуально» означало «только что проверено», а не «когда-то спрашивали». */
import { useSyncExternalStore } from 'react';
import { прочитать, записать, убрать } from '@/settings/storage';
import { APP_BUILD, isNative, спроситьСервер } from './appUpdate';
import { отсталиЛи, ключОтказа, КЛЮЧ_ОТКАЗА } from './отставание';
import { этоНашПерезапуск } from '@/app/местоStore';

/* 'unsupported' — воркера нет вовсе (dev-сборка, приватный режим, отключён в браузере).
   Без этого состояния подпись навсегда зависала на «Проверяю…» и врала. */
export type UpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'error' | 'unsupported';

export interface UpdateState {
  status: UpdateStatus;
  checkedAt: number | null;  // когда последний раз реально проверяли
  applying: boolean;         // идёт применение — дальше будет перезагрузка
  /* Что выложено на сервере, по манифесту (#386). Второй, независимый от воркера
     источник правды: он отвечает на вопрос «я отстал?» даже когда цепочка service
     worker'а по любой причине молчит. null — не спрашивали или не ответили. */
  serverBuild: string | null;
  /* Отстали, но ждущего воркера нет. Значит обычная кнопка «Обновить» ничего не
     переключит — нужен путь пожёстче (перечитатьВсё). */
  застряли: boolean;
}

const JUST_UPDATED = 'sl.justUpdated.v1';
const HOUR = 3600e3;

let state: UpdateState = { status: 'idle', checkedAt: null, applying: false, serverBuild: null, застряли: false };
const subs = new Set<() => void>();
let reg: ServiceWorkerRegistration | null = null;
let started = false;

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

export function getUpdateState(): UpdateState { return state; }
export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); start(); return () => { subs.delete(cb); }; },
    getUpdateState, getUpdateState,
  );
}

/* «Мы только что обновились до X» — сообщение должно пережить перезагрузку,
   иначе человек не узнает, применилось ли: перезагрузка стирает всё на экране. */
function consumeJustUpdated(): boolean {
  const from = прочитать(JUST_UPDATED);
  if (!from) return false;
  убрать(JUST_UPDATED);
  return from !== APP_BUILD; // сборка действительно сменилась
}

/* Читается ОДИН раз при загрузке модуля, а не по запросу (#398).

   Отметка одноразовая, и если её забирают два экрана, победит тот, кто открылся первым, —
   второй решит, что ничего не было. Раньше её забирал только экран «О приложении», то
   есть человек, применивший обновление с «Сегодня», не узнавал о результате вовсе, а
   отметка оставалась лежать и заставляла заставку врать «Обновляюсь…» при каждом
   следующем запуске.

   Тот же приём, что у нативной половины (platform/appUpdate.ts, ПРИЕХАЛО_ПРИ_СТАРТЕ):
   одноразовый флаг превращается в обычное значение, которое читают все и сколько угодно. */
export const ОБНОВИЛИСЬ_ПРИ_СТАРТЕ = consumeJustUpdated();

// Ждущий воркер = новая версия скачана и готова, нужен только наш сигнал.
function hasWaiting(): boolean {
  return !!reg?.waiting && !!navigator.serviceWorker?.controller;
}

function watch(r: ServiceWorkerRegistration) {
  reg = r;
  if (hasWaiting()) set({ status: 'available' });
  r.addEventListener('updatefound', () => {
    const sw = r.installing;
    if (!sw) return;
    sw.addEventListener('statechange', () => {
      // installed + есть контроллер = это ОБНОВЛЕНИЕ, а не первая установка
      if (sw.state === 'installed' && navigator.serviceWorker.controller) set({ status: 'available' });
    });
  });
}

let checking = false;

/* Таймаут обязателен: registration.update() при плохой сети может не завершиться
   вообще, и состояние навсегда застревало на «Проверяю…» — крутилка висела
   бесконечно. Спиннер без предела хуже честной ошибки. */
const CHECK_TIMEOUT = 8000;

export async function checkNow(): Promise<void> {
  if (isNative) return;
  if (!('serviceWorker' in navigator)) { set({ status: 'unsupported' }); await спроситьМанифест(); return; }
  if (checking) return; // не копим параллельные проверки (фон + кнопка)
  checking = true;
  set({ status: 'checking' });
  try {
    // Таймаут на ВСЮ операцию: зависнуть может и getRegistration(), не только update()
    const timedOut = Symbol('timeout');
    const work = (async () => {
      const r = reg ?? (await navigator.serviceWorker.getRegistration()) ?? null;
      if (!r) return 'none' as const;
      if (!reg) watch(r);
      await r.update();
      return 'ok' as const;
    })();
    const res = await Promise.race([
      work,
      new Promise((resolve) => setTimeout(() => resolve(timedOut), CHECK_TIMEOUT)),
    ]);
    if (res === timedOut) { set({ status: 'error' }); await спроситьМанифест(); return; }
    if (res === 'none') { set({ status: 'unsupported' }); await спроситьМанифест(); return; }
    set({ status: hasWaiting() ? 'available' : 'current', checkedAt: Date.now() });
    await спроситьМанифест();
  } catch {
    // офлайн и «обновлений нет» — разные вещи, не выдаём одно за другое
    set({ status: 'error' });
    await спроситьМанифест();
  } finally {
    checking = false;
  }
}

/* Спросить сервер напрямую — и в успехе, и в неудаче проверки воркера (#386).

   Именно неудача важнее всего: пока «не смог спросить воркера» означало конец разговора,
   застрявшее приложение выглядело точно так же, как свежее. Манифест весит 115 байт и
   идёт мимо всех кэшей, поэтому спрашиваем его в любом случае. */
async function спроситьМанифест(): Promise<void> {
  const б = await спроситьСервер();
  const наСервере = б === 'нет' ? APP_BUILD : (б === 'ошибка' ? null : б.build);
  set({
    serverBuild: наСервере,
    застряли: отсталиЛи(APP_BUILD, наСервере) && !hasWaiting(),
    checkedAt: наСервере ? Date.now() : state.checkedAt,
  });
}

/* Выход из тупика: снести воркера и кэши и загрузиться заново (#386).

   Обычный путь — разбудить ждущего воркера — работает, только если он есть. А человек
   может оказаться там, где его нет: сборка на телефоне отстала на две версии, новая
   лежит на сервере, и ни одна кнопка в приложении её оттуда не достаёт. Тогда единственно
   честный ответ — перестать доверять сохранённой оболочке и взять всё заново.

   ТОЛЬКО когда мы ТОЛЬКО ЧТО достучались до сервера. Снести оболочку офлайн значило бы
   собственными руками сделать тот самый белый экран, от которого она и спасает: назад бы
   уже ничего не загрузилось. Поэтому зовётся это лишь из состояния «застряли», а оно
   выставляется по успешному ответу манифеста. */
export async function перечитатьВсё(): Promise<void> {
  этоНашПерезапуск();
  set({ applying: true });
  {
    записать(JUST_UPDATED, APP_BUILD);
    /* Одна попытка на релиз, а не бесконечная просьба.

       Если после перезагрузки сборка осталась прежней — значит помогло не это, и
       повторять предложение бессмысленно: человек будет жать одну и ту же кнопку с
       одним и тем же исходом. Ставим ту же отметку, что и «Потом»: сменится сборка
       (у нас или на сервере) — предложение вернётся само. */
    записать(КЛЮЧ_ОТКАЗА, ключОтказа(APP_BUILD, state.serverBuild));
  }
  try {
    const рег = await navigator.serviceWorker.getRegistrations();
    await Promise.all(рег.map((r) => r.unregister()));
    if ('caches' in window) {
      const имена = await caches.keys();
      await Promise.all(имена.map((k) => caches.delete(k)));
    }
  } catch { /* не смогли убрать — перезагрузимся как есть, хуже не станет */ }
  location.reload();
}

/* Применить: разбудить ждущий воркер и перезагрузиться, когда он возьмёт управление.
   Перезагрузка ЯВНАЯ и только по кнопке — в медицинском приложении дёргать экран
   под человеком нельзя. */
export function applyUpdate(): void {
  /* Помечаем перезапуск своим — тогда после перезагрузки человек вернётся туда, где
     был, а не на «Сегодня» (#400). Ставим ДО reload в обеих ветках: ветка без ждущего
     воркера тоже перезагружает, и терять место там ровно так же неприятно. */
  этоНашПерезапуск();
  if (!reg?.waiting) { location.reload(); return; }
  set({ applying: true });
  записать(JUST_UPDATED, APP_BUILD);
  let reloaded = false;
  const go = () => { if (!reloaded) { reloaded = true; location.reload(); } };
  navigator.serviceWorker.addEventListener('controllerchange', go, { once: true });
  reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  window.setTimeout(go, 3000); // страховка, если controllerchange не придёт
}

function start(): void {
  if (started || isNative) return;
  if (!('serviceWorker' in navigator)) { set({ status: 'unsupported' }); void спроситьМанифест(); return; }
  started = true;
  /* Спросить сервер СРАЗУ и отдельно от воркера (#386).

     Дальше идут четыре ветки, и в трёх из них разговор раньше заканчивался молчанием:
     воркера нет и зарегистрировать не вышло, регистрация упала, браузер его не даёт.
     Каждая означает «механика доставки сломана» — то есть ровно тот случай, когда
     человек и застревает на старой сборке. Отвечать на это молчанием нельзя: вопрос
     «я отстал?» решается сравнением двух строк и одним запросом на 115 байт, и он не
     обязан зависеть от того, работает ли service worker. */
  void спроситьМанифест();
  navigator.serviceWorker.getRegistration().then(async (r) => {
    /* Воркера нет — РЕГИСТРИРУЕМ САМИ, а не объявляем «не поддерживается» (#359).

       Штатная регистрация висит на событии `load`: ушёл человек со страницы раньше,
       чем она догрузилась на плохой связи, — и воркер не встал. А значит следующий
       запуск снова пойдёт в сеть, и снова на плохой связи, и снова ни с чем. Дыра
       ровно там, где болит: у того, у кого связь плохая.

       Путь до файла берём от текущей страницы: у веб-сборки приложение живёт в
       подпапке, и корневой '/sw.js' там не существует. */
    if (!r) {
      try {
        const свой = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href);
        watch(свой); checkNow(); return;
      } catch {
        set({ status: 'unsupported' }); return;
      }
    }
    watch(r);
    checkNow();
  });
  // возврат из фона и раз в час — чтобы состояние не устаревало
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - (state.checkedAt ?? 0) > 5 * 60e3) checkNow();
  });
  window.setInterval(checkNow, HOUR);
}
