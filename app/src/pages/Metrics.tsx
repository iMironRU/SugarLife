import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { chevronForward, water, nutrition, medkit } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useStore } from '../data/store';
import { useEntries } from '../data/db';
import { getCfg, loadTreatmentsRange, type Treatment } from '../data/nightscout';
import { stats } from '../data/agp';
import { insulinStats, carbStats } from '../data/treatmentStats';
import { fmt } from '../data/units';
import TirBar from '../components/TirBar';
import AgpChart from '../components/AgpChart';

type MetricKey = 'glucose' | 'carbs' | 'insulin';
type Cell = [string, string, string];
interface MetricDef { title: string; color: string; icon: string; hero: Cell; cards: [Cell, Cell]; stats: [Cell, Cell]; note?: string; }

const PERIODS: { days: number; label: string }[] = [
  { days: 3, label: '3 дня' }, { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' }, { days: 90, label: '90 дней' },
];

const r0 = (v: number) => String(Math.round(v));

export default function Metrics() {
  const { data } = useStore();
  const [days, setDays] = useState(3);
  const [metric, setMetric] = useState<MetricKey>('glucose');
  const [rangeTreat, setRangeTreat] = useState<Treatment[] | null>(null);

  const cfg = getCfg();
  const enabled = !!(cfg && cfg.enabled && cfg.url);

  // глюкоза — из локальной БД (накопленная история), лечения — из Nightscout за период
  const entries = useEntries(days * 86400e3);
  useEffect(() => {
    let cancel = false;
    if (enabled) {
      loadTreatmentsRange(cfg!.url, cfg!.token, days).then((t) => { if (!cancel) setRangeTreat(t); }).catch(() => { if (!cancel) setRangeTreat(null); });
    } else setRangeTreat(null);
    return () => { cancel = true; };
  }, [days, enabled, cfg?.url]);

  const treatments = rangeTreat || data?.treatments || [];
  const s = entries.length ? stats(entries) : null;
  const is = insulinStats(treatments, days);
  const cs = carbStats(treatments, days);

  const carbsDef: MetricDef = {
    title: 'Углеводы', color: 'var(--c-carb)', icon: nutrition,
    hero: ['Всего за день', r0(cs.perDay), 'г'],
    cards: [['Завтрак', r0(cs.breakfast), 'г'], ['Ужин', r0(cs.dinner), 'г']],
    stats: [['Ср. за приём', r0(cs.avgPerMeal), 'г'], ['Приёмов пищи', String(cs.mealCount), '']],
    note: cs.hasData ? undefined : 'Углеводы не логируются в ваш Nightscout — тут будет 0. Появятся, если объявлять еду в петле/приложении.',
  };
  const insDef: MetricDef = {
    title: 'Инсулин', color: 'var(--c-ins)', icon: medkit,
    hero: ['Всего за день', fmt(is.tddPerDay), 'ед'],
    cards: [['Базал', fmt(is.basalPerDay), 'ед'], ['Болюс', fmt(is.bolusPerDay), 'ед']],
    stats: [['Ср. болюс', fmt(is.avgBolus), 'ед'], ['Болюсов/день', String(is.bolusCount), '']],
    note: 'Базал оценивается интегрированием temp basal; у петли это основная подача.',
  };

  const chips: { key: MetricKey; label: string; color: string; icon: string }[] = [
    { key: 'glucose', label: 'Глюкоза', color: 'var(--c-glu)', icon: water },
    { key: 'carbs', label: 'Углеводы', color: 'var(--c-carb)', icon: nutrition },
    { key: 'insulin', label: 'Инсулин', color: 'var(--c-ins)', icon: medkit },
  ];

  return (
    <IonPage>
      <IonContent fullscreen>
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
                  <div className="stat"><div className="stat-label">Среднее</div><div className="stat-val">{fmt(s.mean)}<span>ммоль/л</span></div></div>
                  <div className="stat"><div className="stat-label">GMI (≈HbA1c)</div><div className="stat-val">{fmt(s.gmi)}<span>%</span></div></div>
                  <div className="stat"><div className="stat-label">Вариабельность CV</div><div className="stat-val" style={{ color: s.cv > 36 ? 'var(--c-danger)' : undefined }}>{Math.round(s.cv)}<span>%</span></div></div>
                  <div className="stat"><div className="stat-label">Ст. отклонение</div><div className="stat-val">{fmt(s.sd)}<span>ммоль/л</span></div></div>
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
