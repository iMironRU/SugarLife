/* Аналитика «здоровья данных» и гликемических паттернов.
   Всё считается из того, что уже есть — CGM-история, события Nightscout,
   возрасты устройств. Никаких выдумок: чего нет в данных — то и подсвечиваем.
   Значения глюкозы форматируются в текущих единицах (ммоль/л ⇄ мг/дл). */
import type { Entry, Treatment } from '@/domain/types';
import { deviceAges , type ChangeMarks } from './treatmentStats';
import { stats, agp, LOW, HIGH, VLOW, VHIGH } from './agp';
import { необъяснённыеПодъёмы } from './mealMoment';
import { разборБезЗаписи, type РазборБезЗаписи } from './безЗаписи';
import type { ОтметкаПодъёма } from './причиныПодъёма';

export type Severity = 'good' | 'info' | 'warn' | 'bad';
export type InsightKind = 'device' | 'data' | 'habit' | 'glucose';

/* Что нашёл разбор — БЕЗ СЛОВ (#324, #407).

   Раньше здесь же лежали заголовок, объяснение и вопрос человеку. Файл разбора — самый
   плотный по правилам в приложении: пороги, окна, эпизоды, медианы. Формулировка,
   живущая рядом с числом, по которому человек решает про инсулин, означала две беды
   сразу: правку слова нельзя было сделать, не тронув расчёт, а расчёт нельзя было
   проверить тестом, не сверяя буквы.

   Теперь разбор возвращает `вид` — что именно найдено — и `п`: числа, которые попадут во
   фразу. Слова живут в `показ/находки.ts` и полны по типу: новый вид не соберётся, пока
   ему не написана фраза.

   `id` остался прежним и отдельно от `вида`: по нему группируются вопросы врачу и
   строятся ключи списка, и он не должен дробиться вместе с формулировками. */
/* Виды находок — списком, а тип выводится из него. Так они не могут разойтись: тест
   полноты ходит по массиву, а компилятор проверяет вид по тому же источнику. */
export const ВИДЫ_ДЛЯ_ПРОВЕРКИ = [
  'канюля-пора', 'канюля-скоро', 'резервуар-давно',
  'датчик-перерос', 'датчик-скоро', 'батарея-давно',
  'ритм-канюли', 'ритм-датчика', 'телефон-разряжен',
  'ночные-гипо', 'гипо-тяжёлая', 'гипо-много', 'гипо-в-норме', 'откат',
  'заря', 'окно-высоко', 'окно-низко', 'непредсказуемый-час',
  'тренд-вверх', 'тренд-вниз', 'gmi-выше', 'долгая-гипер',
  'нмг-дыры', 'нмг-пропуски', 'нмг-полные', 'базал-неполный',
  'без-записи', 'еда-не-пишется', 'еда-мало', 'болюсов-нет',
] as const;

export type ВидНаходки = (typeof ВИДЫ_ДЛЯ_ПРОВЕРКИ)[number];

export interface Находка {
  id: string;
  вид: ВидНаходки;
  kind: InsightKind;
  severity: Severity;
  /** Числа для фразы. Их подставляет слой показа — здесь только значения. */
  п?: Record<string, number | string>;
}

/** Прежнее имя типа: им пользуются экраны и записка. */
export type Insight = Находка;

/* Причины неготовности — кодами, а не фразами: сами фразы в `показ/находки.ts`. */
export type ПричинаНеготовности =
  | 'мало-дней' | 'дыры-в-нмг' | 'пропуски-в-нмг' | 'нет-углеводов' | 'мало-углеводов';

export interface Readiness {
  level: 'ready' | 'partial' | 'not';
  reasons: ПричинаНеготовности[];
}

export interface Analysis {
  readiness: Readiness;
  insights: Insight[];
  coverage: number;
  carbsPerDay: number;
  bolusPerDay: number;
  windowDays: number;
  /* Подъёмы без записи за период (#432). Отдаём разбором, а не только находкой: числа
     нужны и записке к приёму, а собирать их там во второй раз значило бы завести два
     мнения о том, сколько их было. */
  безЗаписи: РазборБезЗаписи;
}

export interface AnalyzeCtx {
  basalCoverage?: { covered: number; total: number };
  uploaderBattery?: number | null;
  /* Отметки замен, сделанные в приложении. Без них разбор считает возраст расходников
     только по событиям Nightscout, а они бывают пропущены целиком — и «канюля 11 дней»
     оказывается неправдой (settings/changes.ts). */
  changes?: ChangeMarks;
  /* Чем человек объяснил подъёмы (#167). Без них разбор считает объяснённое
     необъяснённым и спрашивает второй раз про то, на что уже ответили. */
  отметкиПодъёмов?: ОтметкаПодъёма[];
}

const SEV_ORDER: Record<Severity, number> = { bad: 0, warn: 1, info: 2, good: 3 };
const DAY = 86400e3;


// Число «входов» ниже порога (эпизоды гипо/выхода за диапазон)
function episodesBelow(sorted: Entry[], thr: number): number {
  let count = 0, below = false;
  for (const e of sorted) {
    if (e.mmol < thr) { if (!below) count++; below = true; }
    else below = false;
  }
  return count;
}

// Число устойчивых эпизодов выше порога длиннее minMs
function sustainedAbove(sorted: Entry[], thr: number, minMs: number): number {
  let count = 0, start = -1, prevT = -1;
  for (const e of sorted) {
    if (e.mmol > thr) { if (start < 0) start = e.t; prevT = e.t; }
    else { if (start >= 0 && prevT - start >= minMs) count++; start = -1; }
  }
  if (start >= 0 && prevT - start >= minMs) count++;
  return count;
}

export function analyze(
  entries: Entry[],
  events: Treatment[],
  windowDays: number,
  ctx: AnalyzeCtx = {},
): Analysis {
  const now = Date.now();
  const winMs = windowDays * DAY;
  const t0 = now - winMs;
  const es = entries.filter((e) => e.t >= t0).sort((a, b) => a.t - b.t);

  // покрытие CGM по часовым слотам
  const hourSlots = new Set<number>();
  for (const e of es) hourSlots.add(Math.floor(e.t / 3600e3));
  const totalHours = Math.max(1, Math.round(winMs / 3600e3));
  const coverage = Math.min(1, hourSlots.size / totalHours);
  const pct = Math.round(coverage * 100);

  const carbs = events.filter((t) => t.carbs && t.carbs > 0 && t.t >= t0);
  const boluses = events.filter((t) => t.insulin && t.insulin > 0 && t.t >= t0);
  const carbsPerDay = carbs.length / windowDays;
  const bolusPerDay = boluses.length / windowDays;

  const ages = deviceAges(events, ctx.changes);
  const s = stats(es);
  const hourly = agp(es, 24);
  const p50 = new Map<number, number>();
  const spread = new Map<number, { lo: number; hi: number }>();
  for (const p of hourly) { p50.set(Math.round(p.t), p.p50); spread.set(Math.round(p.t), { lo: p.p05, hi: p.p95 }); }

  const ins: Insight[] = [];

  // ================= расходники / замены =================
  if (ages.site) {
    const d = ages.site.days;
    if (d >= 5) ins.push({ id: 'site', вид: 'канюля-пора', kind: 'device', severity: 'warn', п: { дней: d } });
    else if (d >= 3) ins.push({ id: 'site', вид: 'канюля-скоро', kind: 'device', severity: 'info', п: { дней: d } });
  }
  if (ages.reservoir && ages.reservoir.days >= 6) {
    ins.push({ id: 'reservoir', вид: 'резервуар-давно', kind: 'device', severity: 'warn', п: { дней: ages.reservoir.days } });
  }
  if (ages.sensor) {
    const d = ages.sensor.days;
    if (d >= 14) ins.push({ id: 'sensor', вид: 'датчик-перерос', kind: 'device', severity: 'warn', п: { день: d + 1 } });
    else if (d >= 10) ins.push({ id: 'sensor', вид: 'датчик-скоро', kind: 'device', severity: 'info', п: { день: d + 1 } });
  }
  if (ages.battery && ages.battery.days >= 21) {
    ins.push({ id: 'battery', вид: 'батарея-давно', kind: 'device', severity: 'info', п: { дней: ages.battery.days } });
  }
  // каденс замен — «обычно ты меняешь каждые N дней»
  const cadence = (types: string[]): number | null => {
    const ts = events.filter((e) => types.includes(e.type)).map((e) => e.t).sort((a, b) => a - b);
    if (ts.length < 3) return null;
    const gaps: number[] = [];
    for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / DAY);
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)]; // медиана
  };
  const siteCad = cadence(['Site Change']);
  if (siteCad) ins.push({ id: 'site-cad', вид: 'ритм-канюли', kind: 'device', severity: 'info', п: { дней: siteCad } });
  const sensorCad = cadence(['Sensor Change', 'Sensor Start']);
  if (sensorCad) ins.push({ id: 'sensor-cad', вид: 'ритм-датчика', kind: 'device', severity: 'info', п: { дней: sensorCad } });

  // телефон-аплоадер
  if (ctx.uploaderBattery != null && ctx.uploaderBattery <= 20) {
    ins.push({ id: 'phone', вид: 'телефон-разряжен', kind: 'device', severity: 'warn', п: { процент: ctx.uploaderBattery } });
  }

  // ================= ночная безопасность =================
  const night = es.filter((e) => new Date(e.t).getHours() < 6);
  const nightHypo = episodesBelow(night, LOW);
  if (nightHypo >= 1) {
    ins.push({ id: 'night-hypo', вид: 'ночные-гипо', kind: 'glucose', severity: nightHypo >= 4 ? 'bad' : 'warn', п: { сколько: nightHypo, дней: windowDays, низ: LOW } });
  }
  if (s) {
    if (s.veryLow > 1) ins.push({ id: 'tbr', вид: 'гипо-тяжёлая', kind: 'glucose', severity: 'bad', п: { доля: s.veryLow, порог: VLOW } });
    else if (s.tbr > 4) ins.push({ id: 'tbr', вид: 'гипо-много', kind: 'glucose', severity: 'warn', п: { доля: s.tbr, порог: LOW } });
    else ins.push({ id: 'tbr', вид: 'гипо-в-норме', kind: 'glucose', severity: 'good', п: { доля: s.tbr } });
  }
  // рикошет: гипо → гипер в течение 2 ч
  let rebounds = 0;
  for (let i = 0; i < es.length; i++) {
    if (es[i].mmol < LOW) {
      const tEnd = es[i].t + 2 * 3600e3;
      let hi = false;
      for (let j = i + 1; j < es.length && es[j].t <= tEnd; j++) if (es[j].mmol > HIGH) { hi = true; break; }
      if (hi) rebounds++;
      while (i + 1 < es.length && es[i + 1].mmol < LOW) i++;
    }
  }
  if (rebounds >= 3) {
    ins.push({ id: 'rebound', вид: 'откат', kind: 'glucose', severity: 'info', п: { сколько: rebounds, верх: HIGH } });
  }

  // ================= паттерны по времени суток =================
  const p3 = p50.get(3), p7 = p50.get(7);
  if (p3 != null && p7 != null && p7 - p3 >= 1.7) {
    ins.push({ id: 'dawn', вид: 'заря', kind: 'glucose', severity: 'info', п: { рост: p7 - p3, в3: p3, в7: p7 } });
  }
  // самые «высокие» и «низкие» часы по медиане
  const runHours = (test: (v: number) => boolean) => {
    let best: number[] = [], cur: number[] = [];
    for (let h = 0; h < 24; h++) {
      const v = p50.get(h);
      if (v != null && test(v)) cur.push(h);
      else { if (cur.length > best.length) best = cur; cur = []; }
    }
    if (cur.length > best.length) best = cur;
    return best;
  };
  const hi = runHours((v) => v > HIGH);
  if (hi.length >= 3) {
    const med = hi.reduce((a, h) => a + (p50.get(h) || 0), 0) / hi.length;
    ins.push({ id: 'high-window', вид: 'окно-высоко', kind: 'glucose', severity: 'warn', п: { с: hi[0], до: hi[hi.length - 1] + 1, медиана: med } });
  }
  const lo = runHours((v) => v < LOW);
  if (lo.length >= 2) {
    const med = lo.reduce((a, h) => a + (p50.get(h) || 0), 0) / lo.length;
    ins.push({ id: 'low-window', вид: 'окно-низко', kind: 'glucose', severity: 'warn', п: { с: lo[0], до: lo[lo.length - 1] + 1, медиана: med } });
  }
  // самый непредсказуемый час
  let volH = -1, volW = 0;
  for (const [h, sp] of spread) { const w = sp.hi - sp.lo; if (w > volW) { volW = w; volH = h; } }
  if (volH >= 0 && volW > 5) {
    const sp = spread.get(volH)!;
    ins.push({ id: 'volatile', вид: 'непредсказуемый-час', kind: 'glucose', severity: 'info', п: { час: volH, низ: sp.lo, верх: sp.hi } });
  }

  // ================= тренды и цели =================
  if (s) {
    const last7 = stats(es.filter((e) => e.t >= now - 7 * DAY));
    const prev7 = stats(es.filter((e) => e.t >= now - 14 * DAY && e.t < now - 7 * DAY));
    if (last7 && prev7 && last7.n > 500 && prev7.n > 500) {
      const d = last7.target - prev7.target;
      if (Math.abs(d) >= 3) {
        ins.push({ id: 'tir-trend', вид: d >= 0 ? 'тренд-вверх' : 'тренд-вниз', kind: 'glucose', severity: d >= 0 ? 'good' : 'warn', п: { сейчас: last7.target, сдвиг: d } });
      }
    }
    if (s.gmi > 7) {
      ins.push({ id: 'gmi', вид: 'gmi-выше', kind: 'glucose', severity: s.gmi > 7.5 ? 'warn' : 'info', п: { gmi: s.gmi, среднее: s.mean } });
    }
    const longHigh = sustainedAbove(es, VHIGH, 2 * 3600e3);
    if (longHigh >= 1) {
      ins.push({ id: 'long-high', вид: 'долгая-гипер', kind: 'glucose', severity: 'info', п: { сколько: longHigh, порог: VHIGH } });
    }
  }

  // ================= качество данных =================
  if (coverage < 0.5) ins.push({ id: 'cgm', вид: 'нмг-дыры', kind: 'data', severity: 'bad', п: { процент: pct } });
  else if (coverage < 0.8) ins.push({ id: 'cgm', вид: 'нмг-пропуски', kind: 'data', severity: 'warn', п: { процент: pct } });
  else ins.push({ id: 'cgm', вид: 'нмг-полные', kind: 'data', severity: 'good', п: { процент: pct } });

  if (ctx.basalCoverage && ctx.basalCoverage.total > 0 && ctx.basalCoverage.covered / ctx.basalCoverage.total < 0.6) {
    ins.push({ id: 'basal', вид: 'базал-неполный', kind: 'data', severity: 'warn', п: { дней: ctx.basalCoverage.covered, всего: ctx.basalCoverage.total } });
  }

  // ================= привычки логирования =================
  /* ПОДЪЁМЫ БЕЗ ЗАПИСИ (#432) — то же правило, что предлагает внести еду задним числом,
     но за всё окно разбора. Одно правило на два вопроса: «что внести» и «что происходит».

     СЛОВА ПОДОБРАНЫ ОСТОРОЖНО, и это не вежливость. У подъёма причин больше двух (#167):
     недоданный болюс, отвалившаяся канюля, рассветный феномен, болезнь, нагрев сенсора,
     съеденное без записи. Мы видим только подъём и отсутствие записи рядом. Назвать это
     «пропущенным приёмом» значит выбрать за человека одну причину из шести — и обвинить
     его в приложении, которым он пользуется каждый день.

     Поэтому находка сообщает факт и задаёт вопрос, а не ставит диагноз. Ночное
     преобладание названо отдельно: там причины другие, и разговор с врачом другой. */
  const подъёмы = необъяснённыеПодъёмы(es, carbs.map((c) => c.t), now, { глубинаМс: winMs, предел: 500 });
  const разбор = разборБезЗаписи(подъёмы, windowDays, ctx.отметкиПодъёмов ?? []);
  if (разбор.всего >= 3) {
    ins.push({
      id: 'без-записи', вид: 'без-записи', kind: 'habit',
      severity: разбор.вДень >= 1 ? 'warn' : 'info',
      п: {
        всего: разбор.всего, дней: windowDays,
        типичный: разбор.типичныйПодъём,
        преобладает: разбор.преобладает ?? '',
      },
    });
  }

  if (carbsPerDay < 0.5) ins.push({ id: 'carbs', вид: 'еда-не-пишется', kind: 'habit', severity: 'warn' });
  else if (carbsPerDay < 2) ins.push({ id: 'carbs', вид: 'еда-мало', kind: 'habit', severity: 'info', п: { вДень: carbsPerDay } });
  if (bolusPerDay < 0.5 && carbsPerDay >= 0.5) ins.push({ id: 'bolus', вид: 'болюсов-нет', kind: 'habit', severity: 'info' });

  ins.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  // ================= вердикт готовности к Autotune =================
  const reasons: ПричинаНеготовности[] = [];
  let level: Readiness['level'] = 'ready';
  const worsen = (l: Readiness['level']) => {
    if (l === 'not') level = 'not';
    else if (l === 'partial' && level === 'ready') level = 'partial';
  };
  if (windowDays < 7) { reasons.push('мало-дней'); worsen('partial'); }
  if (coverage < 0.5) { reasons.push('дыры-в-нмг'); worsen('not'); }
  else if (coverage < 0.8) { reasons.push('пропуски-в-нмг'); worsen('partial'); }
  if (carbsPerDay < 0.5) { reasons.push('нет-углеводов'); worsen('not'); }
  else if (carbsPerDay < 2) { reasons.push('мало-углеводов'); worsen('partial'); }

  return {
    readiness: { level, reasons }, insights: ins, coverage, carbsPerDay, bolusPerDay, windowDays,
    безЗаписи: разбор,
  };
}
