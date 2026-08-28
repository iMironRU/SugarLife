import { прочитатьJson, записатьJson } from './storage';
/* Профиль петли: режим (уровень полномочий) и лимиты.

   ВАЖНО: это ТОЛЬКО интерфейс и локальный конфиг. Ни одна команда в помпу отсюда
   не уходит и уйти не может — см. docs/decisions/0004-loop-pro-redakciya.md.
   Приложение работает на L0 («команды не отправляются, помпа по своему профилю»).

   Состав перенесён из прототипа мастера (inbox/loop.zip → loop-setup-wizard.html)
   и документа 02-LOOP-CORE.md §3 «Лестница полномочий», §4 «Шесть классов ограничений». */
import { useSyncExternalStore } from 'react';

export type LoopModeId = 'l0' | 'l1' | 'l2' | 'l3' | 'l4';

export interface LoopMode {
  id: LoopModeId; code: string; name: string; desc: string; need: string;
  available: boolean; lock?: string; warn?: string;
}

/* Режимы различаются ОБЪЁМОМ ПОЛНОМОЧИЙ алгоритма, а не набором настроек.
   L4 закрыт: требует 14 суток работы на L3, которых не было. */
export const LOOP_MODES: LoopMode[] = [
  { id: 'l0', code: 'L0', name: 'Только расчёт', available: true,
    desc: 'Команды в помпу не отправляются. Алгоритм считает и предлагает, ввод выполняет человек.',
    need: 'требуется: НМГ' },
  { id: 'l1', code: 'L1', name: 'Остановка при низкой · PLGS', available: true,
    desc: 'Единственное полномочие — упреждающая остановка подачи при прогнозе гипогликемии, с автоматическим возобновлением.',
    need: 'требуется: остановка подачи' },
  { id: 'l2', code: 'L2', name: 'Петля по базалу', available: true,
    desc: 'Каждые 5 минут корректирует временную базальную скорость в обе стороны. Болюсы не вводит.',
    need: 'требуется: ВБС, чтение истории' },
  { id: 'l3', code: 'L3', name: 'Петля с микроболюсами · SMB', available: true,
    desc: 'То же плюс дробная подача микроболюсами. Быстрее по действию, необратимо.',
    need: 'требуется: шаг болюса ≤ 0,1 ЕД, подтверждение доз' },
  { id: 'l4', code: 'L4', name: 'Адаптивный', available: false, lock: 'недоступен',
    desc: 'Автоподстройка ФЧИ и чувствительности по накопленной истории.',
    need: 'требуется: 14 суток работы на L3 · сейчас 0' },
];

export interface LoopLimit {
  id: string; name: string; unit: string;
  min: number; max: number; rec: number; recMax: number; step: number; dp: number;
  forModes: LoopModeId[];
  below?: boolean;   // «плохо», если НИЖЕ рекомендованного (а не выше)
  why: string;       // что это ограничивает
  why2: string;      // почему устроено именно так
  impact: (v: number) => string; // что это значит на практике
}

export const LOOP_LIMITS: LoopLimit[] = [
  { id: 'w30', name: 'Лимит подачи за 30 минут', unit: 'ЕД', min: 0.2, max: 1.5, rec: 1.0, recMax: 1.2, step: 0.1, dp: 1, forModes: ['l2', 'l3'],
    why: 'Суммарный потолок доставки за скользящие 30 минут — базал и микроболюсы вместе.',
    why2: 'Лимит ставится на сумму, а не на каждый канал отдельно: иначе ограничение обходится переключением с базала на микроболюсы.',
    impact: (v) => `Эквивалент ${Math.floor(v / 0.2)} микроболюсов по 0,2 ЕД сверх обычного базала.` },
  { id: 'iob', name: 'Лимит активного инсулина', unit: 'ЕД', min: 1, max: 8, rec: 4, recMax: 6, step: 0.5, dp: 1, forModes: ['l2', 'l3'],
    why: 'Порог активного инсулина, выше которого алгоритм не добавляет ничего.',
    why2: 'Считается пессимистично — по отправленным командам, а не только по подтверждённым. Занижение активного инсулина опаснее завышения.',
    impact: (v) => `Подача прекращается при накоплении ${v.toFixed(1)} ЕД активного инсулина.` },
  { id: 'mbas', name: 'Максимальная ВБС', unit: 'ЕД/ч', min: 0.4, max: 2.5, rec: 1.2, recMax: 1.8, step: 0.1, dp: 1, forModes: ['l2', 'l3'],
    why: 'Верхняя граница временной базальной скорости.',
    why2: 'Задаётся в ЕД/ч, а не в процентах от профиля: процент привязан ко времени суток и меняет смысл при смене профиля.',
    impact: (v) => `Примерно ${(v / 0.6).toFixed(1)}× от базала 0,6 ЕД/ч.` },
  { id: 'msmb', name: 'Максимальный микроболюс', unit: 'ЕД', min: 0.1, max: 0.5, rec: 0.2, recMax: 0.3, step: 0.1, dp: 1, forModes: ['l3'],
    why: 'Предельный размер одного микроболюса.',
    why2: 'Введённый болюс отменить нельзя. Это первое полномочие, которое снимается при любом расхождении данных.',
    impact: (v) => `Это ${Math.round(v / 0.1)} шага помпы по 0,1 ЕД.` },
  { id: 'gap', name: 'Интервал между микроболюсами', unit: 'мин', min: 3, max: 20, rec: 5, recMax: 5, step: 1, dp: 0, forModes: ['l3'], below: true,
    why: 'Минимальная пауза между микроболюсами.',
    why2: 'Ультракороткий инсулин выходит на пик не сразу. Слишком частая подача читается алгоритмом как отсутствие эффекта.',
    impact: (v) => `Не чаще ${Math.floor(60 / v)} микроболюсов в час.` },
  { id: 'floor', name: 'Порог блокировки болюса', unit: 'ммоль/л', min: 4.5, max: 8, rec: 5.5, recMax: 99, step: 0.1, dp: 1, forModes: ['l1', 'l2', 'l3'], below: true,
    why: 'Гликемия, ниже которой болюс и микроболюс блокируются независимо от прогноза.',
    why2: 'Порог можно поднять. Опустить ниже 4,5 ммоль/л нельзя: это запрет, а не параметр.',
    impact: (v) => `Ниже ${v.toFixed(1)} ммоль/л ввод недоступен, а не сопровождается предупреждением.` },
  { id: 'stale', name: 'Порог устаревания НМГ', unit: 'мин', min: 10, max: 30, rec: 15, recMax: 20, step: 1, dp: 0, forModes: ['l1', 'l2', 'l3'],
    why: 'Допустимый возраст последней точки гликемии.',
    why2: 'Решение по устаревшим данным опаснее отсутствия решения: за 20 минут гликемия уходит далеко от последнего значения.',
    impact: (v) => `После ${v} мин без данных полномочия понижаются автоматически.` },
];

export interface LoopProfile {
  mode: LoopModeId;
  values: Record<string, number>;
  doctorOk: boolean;      // подтверждение согласования, если значения вне рекомендаций
  savedAt: number | null; // изменения профиля пишутся с датой и временем
}

const KEY = 'sl.loop.v1';
const defaults = (): Record<string, number> =>
  Object.fromEntries(LOOP_LIMITS.map((l) => [l.id, l.rec]));

const DEFAULT: LoopProfile = { mode: 'l0', values: defaults(), doctorOk: false, savedAt: null };

function load(): LoopProfile {
  try {
    const v = прочитатьJson<Partial<LoopProfile> | null>(KEY, null);
    return v ? { ...DEFAULT, ...v, values: { ...defaults(), ...(v.values || {}) } } : DEFAULT;
  } catch { return DEFAULT; }
}

let state = load();
const subs = new Set<() => void>();

function getLoopProfile(): LoopProfile { return state; }
export function saveLoopProfile(p: Partial<LoopProfile>): void {
  state = { ...state, ...p };
  записатьJson(KEY, state);
  subs.forEach((f) => f());
}
export function useLoopProfile(): LoopProfile {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getLoopProfile, getLoopProfile,
  );
}

// Какие лимиты вообще применимы в этом режиме — состав определяется режимом, не наоборот.
export const limitsFor = (mode: LoopModeId): LoopLimit[] =>
  LOOP_LIMITS.filter((l) => l.forModes.includes(mode));

// Значение вне рекомендованного диапазона (для некоторых «плохо» — это НИЖЕ порога).
export const outOfRec = (l: LoopLimit, v: number): boolean => (l.below ? v < l.rec : v > l.recMax);

/* НАСКОЛЬКО ДАЛЕКО УШЛИ В РИСКОВАННУЮ СТОРОНУ (#566, решение владельца: «через жёлтый к красному»).

   Три состояния, а не два: «вне рекомендованного» и «почти у предела приложения» — разные новости, и
   до сих пор они выглядели одинаково жёлтым. Граница между ними — половина пути от рекомендованного
   к пределу; точнее не нужно, число здесь читают глазом, а не меряют.

   Рискованная сторона у каждого предела своя (`below`): у лимита активного инсулина хуже наверх, у
   целевого сахара — вниз. Поэтому цвет считается от поля, а не от знака кнопки: «минус» на одном
   экране уводит в опасность, на другом выводит из неё. */
export type УровеньРиска = 'норма' | 'край' | 'предел';

export const уровеньРиска = (l: LoopLimit, v: number): УровеньРиска => {
  if (!outOfRec(l, v)) return 'норма';
  const предел = l.below ? l.min : l.max;
  const порог = l.below ? l.rec : l.recMax;
  const ход = Math.abs(предел - порог);
  if (ход < 1e-9) return 'предел';
  /* Допуск — по той же причине, что в границах правил тревог: ровно половина пути в двоичной дроби
     оказывается чуть меньше половины, и цвет у самой границы зависел бы от того, какими числами
     задан предел. */
  return Math.abs(v - порог) / ход >= 0.5 - 1e-9 ? 'предел' : 'край';
};

/** Куда ведёт рискованная сторона: −1 (уменьшать хуже) или +1 (увеличивать хуже). */
export const сторонаРиска = (l: LoopLimit): -1 | 1 => (l.below ? -1 : 1);
export const anyOutOfRec = (p: LoopProfile): boolean =>
  limitsFor(p.mode).some((l) => outOfRec(l, p.values[l.id]));

export const fmtLimit = (l: LoopLimit, v: number): string =>
  v.toFixed(l.dp).replace('.', ',');
