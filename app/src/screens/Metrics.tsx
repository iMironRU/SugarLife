
import Иконка from '@/ui/Иконка';
import Крутилка from '@/ui/Крутилка';
import { useTab } from '@/app/nav';
import { water, nutrition, medkit } from 'ionicons/icons';
import ЧипыПотоков, { type Поток } from '@/ui/Потоки';

import { useState } from 'react';
import { useEntries, useTreatments } from '@/sources/db';
import { useBackfilling } from '@/sources/backfill';
import { stats } from '@/domain/agp';
import { carbStats, insulinDaily, carbsByDay, insulinByDay } from '@/domain/treatmentStats';
import { fmt, toUnits, unitLabel, useUnit, useCarbUnit, toCarbs, carbUnitLabel } from '@/domain/units';
import TirBar from '@/charts/TirBar';
import AgpChart from '@/charts/AgpChart';
import { DataGate } from '@/ui/NotConfigured';
import MetricBars from '@/charts/MetricBars';
import Screen from '@/ui/Screen';
import { AnalyticsSection, VisitNoteSection } from '@/sections/lazy';
import { useAnalysis, непрочитанныеВажные } from '@/domain/useAnalysis';
import { useSeenInsights } from '@/settings/seenInsights';

type MetricKey = 'glucose' | 'carbs' | 'insulin';
type Cell = [string, string, string];
interface MetricDef { title: string; color: string; icon: string; hero: Cell; cards: [Cell, Cell]; stats: [Cell, Cell]; note?: string; }

const PERIODS: { days: number; label: string }[] = [
  { days: 3, label: '3 дня' }, { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' }, { days: 90, label: '90 дней' },
];

/* Три раздела на одном экране (SugarLife#255).

   Они отвечают на три разных вопроса об одном и том же прошлом: «что происходит»
   (разбор), «как у меня дела» (метрики), «что показать врачу» (отчёт). Раньше разбор
   висел плиткой на «Сегодня», а отчёт строкой в конце метрик — то есть три части
   одного размышления лежали в трёх местах, и найти их можно было только зная, где
   искать.

   «Сегодня» от этого выигрывает дважды: экран действия перестаёт звать в анализ. По
   концепции это разные режимы, и плитка «Разбор» была единственным местом, где они
   смешивались.

   Порядок неслучаен. Разбор первым, потому что он отвечает на вопрос, с которым сюда
   заходят («что не так»); метрики вторыми — это то, чем разбор подтверждают; отчёт
   последней, к ней приходят раз в несколько месяцев, но приходят целенаправленно. */
const РАЗДЕЛЫ = [
  { key: 'анализ', label: 'Анализ' },
  { key: 'метрики', label: 'Метрики' },
  /* «Отчёт», а не «Записка»: это документ, который человек показывает врачу, и назвать
     его надо тем словом, которым он назовёт его сам. Множественное придёт вместе с
     историей — когда прошлых отчётов станет больше одного (SugarLife#255). */
  { key: 'отчёт', label: 'Отчёт' },
] as const;
type Раздел = typeof РАЗДЕЛЫ[number]['key'];

/* Ключи метрик исторически английские, потоки — русские. Перевод в одном месте и
   рядом, а не по всему файлу: иначе третий такой список разъедется с первыми двумя. */
const ПОТОК_МЕТРИКИ: Record<MetricKey, Поток> = { glucose: 'глюкоза', carbs: 'углеводы', insulin: 'инсулин' };
const МЕТРИКА_ПОТОКА: Record<Поток, MetricKey> = { глюкоза: 'glucose', углеводы: 'carbs', инсулин: 'insulin' };

export default function Metrics() {
  const [раздел, setРаздел] = useState<Раздел>('метрики');
  /* Счётчик — и на вкладке в панели, и здесь (SugarLife#275).

     Цифра внизу говорит «есть непрочитанное», но не говорит где: человек открывает
     «Метрики» и оказывается перед тремя разделами, из которых цифра относилась к
     одному. Показать её только в панели значит поставить вопрос и не ответить.

     Считается тем же кодом и из тех же кэшей, что и в панели: два числа про одно и то
     же обязаны совпадать, а совпадают они надёжно, только если считаются одинаково. */
  const { analysis } = useAnalysis(14);
  const виденные = useSeenInsights();
  const новых = непрочитанныеВажные(analysis, виденные);
  /* Вкладка видна? Все пять смонтированы разом ради свайпа, но читать базу
     невидимому экрану незачем — это и были рывки на соседних вкладках. */
  const активна = useTab() === 0;
  const [days, setDays] = useState(3);
  const [metric, setMetric] = useState<MetricKey>('glucose');
  useUnit(); // перерисовка при смене единиц
  const cu = useCarbUnit(); // единицы углеводов (граммы/Х.Е.)

  // всё из локальной БД (накапливается фоновым бэкфиллом на 90 дней): глюкоза —
  // entries; лечение — treatments (temp basal + болюсы/углеводы). Больше не грузим
  // при каждом открытии и не режем окно инсулина — считаем за выбранный период.
  const entries = useEntries(days * 86400e3, { paused: !активна, minRefreshMs: 60e3 });
  const treatments = useTreatments(days * 86400e3, { paused: !активна, minRefreshMs: 60e3 });
  const events = treatments.filter((t) => t.type !== 'Temp Basal'); // болюсы/углеводы/замены
  const tempBasals = treatments; // insulinDaily/insulinByDay сами выберут Temp Basal

  // Честно предупреждаем, пока бэкфилл ещё не набрал полный период (данные неполные).
  // Как только докачка закончилась — прячем, даже если данных меньше (значит столько и есть).
  const backfilling = useBackfilling();
  const oldestHave = metric === 'glucose' ? entries[0]?.t : treatments[0]?.t;
  const gathering = backfilling && (oldestHave == null || oldestHave > Date.now() - days * 86400e3 + 2 * 86400e3);

  const s = entries.length ? stats(entries) : null;
  const id = insulinDaily(tempBasals, events);
  const cs = carbStats(events, days);

  // серии по дням для мини-графиков (за выбранный период)
  const carbSeries = carbsByDay(events, days);
  const insByDay = insulinByDay(tempBasals, events, days);
  const insSeries = insByDay.map((x) => x.tdd);
  const insMuted = insByDay.map((x) => !x.covered);

  const cl = carbUnitLabel(cu);
  const carbsDef: MetricDef = {
    title: 'Углеводы', color: 'var(--c-carb)', icon: nutrition,
    hero: ['Всего за день', toCarbs(cs.perDay, cu), cl],
    cards: [['Завтрак', toCarbs(cs.breakfast, cu), cl], ['Ужин', toCarbs(cs.dinner, cu), cl]],
    stats: [['Ср. за приём', toCarbs(cs.avgPerMeal, cu), cl], ['Приёмов в день', String(cs.mealsPerDay), '']],
    note: cs.hasData
      ? 'Считаются только объявленные углеводы (внесённые в приложении или петле). Незалогированная еда сюда не попадает — реальное потребление может быть выше.'
      : 'Углеводы не логируются в ваш Nightscout — тут будет 0. Появятся, если объявлять еду в петле/приложении.',
  };
  const noData = id.coveredDays === 0;
  const insDef: MetricDef = {
    title: 'Инсулин', color: 'var(--c-ins)', icon: medkit,
    hero: ['В среднем в день', noData ? '—' : fmt(id.tddPerDay), 'ед'],
    cards: [['Базал', noData ? '—' : fmt(id.basalPerDay), 'ед'], ['Болюс', noData ? '—' : fmt(id.bolusPerDay), 'ед']],
    stats: [['Ср. болюс', noData ? '—' : fmt(id.bolusAvg), 'ед'], ['Болюсов/день', noData ? '—' : String(id.bolusCount), '']],
    note: noData
      ? 'Недостаточно данных: в Nightscout нет дней с полной выгрузкой temp basal за выбранный период.'
      : `Среднее по ${id.coveredDays} дн. с полными данными (из ${id.totalDays}). У вас помпа Medtronic через AAPS: базал и коррекции петли идут через temp basal — поэтому доза выше «обычного базала». Дни с неполной выгрузкой в Nightscout не учитываются, иначе среднее занижается.`,
  };

  return (
    <Screen tab={0}>
          <DataGate>
          {/* Переключатель разделов — первым и всегда на виду. Он же отвечает на
              вопрос «а где теперь разбор», который возникнет у всех, кто привык к
              плитке на «Сегодня». */}
          <div className="period sec-switch">
            {РАЗДЕЛЫ.map((р) => (
              <button key={р.key} className={'period-seg' + (раздел === р.key ? ' on' : '')}
                onClick={() => setРаздел(р.key)}>
                {р.label}
                {р.key === 'анализ' && новых > 0 && <span className="sec-badge">{новых}</span>}
              </button>
            ))}
          </div>

          {раздел === 'анализ' && <AnalyticsSection встроенный />}
          {раздел === 'отчёт' && <VisitNoteSection встроенный />}
          {раздел === 'метрики' && (<>
          {/* Переключатели периода и метрики липнут под панелью: на длинных экранах
              (90 дней, AGP) они уезжали вверх, и чтобы сменить период, надо было
              прокрутить обратно. Панель контент не накрывает — она обычный флекс-элемент
              над скроллером, — поэтому липнет ровно под ней, без подгонки под её высоту. */}
          <div className="metrics-sticky">
          <div className="period">
            {PERIODS.map((p) => (
              <button key={p.days} className={'period-seg' + (days === p.days ? ' on' : '')} onClick={() => setDays(p.days)}>{p.label}</button>
            ))}
          </div>

          {/* Общая деталь: набор, порядок и значки те же, что в источниках. */}
          <ЧипыПотоков выбран={ПОТОК_МЕТРИКИ[metric]}
            выбрать={(п) => setMetric(МЕТРИКА_ПОТОКА[п])} />
          </div>

          {gathering && (
            <div className="gather-note">
              <Крутилка />
              <span>Собираем историю за {days} дн — данные ещё пополняются, показано не за весь период.</span>
            </div>
          )}

          {metric === 'glucose' ? (
            s ? (
              <>
                <div className="metric-title"><Иконка icon={water} style={{ color: 'var(--c-glu)', fontSize: 26 }} /><span>Время в диапазоне</span></div>
                <div className="agp-card"><TirBar s={s} /></div>
                <div className="stat-grid4">
                  <div className="stat"><div className="stat-label">Среднее</div><div className="stat-val">{toUnits(s.mean)}<span>{unitLabel()}</span></div></div>
                  <div className="stat"><div className="stat-label">GMI (≈HbA1c)</div><div className="stat-val">{fmt(s.gmi)}<span>%</span></div></div>
                  <div className="stat"><div className="stat-label">Вариабельность CV</div><div className="stat-val" style={{ color: s.cv > 36 ? 'var(--c-danger)' : undefined }}>{Math.round(s.cv)}<span>%</span></div></div>
                  <div className="stat"><div className="stat-label">Ст. отклонение</div><div className="stat-val">{toUnits(s.sd)}<span>{unitLabel()}</span></div></div>
                </div>
                <div className="metric-title" style={{ marginTop: 22 }}><span style={{ fontSize: 20 }}>AGP · типовой день</span></div>
                <div className="agp-card"><AgpChart entries={entries} /></div>
                <div className="metric-note">Стандарт AGP: медиана и коридоры 25–75% и 5–95% по времени суток. Цели: время в диапазоне &gt; 70%, CV &lt; 36%.</div>
              </>
            ) : (
              <div className="metric-note" style={{ marginTop: 14 }}>Нет данных.</div>
            )
          ) : (
            (() => {
              const M = metric === 'carbs' ? carbsDef : insDef;
              return (
                <>
                  <div className="metric-title"><Иконка icon={M.icon} style={{ color: M.color, fontSize: 26 }} /><span>{M.title}</span></div>
                  <div className="hero-tile">
                    <div className="hero-tile-top"><span className="hero-tile-label">{M.hero[0]}</span></div>
                    <div className="hero-tile-val"><b>{M.hero[1]}</b><span>{M.hero[2]}</span></div>
                    {metric === 'carbs'
                      ? <MetricBars values={carbSeries} color={M.color} />
                      : <MetricBars values={insSeries} color={M.color} muted={insMuted} />}
                  </div>
                  <div className="metric-cards">
                    {M.cards.map((c, i) => (
                      <div key={i} className="metric-card" style={{ height: 'auto', minHeight: 92 }}>
                        <div className="metric-card-top"><span>{c[0]}</span></div>
                        <div className="metric-card-val"><b>{c[1]}</b><span>{c[2]}</span></div>
                      </div>
                    ))}
                  </div>
                  <div className="metric-cards">
                    {M.stats.map((st, i) => (
                      <div key={i} className="metric-stat">
                        <div className="metric-card-top"><span>{st[0]}</span></div>
                        <div className="metric-card-val"><b>{st[1]}</b><span>{st[2]}</span></div>
                      </div>
                    ))}
                  </div>
                  {M.note && <div className="metric-note">{M.note}</div>}
                </>
              );
            })()
          )}
          </>)}
          </DataGate>
    </Screen>
  );
}
