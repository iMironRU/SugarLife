/* Аналитика «здоровья данных» и гликемических паттернов.
   Всё считается из того, что уже есть — CGM-история, события Nightscout,
   возрасты устройств. Никаких выдумок: чего нет в данных — то и подсвечиваем.
   Значения глюкозы форматируются в текущих единицах (ммоль/л ⇄ мг/дл). */
import type { Entry, Treatment } from './nightscout';
import { deviceAges } from './treatmentStats';
import { stats, agp, LOW, HIGH, VLOW, VHIGH } from './agp';
import { toUnits, unitLabel } from './units';

export type Severity = 'good' | 'info' | 'warn' | 'bad';
export type InsightKind = 'device' | 'data' | 'habit' | 'glucose';

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: Severity;
  title: string;
  message: string;
  question?: string;
}

export interface Readiness {
  level: 'ready' | 'partial' | 'not';
  reasons: string[];
}

export interface Analysis {
  readiness: Readiness;
  insights: Insight[];
  coverage: number;
  carbsPerDay: number;
  bolusPerDay: number;
  windowDays: number;
}

export interface AnalyzeCtx {
  basalCoverage?: { covered: number; total: number };
  uploaderBattery?: number | null;
}

const SEV_ORDER: Record<Severity, number> = { bad: 0, warn: 1, info: 2, good: 3 };
const DAY = 86400e3;

// глюкоза в текущих единицах со знаком единиц
const gv = (mmol: number) => `${toUnits(mmol)} ${unitLabel()}`;
// дельта глюкозы (без подписи «ниже нуля»): для мг/дл ×18
const gd = (mmol: number) => toUnits(mmol);

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

  const ages = deviceAges(events);
  const s = stats(es);
  const hourly = agp(es, 24);
  const p50 = new Map<number, number>();
  const spread = new Map<number, { lo: number; hi: number }>();
  for (const p of hourly) { p50.set(Math.round(p.t), p.p50); spread.set(Math.round(p.t), { lo: p.p05, hi: p.p95 }); }

  const ins: Insight[] = [];

  // ================= расходники / замены =================
  if (ages.site) {
    const d = ages.site.days;
    if (d >= 5) ins.push({ id: 'site', kind: 'device', severity: 'warn', title: `Канюля стоит ${d} дн.`, message: 'Инфузионный набор обычно меняют каждые 2–3 дня — дольше растёт риск воспаления и плохого всасывания инсулина.', question: 'Пора менять набор?' });
    else if (d >= 3) ins.push({ id: 'site', kind: 'device', severity: 'info', title: `Канюля: ${d} дн.`, message: 'Приближается срок замены инфузионного набора (обычно 2–3 дня).' });
  }
  if (ages.reservoir && ages.reservoir.days >= 6) {
    ins.push({ id: 'reservoir', kind: 'device', severity: 'warn', title: `Резервуар залит ${ages.reservoir.days} дн.`, message: 'Инсулин в помпе теряет активность от тепла тела за несколько дней. Обычно перезаливают каждые 3–6 дней.' });
  }
  if (ages.sensor) {
    const d = ages.sensor.days;
    if (d >= 14) ins.push({ id: 'sensor', kind: 'device', severity: 'warn', title: `Датчик: день ${d + 1}`, message: 'Дольше обычного срока сенсора. Если это не сенсор расширенного ношения — проверь точность по глюкометру и запланируй замену.' });
    else if (d >= 10) ins.push({ id: 'sensor', kind: 'device', severity: 'info', title: `Датчик: день ${d + 1}`, message: 'Приближается типичный конец срока сенсора — держи новый под рукой.' });
  }
  if (ages.battery && ages.battery.days >= 21) {
    ins.push({ id: 'battery', kind: 'device', severity: 'info', title: `Батарея помпы: ${ages.battery.days} дн.`, message: 'Работает давно — держи запасную под рукой.' });
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
  if (siteCad) ins.push({ id: 'site-cad', kind: 'device', severity: 'info', title: `Канюлю меняешь ~каждые ${siteCad.toFixed(0)} дн.`, message: 'Твой обычный ритм замены набора — по истории Nightscout.' });
  const sensorCad = cadence(['Sensor Change', 'Sensor Start']);
  if (sensorCad) ins.push({ id: 'sensor-cad', kind: 'device', severity: 'info', title: `Датчик меняешь ~каждые ${sensorCad.toFixed(0)} дн.`, message: 'Твой обычный ритм замены сенсора — по истории Nightscout.' });

  // телефон-аплоадер
  if (ctx.uploaderBattery != null && ctx.uploaderBattery <= 20) {
    ins.push({ id: 'phone', kind: 'device', severity: 'warn', title: `Телефон разряжен (${ctx.uploaderBattery}%)`, message: 'Аплоадер вот-вот сядет — данные CGM прервутся, пока не зарядишь.' });
  }

  // ================= ночная безопасность =================
  const night = es.filter((e) => new Date(e.t).getHours() < 6);
  const nightHypo = episodesBelow(night, LOW);
  if (nightHypo >= 1) {
    ins.push({ id: 'night-hypo', kind: 'glucose', severity: nightHypo >= 4 ? 'bad' : 'warn', title: `Ночные гипо: ${nightHypo} за ${windowDays} дн.`, message: `Сахар опускался ниже ${gv(LOW)} в 00:00–06:00 — во сне это легко проспать. Частые ночные гипо — повод обсудить с врачом снижение ночного базала.` });
  }
  if (s) {
    if (s.veryLow > 1) ins.push({ id: 'tbr', kind: 'glucose', severity: 'bad', title: `Тяжёлая гипо ${s.veryLow.toFixed(1)}% времени`, message: `Ниже ${gv(VLOW)} — ${s.veryLow.toFixed(1)}% времени при цели <1%. Это опасно много.` });
    else if (s.tbr > 4) ins.push({ id: 'tbr', kind: 'glucose', severity: 'warn', title: `Ниже нормы ${s.tbr.toFixed(1)}% времени`, message: `Сахар ниже ${gv(LOW)} — ${s.tbr.toFixed(1)}% времени при клинической цели <4%.` });
    else ins.push({ id: 'tbr', kind: 'glucose', severity: 'good', title: `Гипо под контролем (${s.tbr.toFixed(1)}%)`, message: `Ниже нормы всего ${s.tbr.toFixed(1)}% времени — в пределах цели <4%.` });
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
    ins.push({ id: 'rebound', kind: 'glucose', severity: 'info', title: `Откат в гипер: ${rebounds} раз`, message: `После гипо сахар в течение 2 ч улетал выше ${gv(HIGH)}. Часто это перебор быстрых углеводов при купировании низкого.`, question: 'Сколько съедаешь, когда «ловишь» гипо?' });
  }

  // ================= паттерны по времени суток =================
  const p3 = p50.get(3), p7 = p50.get(7);
  if (p3 != null && p7 != null && p7 - p3 >= 1.7) {
    ins.push({ id: 'dawn', kind: 'glucose', severity: 'info', title: 'Феномен зари', message: `Под утро сахар сам поднимается на ${gd(p7 - p3)} ${unitLabel()} (с ${gv(p3)} в 3:00 до ${gv(p7)} в 7:00) без еды. Обычно решается добавкой предутреннего базала.` });
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
    ins.push({ id: 'high-window', kind: 'glucose', severity: 'warn', title: `Стабильно высоко ${hi[0]}:00–${hi[hi.length - 1] + 1}:00`, message: `В эти часы медиана держится около ${gv(med)}. Присмотрись к базалу и болюсам этого времени.` });
  }
  const lo = runHours((v) => v < LOW);
  if (lo.length >= 2) {
    const med = lo.reduce((a, h) => a + (p50.get(h) || 0), 0) / lo.length;
    ins.push({ id: 'low-window', kind: 'glucose', severity: 'warn', title: `Стабильно низко ${lo[0]}:00–${lo[lo.length - 1] + 1}:00`, message: `Медиана около ${gv(med)} — вероятно, в это время инсулина многовато.` });
  }
  // самый непредсказуемый час
  let volH = -1, volW = 0;
  for (const [h, sp] of spread) { const w = sp.hi - sp.lo; if (w > volW) { volW = w; volH = h; } }
  if (volH >= 0 && volW > 5) {
    const sp = spread.get(volH)!;
    ins.push({ id: 'volatile', kind: 'glucose', severity: 'info', title: `Самый непредсказуемый час: ${volH}:00`, message: `Разброс сахара от ${gv(sp.lo)} до ${gv(sp.hi)}. Что обычно происходит в это время — еда, спорт, стресс?` });
  }

  // ================= тренды и цели =================
  if (s) {
    const last7 = stats(es.filter((e) => e.t >= now - 7 * DAY));
    const prev7 = stats(es.filter((e) => e.t >= now - 14 * DAY && e.t < now - 7 * DAY));
    if (last7 && prev7 && last7.n > 500 && prev7.n > 500) {
      const d = last7.target - prev7.target;
      if (Math.abs(d) >= 3) {
        ins.push({ id: 'tir-trend', kind: 'glucose', severity: d >= 0 ? 'good' : 'warn', title: `Время в норме: ${last7.target.toFixed(0)}% (${d >= 0 ? '+' : ''}${d.toFixed(0)}% за неделю)`, message: d >= 0 ? 'Контроль за последнюю неделю улучшился — так держать.' : 'За последнюю неделю время в норме просело. Стоит разобраться, что изменилось.' });
      }
    }
    if (s.gmi > 7) {
      ins.push({ id: 'gmi', kind: 'glucose', severity: s.gmi > 7.5 ? 'warn' : 'info', title: `GMI ${s.gmi.toFixed(1)}% — выше цели`, message: `Расчётный HbA1c ${s.gmi.toFixed(1)}% при цели <7% (средний сахар ${gv(s.mean)}). Снижение среднего сахара уменьшит риск осложнений.` });
    }
    const longHigh = sustainedAbove(es, VHIGH, 2 * 3600e3);
    if (longHigh >= 1) {
      ins.push({ id: 'long-high', kind: 'glucose', severity: 'info', title: `Долгая гипергликемия: ${longHigh} эпизод(ов)`, message: `Сахар держался выше ${gv(VHIGH)} дольше 2 ч. Длительные высокие бьют по сосудам — проверь, хватает ли коррекций.` });
    }
  }

  // ================= качество данных =================
  if (coverage < 0.5) ins.push({ id: 'cgm', kind: 'data', severity: 'bad', title: `Много пропусков в CGM (${pct}%)`, message: 'Половину времени нет показаний — телефон терял связь с сенсором или не выгружал в Nightscout. Из-за дыр метрики и Autotune сильно занижаются.' });
  else if (coverage < 0.8) ins.push({ id: 'cgm', kind: 'data', severity: 'warn', title: `Пропуски в CGM (${pct}%)`, message: 'Часть времени нет показаний. Полнее данные — точнее анализ. Проверь связь телефона с сенсором и выгрузку в Nightscout.' });
  else ins.push({ id: 'cgm', kind: 'data', severity: 'good', title: `Данные CGM почти полные (${pct}%)`, message: 'Показания идут без больших пропусков — хорошая основа для анализа.' });

  if (ctx.basalCoverage && ctx.basalCoverage.total > 0 && ctx.basalCoverage.covered / ctx.basalCoverage.total < 0.6) {
    ins.push({ id: 'basal', kind: 'data', severity: 'warn', title: 'Неполная выгрузка базала', message: `Только ${ctx.basalCoverage.covered} из ${ctx.basalCoverage.total} дней с полными данными по temp basal — остальные залиты частично. Суточная доза и Autotune на таких днях недостоверны.` });
  }

  // ================= привычки логирования =================
  if (carbsPerDay < 0.5) ins.push({ id: 'carbs', kind: 'habit', severity: 'warn', title: 'Углеводы почти не записаны', message: 'За период — почти ноль приёмов пищи. Без углеводов калькулятор болюса и Autotune работают вслепую: им не с чем сопоставлять подъёмы сахара.', question: 'Ты не ешь — или забываешь записывать еду?' });
  else if (carbsPerDay < 2) ins.push({ id: 'carbs', kind: 'habit', severity: 'info', title: `Мало записей еды (${carbsPerDay.toFixed(1)}/день)`, message: 'Похоже, часть приёмов пищи не попадает в дневник. Чем полнее еда — тем точнее рекомендации.', question: 'Записываешь все приёмы пищи или только крупные?' });
  if (bolusPerDay < 0.5 && carbsPerDay >= 0.5) ins.push({ id: 'bolus', kind: 'habit', severity: 'info', title: 'Дискретных болюсов почти нет', message: 'Похоже, коррекции идут через temp basal (замкнутая петля). Для AAPS это норма, но Autotune труднее делить базал и болюс.' });

  ins.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  // ================= вердикт готовности к Autotune =================
  const reasons: string[] = [];
  let level: Readiness['level'] = 'ready';
  const worsen = (l: Readiness['level']) => {
    if (l === 'not') level = 'not';
    else if (l === 'partial' && level === 'ready') level = 'partial';
  };
  if (windowDays < 7) { reasons.push('нужно хотя бы 7 дней истории'); worsen('partial'); }
  if (coverage < 0.5) { reasons.push('слишком много пропусков в CGM'); worsen('not'); }
  else if (coverage < 0.8) { reasons.push('есть пропуски в CGM'); worsen('partial'); }
  if (carbsPerDay < 0.5) { reasons.push('нет учёта углеводов — Autotune будет слепым'); worsen('not'); }
  else if (carbsPerDay < 2) { reasons.push('неполный учёт еды снизит точность'); worsen('partial'); }

  return { readiness: { level, reasons }, insights: ins, coverage, carbsPerDay, bolusPerDay, windowDays };
}
