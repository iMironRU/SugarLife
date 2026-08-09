/* Состояние обновления веб-версии (PWA).

   Раньше «есть ли обновление» узнавалось только нажатием кнопки, а результат
   («перезагрузится или нет», «применилось или нет») человеку не сообщался.
   Теперь наличие обновления — это СОСТОЯНИЕ: приложение слушает service worker
   и знает ответ постоянно, а кнопка лишь применяет уже известное.

   Проверяем в фоне: при запуске, при возврате из фона и раз в час — чтобы
   «актуально» означало «только что проверено», а не «когда-то спрашивали». */
import { useSyncExternalStore } from 'react';
import { APP_BUILD, isNative } from './appUpdate';

/* 'unsupported' — воркера нет вовсе (dev-сборка, приватный режим, отключён в браузере).
   Без этого состояния подпись навсегда зависала на «Проверяю…» и врала. */
export type UpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'error' | 'unsupported';

export interface UpdateState {
  status: UpdateStatus;
  checkedAt: number | null;  // когда последний раз реально проверяли
  applying: boolean;         // идёт применение — дальше будет перезагрузка
}

const JUST_UPDATED = 'sl.justUpdated.v1';
const HOUR = 3600e3;

let state: UpdateState = { status: 'idle', checkedAt: null, applying: false };
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
export function consumeJustUpdated(): boolean {
  try {
    const from = localStorage.getItem(JUST_UPDATED);
    if (!from) return false;
    localStorage.removeItem(JUST_UPDATED);
    return from !== APP_BUILD; // сборка действительно сменилась
  } catch { return false; }
}

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
  if (!('serviceWorker' in navigator)) { set({ status: 'unsupported' }); return; }
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
    if (res === timedOut) { set({ status: 'error' }); return; }
    if (res === 'none') { set({ status: 'unsupported' }); return; }
    set({ status: hasWaiting() ? 'available' : 'current', checkedAt: Date.now() });
  } catch {
    // офлайн и «обновлений нет» — разные вещи, не выдаём одно за другое
    set({ status: 'error' });
  } finally {
    checking = false;
  }
}

/* Применить: разбудить ждущий воркер и перезагрузиться, когда он возьмёт управление.
   Перезагрузка ЯВНАЯ и только по кнопке — в медицинском приложении дёргать экран
   под человеком нельзя. */
export function applyUpdate(): void {
  if (!reg?.waiting) { location.reload(); return; }
  set({ applying: true });
  try { localStorage.setItem(JUST_UPDATED, APP_BUILD); } catch { /* ignore */ }
  let reloaded = false;
  const go = () => { if (!reloaded) { reloaded = true; location.reload(); } };
  navigator.serviceWorker.addEventListener('controllerchange', go, { once: true });
  reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  window.setTimeout(go, 3000); // страховка, если controllerchange не придёт
}

function start(): void {
  if (started || isNative) return;
  if (!('serviceWorker' in navigator)) { set({ status: 'unsupported' }); return; }
  started = true;
  navigator.serviceWorker.getRegistration().then((r) => {
    if (!r) { set({ status: 'unsupported' }); return; }
    watch(r);
    checkNow();
  });
  // возврат из фона и раз в час — чтобы состояние не устаревало
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - (state.checkedAt ?? 0) > 5 * 60e3) checkNow();
  });
  window.setInterval(checkNow, HOUR);
}
