import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { reportContentScroll } from '../data/panel';
import { chevronForward, water, nutrition, medkit } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useEntries } from '../data/db';
import { getCfg, loadEventsRange, loadTreatmentsRange, type Treatment } from '../data/nightscout';
import { stats } from '../data/agp';
import { carbStats, insulinDaily } from '../data/treatmentStats';
import { fmt, toUnits, unitLabel, useUnit, useCarbUnit, toCarbs, carbUnitLabel } from '../data/units';
import TirBar from '../components/TirBar';
import AgpChart from '../components/AgpChart';

type MetricKey = 'glucose' | 'carbs' | 'insulin';
type Cell = [string, string, string];
interface MetricDef { title: string; color: string; icon: string; hero: Cell; cards: [Cell, Cell]; stats: [Cell, Cell]; note?: string; }

const PERIODS: { days: number; label: string }[] = [
  { days: 3, label: '3 дня' }, { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' }, { days: 90, label: '90 дней' },
];


export default function Metrics() {
  const [days, setDays] = useState(3);
  const [metric, setMetric] = useState<MetricKey>('glucose');
  useUnit(); // перерисовка при смене единиц
  const cu = useCarbUnit(); // единицы углеводов (граммы/Х.Е.)
  const [events, setEvents] = useState<Treatment[]>([]);
  const [tempBasals, setTempBasals] = useState<Treatment[]>([]);

  const cfg = getCfg();
  const enabled = !!(cfg && cfg.enabled && cfg.url);
  const basalDays = Math.min(days, 14); // базал усредняем по свежему окну (без тяжёлой выборки за 90 дней)

  // глюкоза — из локальной БД; болюсы/углеводы — из событий; базал — из temp basal
  const entries = useEntries(days * 86400e3);
  useEffect(() => {
    let cancel = false;
    if (enabled) {
      loadEventsRange(cfg!.url, cfg!.token, days).then((e) => { if (!cancel) setEvents(e); }).catch(() => { if (!cancel) setEvents([]); });
      loadTreatmentsRange(cfg!.url, cfg!.token, basalDays).then((t) => { if (!cancel) setTempBasals(t); }).catch(() => { if (!cancel) setTempBasals([]); });
    } else { setEvents([]); setTempBasals([]); }
    return () => { cancel = true; };
  }, [days, basalDays, enabled, cfg?.url]);

  const s = entries.length ? stats(entries) : null;
  const id = insulinDaily(tempBasals, events);
  const cs = carbStats(events, days);

  const cl = carbUnitLabel(cu);
  const carbsDef: MetricDef = {
    title: 'Углеводы', color: 'var(--c-carb)', icon: nutrition,
    hero: ['Всего за день', toCarbs(cs.perDay, cu), cl],
    cards: [['Завтрак', toCarbs(cs.breakfast, cu), cl], ['Ужин', toCarbs(cs.dinner, cu), cl]],
    stats: [['Ср. за приём', toCarbs(cs.avgPerMeal, cu), cl], ['Приёмов пищи', String(cs.mealCount), '']],
    note: cs.hasData ? undefined : 'Углеводы не логируются в ваш Nightscout — тут будет 0. Появятся, если объявлять еду в петле/приложении.',
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
              <div className="metric-note" style={{ marginTop: 30 }}>Нет данных. Подключите Nightscout в профиле.</div>
            )
          ) : (
            (() => {
              const M = metric === 'carbs' ? carbsDef : insDef;
              return (
                <>
                  <div className="metric-title"><IonIcon icon={M.icon} style={{ color: M.color, fontSize: 26 }} /><span>{M.title}</span></div>
                  <div className="hero-tile">
                    <div className="hero-tile-top"><span className="hero-tile-label">{M.hero[0]}</span><IonIcon icon={chevronForward} /></div>
                    <div className="hero-tile-val"><b>{M.hero[1]}</b><span>{M.hero[2]}</span></div>
                    <svg className="hero-svg" viewBox="0 0 300 90" preserveAspectRatio="none">
                      <path d="M8,66 C70,62 110,54 155,50 C210,45 255,26 292,16 L292,90 L8,90 Z" fill={M.color} fillOpacity="0.16" />
                      <path d="M8,66 C70,62 110,54 155,50 C210,45 255,26 292,16" fill="none" stroke={M.color} strokeWidth="2.5" />
                    </svg>
                  </div>
                  <div className="metric-cards">
                    {M.cards.map((c, i) => (
                      <div key={i} className="metric-card" style={{ height: 'auto', minHeight: 92 }}>
                        <div className="metric-card-top"><span>{c[0]}</span><IonIcon icon={chevronForward} /></div>
                        <div className="metric-card-val"><b>{c[1]}</b><span>{c[2]}</span></div>
                      </div>
                    ))}
                  </div>
                  <div className="metric-cards">
                    {M.stats.map((st, i) => (
                      <div key={i} className="metric-stat">
                        <div className="metric-card-top"><span>{st[0]}</span><IonIcon icon={chevronForward} /></div>
                        <div className="metric-card-val"><b>{st[1]}</b><span>{st[2]}</span></div>
                      </div>
                    ))}
                  </div>
                  {M.note && <div className="metric-note">{M.note}</div>}
                </>
              );
            })()
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
