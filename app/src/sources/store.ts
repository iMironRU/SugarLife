/* Стор живых данных: initial по REST → живые апдейты по Socket.IO, поллинг (REST) —
   страховка на случай обрыва сокета/CORS. Кэш в localStorage (офлайн).
   Несколько облаков (data/clouds.ts) — данные сливаются честно, без выдумывания:
   глюкоза — объединение всех источников с sourceGlucose (дедуп по времени, это же
   схлопывает дублирующие показания от двух зеркал одного Nightscout); статус помпы —
   от первого источника с sourcePumpStatus, у которого он реально есть; лечение —
   объединение всех источников (аддитивно, дедуп по времени+типу). Без конфига —
   данных нет, экраны показывают демо. */
import { useSyncExternalStore } from 'react';
import { прочитатьJson, записатьJson } from '@/settings/storage';
import { loadAll, checkWrite, mergeDevice, type NsData, type Entry, type Treatment, type Device } from './nightscout';
import { getClouds, type CloudConfig } from './clouds';
import { connectSocket, disconnectSocket, type SocketData } from './nsSocket';
import { putEntries, putTreatments } from './db';
import { backfill, backfillTreatments } from './backfill';

const CACHE_KEY = 'sl.ns.cache.v1';
const POLL_MS = 60000;

export type Status = 'idle' | 'off' | 'loading' | 'ok' | 'stale' | 'error';
export interface StoreState {
  data: (NsData & { latest: Entry | null; updatedAt: number }) | null;
  status: Status;
  error: string | null;
  live: boolean; // хотя бы один сокет подключён
  writable: boolean; // токен основного облака даёт право записи (еда/болюсы)
}

let state: StoreState = { data: null, status: 'idle', error: null, live: false, writable: false };
const listeners = new Set<() => void>();
let inflight = false;
let started = false;
const socketIds = new Set<string>();
const liveByCloud = new Map<string, boolean>();
let writeCheckedKey: string | undefined | null = null; // null = ещё не проверяли

function emit() { for (const l of listeners) l(); }
function set(patch: Partial<StoreState>) { state = { ...state, ...patch }; emit(); }

function loadCache() {
  // Без настроенного источника кэш не поднимаем вовсе — иначе на старте успевал
  // мелькнуть экран со старыми цифрами, пока refresh не сотрёт их
  if (!getClouds().some((c) => c.enabled && c.url)) return;
  const c = прочитатьJson<{ entries?: unknown } | null>(CACHE_KEY, null);
  if (c && c.entries) set({ data: c as StoreState['data'], status: 'stale' });
}
/* Кэш пишем не чаще раза в полминуты. Он нужен, чтобы при следующем запуске экран
   не был пустым, — для этого достаточно «примерно последнего» состояния. Раньше
   писался на каждое сообщение сокета: сериализация 288 измерений и 200 событий
   несколько раз в минуту ради данных, которые прочитают один раз при старте. */
let cacheAt = 0;
function saveCache(force = false) {
  const now = Date.now();
  if (!force && now - cacheAt < 30000) return;
  cacheAt = now;
  записатьJson(CACHE_KEY, state.data);
}

function emptyData(): NsData & { latest: Entry | null; updatedAt: number } {
  return { entries: [], device: null, profile: null, treatments: [], latest: null, updatedAt: 0 };
}

// --- слияние дельт из сокета конкретного облака ---
function mergeSocket(cloud: CloudConfig, d: SocketData) {
  const cur = state.data || emptyData();
  let entries = cur.entries;
  if (cloud.sourceGlucose && d.entries && d.entries.length) {
    const map = new Map<number, Entry>(cur.entries.map((e) => [e.t, e]));
    for (const e of d.entries) map.set(e.t, e);
    entries = [...map.values()].sort((a, b) => a.t - b.t).slice(-288);
  }
  let treatments = cur.treatments || [];
  if (d.treatments && d.treatments.length) {
    const key = (x: Treatment) => x.t + '|' + x.type;
    const map = new Map<string, Treatment>((cur.treatments || []).map((x) => [key(x), x]));
    for (const x of d.treatments) map.set(key(x), x);
    treatments = [...map.values()].sort((a, b) => a.t - b.t).slice(-200);
  }
  /* Подмешиваем, а не подменяем. Дельта сокета обычно несёт один документ
     devicestatus, и если он короткий (только помпа), то активного инсулина в нём
     нет — прежняя замена целиком стирала его из круга до следующего цикла.
     mergeDevice сам отбросит устаревшее: слишком старые показатели не всплывут. */
  const device: Device | null = (cloud.sourcePumpStatus && d.device !== undefined)
    ? mergeDevice(cur.device, d.device)
    : cur.device;
  const latest = entries.length ? entries[entries.length - 1] : cur.latest;
  set({ data: { ...cur, entries, treatments, device, latest, updatedAt: Date.now() }, status: 'ok', error: null });
  saveCache();
  if (cloud.sourceGlucose && d.entries && d.entries.length) putEntries(d.entries);
  if (d.treatments && d.treatments.length) putTreatments(d.treatments);
}

// подключить/переподключить/отключить сокеты по списку включённых облаков
function ensureSockets(clouds: CloudConfig[]) {
  const wantIds = new Set(clouds.map((c) => c.id));
  for (const id of [...socketIds]) {
    if (!wantIds.has(id)) { disconnectSocket(id); socketIds.delete(id); liveByCloud.delete(id); }
  }
  for (const cloud of clouds) {
    if (!socketIds.has(cloud.id)) {
      socketIds.add(cloud.id);
      connectSocket(cloud.id, cloud.url, cloud.token, (d) => mergeSocket(cloud, d), (connected) => {
        liveByCloud.set(cloud.id, connected);
        set({ live: [...liveByCloud.values()].some(Boolean) });
      });
    }
  }
  if (!clouds.length) set({ live: false });
}

// Проверка права записи — пока только для основного (первого включённого) облака:
// выгрузка (запись) в конкретное облако ещё не сделана, это отдельная задача.
function ensureWriteCheck(primary: CloudConfig | null) {
  const key = primary ? primary.id + '|' + (primary.token || '') : undefined;
  if (key === writeCheckedKey) return;
  writeCheckedKey = key;
  if (!primary) { set({ writable: false }); return; }
  checkWrite(primary.url, primary.token).then((w) => {
    if (writeCheckedKey === key) set({ writable: w });
  }).catch(() => { if (writeCheckedKey === key) set({ writable: false }); });
}

export async function refresh() {
  const clouds = getClouds().filter((c) => c.enabled && c.url);
  ensureSockets(clouds);
  ensureWriteCheck(clouds[0] ?? null);
  if (inflight) return;
  /* Источника нет — показывать нечего. Данные из кэша тут обнуляем намеренно: иначе
     экран рисовал живой на вид сахар и график помпы, а рядом висел баннер «приложение
     не настроено». В медицинском приложении это худший вид вранья — цифры выглядят
     текущими, хотя обновляться им неоткуда.

     Обрыва связи это не касается: при нём статус 'stale'/'error', и последние
     известные значения остаются на месте с пометкой давности — это как раз то, что
     ночью может быть важнее всего. Разница принципиальная: 'off' — источник не
     настроен вовсе, 'stale' — настроен, но сейчас молчит.

     Сама история в IndexedDB не трогается: подключат облако — всё вернётся. */
  if (!clouds.length) { set({ data: null, status: 'off', error: null, writable: false }); return; }
  inflight = true;
  if (!state.data) set({ status: 'loading' });
  try {
    const settled = await Promise.allSettled(
      clouds.map(async (cloud) => ({ cloud, data: await loadAll({ url: cloud.url, token: cloud.token, enabled: true }) })),
    );
    const oks = settled
      .filter((r): r is PromiseFulfilledResult<{ cloud: CloudConfig; data: NsData }> => r.status === 'fulfilled')
      .map((r) => r.value);
    if (!oks.length) throw new Error('Все облака недоступны');

    // глюкоза: источники с sourceGlucose, дедуп по времени показания
    const glucoseSources = oks.filter((o) => o.cloud.sourceGlucose);
    const entryMap = new Map<number, Entry>();
    for (const o of glucoseSources) for (const e of o.data.entries) entryMap.set(e.t, e);
    const entries = [...entryMap.values()].sort((a, b) => a.t - b.t);
    const latest = entries.length ? entries[entries.length - 1] : null;

    // статус помпы: первый источник с sourcePumpStatus, у которого реально есть данные
    const device = oks.find((o) => o.cloud.sourcePumpStatus && o.data.device)?.data.device ?? null;

    // профиль (СУИ/ЦД/цели): первый источник, у которого он есть
    const profile = oks.find((o) => o.data.profile)?.data.profile ?? null;

    // лечение: объединяем все источники, дедуп по времени+типу
    const tKey = (t: Treatment) => t.t + '|' + t.type;
    const tmap = new Map<string, Treatment>();
    for (const o of oks) for (const t of o.data.treatments) tmap.set(tKey(t), t);
    const treatments = [...tmap.values()].sort((a, b) => a.t - b.t);

    set({ data: { entries, device, profile, treatments, latest, updatedAt: Date.now() }, status: 'ok', error: null });
    saveCache(true); // после полного слияния — сразу, это опорное состояние
    putEntries(entries);
    backfill(); // фоновая докачка истории глюкозы в БД (пока только основное облако)
    backfillTreatments(); // и истории лечения
  } catch (e: any) {
    set({ status: state.data ? 'stale' : 'error', error: String(e?.message || e) });
  } finally {
    inflight = false;
  }
}

function start() {
  if (started) return;
  started = true;
  loadCache();
  refresh();
  setInterval(refresh, POLL_MS);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  start();
  return () => { listeners.delete(cb); };
}
function getSnapshot() { return state; }

export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/* Подписка на КУСОК состояния, а не на всё сразу.

   useStore перерисовывает подписчика при любом изменении. Сообщение сокета приходит
   раз в минуту и меняет только измерения — но перерисовывались все смонтированные
   экраны разом (а смонтированы все пять, ради свайпа). Это и есть оставшиеся
   50–90 мс каждые ~18 секунд.

   Здесь компонент говорит, что ему нужно, и просыпается только от этого. Ключевое
   условие — селектор должен возвращать стабильную ссылку: слияние сокета не пересоздаёт
   массив лечения, если лечение не приходило, поэтому «дай мне только device» реально
   не дёргается от новых измерений. */
export function useStorePart<T>(select: (s: StoreState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state), () => select(state));
}

// Не-React подписка (для моста SugarLifeBridge): вызывает cb при каждом изменении.
export const subscribeStore = subscribe;
export const getStoreState = getSnapshot;

// Право записи в Nightscout. Гейтить им весь ввод (еда/болюсы/запись).
export function useWritable(): boolean {
  return useSyncExternalStore(subscribe, () => state.writable);
}
