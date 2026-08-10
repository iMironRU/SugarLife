import { IonPage, IonContent, IonIcon, IonSpinner } from '@ionic/react';
import { useTab } from '@/app/nav';
import { reportContentScroll } from '@/app/panel';
import { water, nutrition, medkit } from 'ionicons/icons';
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

type MetricKey = 'glucose' | 'carbs' | 'insulin';
type Cell = [string, string, string];
interface MetricDef { title: string; color: string; icon: string; hero: Cell; cards: [Cell, Cell]; stats: [Cell, Cell]; note?: string; }

const PERIODS: { days: number; label: string }[] = [
  { days: 3, label: '3 дня' }, { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' }, { days: 90, label: '90 дней' },
];


export default function Metrics() {
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

  const chips: { key: MetricKey; label: string; color: string; icon: string }[] = [
    { key: 'glucose', label: 'Глюкоза', color: 'var(--c-glu)', icon: water },
    { key: 'carbs', label: 'Углеводы', color: 'var(--c-carb)', icon: nutrition },
    { key: 'insulin', label: 'Инсулин', color: 'var(--c-ins)', icon: medkit },
  ];

  return (
    <IonPage>
      <IonContent fullscreen forceOverscroll={false} scrollEvents onIonScroll={reportContentScroll}>
        <div className="screen screen-pad">
          <DataGate>
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

          <div className="metric-chips">
            {chips.map((c) => {
              const on = metric === c.key;
              return (
                <button key={c.key} className={'metric-chip' + (on ? ' on' : '')} onClick={() => setMetric(c.key)}
                  style={on ? { borderColor: `color-mix(in srgb, ${c.color} 60%, transparent)`, background: `color-mix(in srgb, ${c.color} 20%, var(--color-neutral-900))` } : undefined}>
                  <IonIcon icon={c.icon} style={{ color: on ? c.color : 'var(--color-neutral-500)' }} />
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>
          </div>

          {gathering && (
            <div className="gather-note">
              <IonSpinner name="crescent" />
              <span>Собираем историю за {days} дн — данные ещё пополняются, показано не за весь период.</span>
            </div>
          )}

          {metric === 'glucose' ? (
            s ? (
              <>
                <div className="metric-title"><IonIcon icon={water} style={{ color: 'var(--c-glu)', fontSize: 26 }} /><span>Время в диапазоне</span></div>
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
                  <div className="metric-title"><IonIcon icon={M.icon} style={{ color: M.color, fontSize: 26 }} /><span>{M.title}</span></div>
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
          </DataGate>
        </div>
      </IonContent>
    </IonPage>
  );
}
