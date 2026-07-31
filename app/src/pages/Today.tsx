import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import {
  pulse, flash, moon, nutrition, medkit,
  phonePortraitOutline, hardwareChipOutline, waterOutline, warningOutline, refreshOutline,
} from 'ionicons/icons';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../data/store';
import { getSince } from '../data/db';
import { toUnits, agoText, fmt, unitLabel, useUnit } from '../data/units';
import { arrowChar, getCfg, loadEventsRange, loadDeviceStatusRange, loadTreatmentsRange, type Treatment, type DevPoint, type Entry } from '../data/nightscout';
import { deviceAges, reservoirStats, insulinDaily } from '../data/treatmentStats';
import { analyze, type Analysis } from '../data/analysis';
import { useTheme } from '../theme/useTheme';
import CircleSparkline from '../components/CircleSparkline';
import Insights from '../components/Insights';

const ANALYSIS_DAYS = 14;

const DASH = '—';

// Короткий статус помпы, чтобы влезал в крыло
function shortStatus(s?: string | null): string {
  if (!s) return DASH;
  const l = s.toLowerCase();
  if (l.includes('приостан') || l.includes('пауза') || l.includes('suspend') || l.includes('stop')) return 'Пауза';
  if (l.includes('замкнут') || l.includes('closed')) return 'Цикл вкл';
  if (l.includes('открыт') || l.includes('open')) return 'Цикл выкл';
  return s;
}
const isPaused = (s?: string | null) => shortStatus(s) === 'Пауза';
const fmtDays = (d: number) => (d < 10 ? d.toFixed(1).replace('.', ',') : String(Math.round(d)));

export default function Today() {
  const { data, live } = useStore();
  const { toggle } = useTheme();
  const unit = useUnit(); // перерисовка/пересчёт при смене единиц
  const history = useHistory();
  const latest = data?.latest || null;
  const dev = data?.device || null;

  // события (для дня датчика) + история резервуара (расход/заправки)
  const cfg = getCfg();
  const [events, setEvents] = useState<Treatment[]>([]);
  const [devHist, setDevHist] = useState<DevPoint[]>([]);
  useEffect(() => {
    let cancel = false;
    if (cfg?.enabled && cfg.url) {
      loadEventsRange(cfg.url, cfg.token, 30).then((e) => { if (!cancel) setEvents(e); }).catch(() => {});
      loadDeviceStatusRange(cfg.url, cfg.token, 2000).then((d) => { if (!cancel) setDevHist(d); }).catch(() => {});
    }
    return () => { cancel = true; };
  }, [cfg?.url, cfg?.enabled]);
  const ages = deviceAges(events);
  const rstat = reservoirStats(devHist);

  // данные для «Обзора» + средний суточный расход (TDD) за 90 дн для «хватит инсулина»
  const [anaEnt, setAnaEnt] = useState<Entry[]>([]);
  const [anaCov, setAnaCov] = useState<{ covered: number; total: number } | null>(null);
  const [tdd, setTdd] = useState<number | null>(null);
  useEffect(() => {
    let cancel = false;
    if (cfg?.enabled && cfg.url) {
      (async () => {
        try {
          const [ent, tb] = await Promise.all([
            getSince(Date.now() - ANALYSIS_DAYS * 86400e3),
            loadTreatmentsRange(cfg!.url, cfg!.token, 90), // 90 дн — устойчивый средний расход
          ]);
          if (cancel) return;
          const id = insulinDaily(tb, []);
          setAnaEnt(ent);
          setAnaCov({ covered: id.coveredDays, total: id.totalDays });
          setTdd(id.tddPerDay > 5 ? id.tddPerDay : null);
        } catch { /* ignore */ }
      })();
    }
    return () => { cancel = true; };
  }, [cfg?.url, cfg?.enabled]);
  const analysis = useMemo<Analysis | null>(
    () => (anaCov ? analyze(anaEnt, events, ANALYSIS_DAYS, { basalCoverage: anaCov, uploaderBattery: dev?.uploaderBattery ?? null }) : null),
    [anaEnt, anaCov, events, dev?.uploaderBattery, unit],
  );

  const glucose = latest ? toUnits(latest.mmol) : DASH;
  const arrow = latest ? arrowChar(latest.dir) : '';
  const ago = latest ? agoText(latest.t) : DASH;
  const minsAgo = latest ? Math.round((Date.now() - latest.t) / 60000) : null;
  const fresh = minsAgo == null ? DASH : minsAgo < 1 ? 'сейчас' : minsAgo + ' мин';

  const reservoir = dev?.reservoir != null ? Math.round(dev.reservoir) + ' ед' : DASH;
  const pumpStatus = shortStatus(dev?.status);
  const cob = dev?.cob != null ? String(Math.round(dev.cob)) : DASH;
  const iob = dev?.iob != null ? fmt(dev.iob) : DASH;

  // статус-полоска
  const phone = dev?.uploaderBattery;
  const sensorDay = ages.sensor ? ages.sensor.days + 1 : null;
  // на сколько хватит: остаток резервуара ÷ средний суточный расход за 90 дн
  const daysLeft = dev?.reservoir != null && tdd ? dev.reservoir / tdd : null;

  // подсветки резервуара
  const stuck = rstat.flatHours > 8 && !isPaused(dev?.status) && (rstat.current ?? 0) > 0;
  // замена резервуара — по событию Insulin Change (надёжно), а не по скачку значения
  const resChange = ages.reservoir && ages.reservoir.days < 2 ? ages.reservoir : null;

  return (
    <IonPage>
      <IonContent fullscreen>
        <div className="screen">
          <div className="sync-row">
            <span className="sync"><span className="heart">♥</span> {live ? 'реальное время' : latest ? 'Обновлено ' + agoText(data!.updatedAt) : 'Нет данных'}</span>
            <button className="theme-btn" onClick={toggle} aria-label="Тема"><IonIcon icon={moon} /></button>
          </div>

          {/* три кнопки — НМГ | круг | Помпа */}
          <div className="hero">
            <div className="hero-rect">
              <button className="hero-btn hero-nmg" onClick={() => history.push('/mon')}>
                <span className="wing-ico"><IonIcon icon={pulse} /></span>
                <span className="wing-head">
                  <span className="wing-title">НМГ</span>
                  {live && <span className="live-dot" title="реальное время" />}
                </span>
                <span className="wing-sub">обновлено</span>
                <span className="wing-val">{fresh}</span>
              </button>

              <div className="hero-gap" />

              <button className="hero-btn hero-pump" onClick={() => history.push('/ins')}>
                <span className="wing-ico"><IonIcon icon={flash} /></span>
                <span className="wing-title">Помпа</span>
                <span className="wing-sub">{pumpStatus}</span>
                <span className="wing-val">{reservoir}</span>
                <span className="wing-sub">резервуар</span>
              </button>
            </div>

            <button className="hero-circle" onClick={() => history.push('/mon')} aria-label="Глюкоза">
              <CircleSparkline entries={data?.entries || []} />
              <span className="circle-inner">
                <span className="circle-val">
                  <span>{glucose}</span>
                  {arrow && <span className="circle-arrow">{arrow}</span>}
                </span>
                <span className="circle-unit">{unitLabel()}</span>
                <span className="circle-ago">{ago}</span>
              </span>
            </button>
          </div>

          {/* живые показатели: активные углеводы и активный инсулин */}
          <div className="today-stats">
            <button className="today-stat" onClick={() => history.push('/ins')}>
              <IonIcon icon={nutrition} style={{ color: 'var(--c-carb)' }} />
              <div className="today-stat-val">{cob}<i> г</i></div>
              <div className="today-stat-label">активные углеводы</div>
            </button>
            <button className="today-stat" onClick={() => history.push('/ins')}>
              <IonIcon icon={medkit} style={{ color: 'var(--c-ins)' }} />
              <div className="today-stat-val">{iob}<i> ед</i></div>
              <div className="today-stat-label">активный инсулин</div>
            </button>
          </div>

          {/* статус: телефон · датчик · инсулин */}
          <div className="today-status">
            <div className="tstat">
              <IonIcon icon={phonePortraitOutline} style={{ color: phone != null && phone <= 20 ? 'var(--c-danger)' : 'var(--color-accent)' }} />
              <div className="tstat-val">{phone != null ? phone + '%' : DASH}</div>
              <div className="tstat-label">телефон</div>
            </div>
            <div className="tstat" onClick={() => history.push('/mon')}>
              <IonIcon icon={hardwareChipOutline} style={{ color: 'var(--color-accent)' }} />
              <div className="tstat-val">{sensorDay != null ? 'день ' + sensorDay : DASH}</div>
              <div className="tstat-label">датчик</div>
            </div>
            <div className="tstat" onClick={() => history.push('/ins')}>
              <IonIcon icon={waterOutline} style={{ color: 'var(--c-ins)' }} />
              <div className="tstat-val">{daysLeft != null ? '~' + fmtDays(daysLeft) + ' дн' : DASH}</div>
              <div className="tstat-label">хватит инсулина</div>
            </div>
          </div>

          {/* подсветки резервуара */}
          {stuck && (
            <div className="today-alert warn">
              <IonIcon icon={warningOutline} />
              <div>
                <b>Резервуар не меняется {Math.round(rstat.flatHours)} ч</b>
                <span>А помпа не на паузе — инсулин должен расходоваться. Проверь подачу (окклюзия, катетер, датчик резервуара).</span>
              </div>
            </div>
          )}
          {resChange && (
            <div className="today-alert info">
              <IonIcon icon={refreshOutline} />
              <div>
                <b>Резервуар заменён {agoText(resChange.at)}</b>
                <span>Свежий резервуар — отсчёт срока пошёл заново.</span>
              </div>
            </div>
          )}

          {/* Обзор: готовность к Autotune + инсайты по вкладкам */}
          <div className="section-label" style={{ marginTop: 22 }}>Обзор</div>
          <Insights analysis={analysis} />
        </div>
      </IonContent>
    </IonPage>
  );
}
