/* Аналитика «здоровья данных»: подсвечивает недоработки пользователя,
   напоминает о заменах расходников и оценивает готовность к Autotune.
   Всё считается из того, что уже есть — CGM-история, события Nightscout,
   возрасты устройств. Никаких выдумок: чего нет в данных — то и подсвечиваем. */
import type { Entry, Treatment } from './nightscout';
import { deviceAges } from './treatmentStats';

export type Severity = 'good' | 'info' | 'warn' | 'bad';
export type InsightKind = 'device' | 'data' | 'habit';

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: Severity;
  title: string;
  message: string;
  question?: string; // вовлекающий вопрос пользователю
}

export interface Readiness {
  level: 'ready' | 'partial' | 'not';
  reasons: string[]; // что мешает / что учесть
}

export interface Analysis {
  readiness: Readiness;
  insights: Insight[];
  coverage: number; // доля времени с данными CGM (0..1)
  carbsPerDay: number;
  bolusPerDay: number;
  windowDays: number;
}

const SEV_ORDER: Record<Severity, number> = { bad: 0, warn: 1, info: 2, good: 3 };

export function analyze(
  entries: Entry[],
  events: Treatment[],
  windowDays: number,
  basalCoverage?: { covered: number; total: number },
): Analysis {
  const now = Date.now();
  const winMs = windowDays * 86400e3;
  const t0 = now - winMs;
  const es = entries.filter((e) => e.t >= t0);

  // Покрытие CGM: доля часовых слотов с хотя бы одним показанием
  const hourSlots = new Set<number>();
  for (const e of es) hourSlots.add(Math.floor(e.t / 3600e3));
  const totalHours = Math.max(1, Math.round(winMs / 3600e3));
  const coverage = Math.min(1, hourSlots.size / totalHours);

  const carbs = events.filter((t) => t.carbs && t.carbs > 0 && t.t >= t0);
  const boluses = events.filter((t) => t.insulin && t.insulin > 0 && t.t >= t0);
  const carbsPerDay = carbs.length / windowDays;
  const bolusPerDay = boluses.length / windowDays;

  const ages = deviceAges(events);
  const insights: Insight[] = [];
  const pct = Math.round(coverage * 100);

  // ---------- расходники / замены ----------
  if (ages.site) {
    const d = ages.site.days;
    if (d >= 5) insights.push({ id: 'site', kind: 'device', severity: 'warn', title: `Канюля стоит ${d} дн.`, message: 'Инфузионный набор обычно меняют каждые 2–3 дня — дольше растёт риск воспаления и плохого всасывания инсулина.', question: 'Пора менять набор?' });
    else if (d >= 3) insights.push({ id: 'site', kind: 'device', severity: 'info', title: `Канюля: ${d} дн.`, message: 'Приближается срок замены инфузионного набора (обычно 2–3 дня).' });
  }
  if (ages.reservoir) {
    const d = ages.reservoir.days;
    if (d >= 6) insights.push({ id: 'reservoir', kind: 'device', severity: 'warn', title: `Резервуар залит ${d} дн.`, message: 'Инсулин в помпе теряет активность от тепла тела за несколько дней. Обычно перезаливают каждые 3–6 дней.' });
  }
  if (ages.sensor) {
    const d = ages.sensor.days;
    if (d >= 14) insights.push({ id: 'sensor', kind: 'device', severity: 'warn', title: `Датчик: день ${d + 1}`, message: 'Дольше обычного срока сенсора. Если это не сенсор расширенного ношения — проверь точность по глюкометру и запланируй замену.' });
    else if (d >= 10) insights.push({ id: 'sensor', kind: 'device', severity: 'info', title: `Датчик: день ${d + 1}`, message: 'Приближается типичный конец срока сенсора — держи новый под рукой.' });
  }
  if (ages.battery && ages.battery.days >= 21) {
    insights.push({ id: 'battery', kind: 'device', severity: 'info', title: `Батарея помпы: ${ages.battery.days} дн.`, message: 'Работает давно — держи запасную под рукой.' });
  }

  // ---------- качество данных ----------
  if (coverage < 0.5) {
    insights.push({ id: 'cgm', kind: 'data', severity: 'bad', title: `Много пропусков в CGM (${pct}% времени)`, message: 'Половину времени нет показаний — телефон терял связь с сенсором или не выгружал в Nightscout. Из-за дыр метрики и Autotune сильно занижаются.' });
  } else if (coverage < 0.8) {
    insights.push({ id: 'cgm', kind: 'data', severity: 'warn', title: `Пропуски в CGM (${pct}% времени)`, message: 'Часть времени нет показаний. Полнее данные — точнее анализ. Проверь связь телефона с сенсором и выгрузку в Nightscout.' });
  } else {
    insights.push({ id: 'cgm', kind: 'data', severity: 'good', title: `Данные CGM почти полные (${pct}%)`, message: 'Показания идут без больших пропусков — хорошая основа для анализа.' });
  }

  if (basalCoverage && basalCoverage.total > 0 && basalCoverage.covered / basalCoverage.total < 0.6) {
    insights.push({ id: 'basal', kind: 'data', severity: 'warn', title: 'Неполная выгрузка базала', message: `Только ${basalCoverage.covered} из ${basalCoverage.total} дней с полными данными по temp basal — остальные залиты частично. Суточная доза и Autotune на таких днях недостоверны.` });
  }

  // ---------- привычки логирования ----------
  if (carbsPerDay < 0.5) {
    insights.push({ id: 'carbs', kind: 'habit', severity: 'warn', title: 'Углеводы почти не записаны', message: 'За период — почти ноль приёмов пищи. Без углеводов калькулятор болюса и Autotune работают вслепую: им не с чем сопоставлять подъёмы сахара.', question: 'Ты не ешь — или забываешь записывать еду?' });
  } else if (carbsPerDay < 2) {
    insights.push({ id: 'carbs', kind: 'habit', severity: 'info', title: `Мало записей еды (${carbsPerDay.toFixed(1)}/день)`, message: 'Похоже, часть приёмов пищи не попадает в дневник. Чем полнее еда — тем точнее рекомендации.', question: 'Записываешь все приёмы пищи или только крупные?' });
  }

  if (bolusPerDay < 0.5 && carbsPerDay >= 0.5) {
    insights.push({ id: 'bolus', kind: 'habit', severity: 'info', title: 'Дискретных болюсов почти нет', message: 'Похоже, коррекции идут через temp basal (замкнутая петля). Для AAPS это норма, но Autotune труднее делить базал и болюс.' });
  }

  insights.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  // ---------- вердикт готовности к Autotune ----------
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

  return { readiness: { level, reasons }, insights, coverage, carbsPerDay, bolusPerDay, windowDays };
}
