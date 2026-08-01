import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import {
  nutrition, medkit, chevronForward,
  phonePortraitOutline, hardwareChipOutline, waterOutline, warningOutline, refreshOutline,
} from 'ionicons/icons';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../data/store';
import { getSince } from '../data/db';
import { agoText, fmt, useUnit } from '../data/units';
import { getCfg, loadEventsRange, loadDeviceStatusRange, loadTreatmentsRange, type Treatment, type DevPoint, type Entry } from '../data/nightscout';
import { deviceAges, reservoirStats, insulinDaily } from '../data/treatmentStats';
import { analyze, type Analysis } from '../data/analysis';
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
  const { data } = useStore();
  const unit = useUnit(); // перерисовка/пересчёт при смене единиц
  const history = useHistory();
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
  const [obzorOpen, setObzorOpen] = useState(true);
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

  const cob = dev?.cob != null ? String(Math.round(dev.cob)) : DASH;
  const iob = dev?.iob != null ? fmt(dev.iob) : DASH;

  // статус-полоска
  const phone = dev?.uploaderBattery;
  const sensorDay = ages.sensor ? ages.sensor.days + 1 : null;
  // на сколько хватит: остаток резервуара ÷ средний суточный расход за 90 дн
  const daysLeft = dev?.reservoir != null && tdd ? dev.reservoir / tdd : null;
  const connected = !!(cfg?.enabled && cfg.url);
  const insulinComputing = connected && tdd === null && dev?.reservoir != null; // ещё считаем расход
  const daysLeftText = daysLeft != null ? '~' + fmtDays(daysLeft) + ' дн' : insulinComputing ? '…' : DASH;

  // подсветки резервуара
  const stuck = rstat.flatHours > 8 && !isPaused(dev?.status) && (rstat.current ?? 0) > 0;
  // замена резервуара — по событию Insulin Change (надёжно), а не по скачку значения
  const resChange = ages.reservoir && ages.reservoir.days < 2 ? ages.reservoir : null;

  return (
    <IonPage>
      <IonContent fullscreen>
        <div className="screen">
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
              <div className="tstat-val">{daysLeftText}</div>
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

          {/* Обзор: инсайты по вкладкам (сворачиваемый) */}
          <button className="section-toggle" onClick={() => setObzorOpen((o) => !o)}>
            <span className="section-label">Обзор</span>
            <IonIcon icon={chevronForward} className={'section-chev' + (obzorOpen ? ' open' : '')} />
          </button>
          {obzorOpen && <Insights analysis={analysis} />}
        </div>
      </IonContent>
    </IonPage>
  );
}
