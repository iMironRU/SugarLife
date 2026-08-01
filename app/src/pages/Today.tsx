import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import {
  restaurantOutline,
  phonePortraitOutline, hardwareChipOutline, waterOutline, warningOutline, refreshOutline,
} from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useStore } from '../data/store';
import { agoText, useUnit } from '../data/units';
import { reportContentScroll } from '../data/panel';
import { getCfg, loadEventsRange, loadDeviceStatusRange, loadTreatmentsRange, type Treatment, type DevPoint } from '../data/nightscout';
import { deviceAges, reservoirStats, insulinDaily } from '../data/treatmentStats';

const DASH = '—';

// склонение «приём/приёма/приёмов»
function mealsWord(n: number): string {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return 'приём';
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return 'приёма';
  return 'приёмов';
}

// Короткий статус помпы
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
  useUnit(); // перерисовка при смене единиц
  const history = useHistory();
  const dev = data?.device || null;

  // события (день датчика + углеводы за сегодня) + история резервуара
  const cfg = getCfg();
  const [events, setEvents] = useState<Treatment[]>([]);
  const [devHist, setDevHist] = useState<DevPoint[]>([]);
  const [tdd, setTdd] = useState<number | null>(null);
  useEffect(() => {
    let cancel = false;
    if (cfg?.enabled && cfg.url) {
      loadEventsRange(cfg.url, cfg.token, 50).then((e) => { if (!cancel) setEvents(e); }).catch(() => {});
      loadDeviceStatusRange(cfg.url, cfg.token, 2000).then((d) => { if (!cancel) setDevHist(d); }).catch(() => {});
      // средний суточный расход за 90 дн — для «хватит инсулина»
      loadTreatmentsRange(cfg.url, cfg.token, 90).then((tb) => {
        if (cancel) return;
        const id = insulinDaily(tb, []);
        setTdd(id.tddPerDay > 5 ? id.tddPerDay : null);
      }).catch(() => {});
    }
    return () => { cancel = true; };
  }, [cfg?.url, cfg?.enabled]);
  const ages = deviceAges(events);
  const rstat = reservoirStats(devHist);

  // углеводы за сегодня (с локальной полуночи)
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const todayCarbs = events.filter((e) => (e.carbs ?? 0) > 0 && e.t >= dayStart.getTime());
  const dayCarbs = Math.round(todayCarbs.reduce((a, b) => a + (b.carbs || 0), 0));
  const mealCount = todayCarbs.length;
  const cob = dev?.cob != null ? Math.round(dev.cob) : null;

  // статус-полоска
  const phone = dev?.uploaderBattery;
  const sensorDay = ages.sensor ? ages.sensor.days + 1 : null;
  const daysLeft = dev?.reservoir != null && tdd ? dev.reservoir / tdd : null;
  const connected = !!(cfg?.enabled && cfg.url);
  const insulinComputing = connected && tdd === null && dev?.reservoir != null;
  const daysLeftText = daysLeft != null ? '~' + fmtDays(daysLeft) + ' дн' : insulinComputing ? '…' : DASH;

  // подсветки резервуара
  const stuck = rstat.flatHours > 8 && !isPaused(dev?.status) && (rstat.current ?? 0) > 0;
  const resChange = ages.reservoir && ages.reservoir.days < 2 ? ages.reservoir : null;

  return (
    <IonPage>
      <IonContent fullscreen scrollEvents onIonScroll={reportContentScroll}>
        <div className="screen">
          {/* панель углеводов (по макету): Б/Ж/У · активные · Еда.
              Б/Ж пусто — Nightscout не отдаёт белки/жиры, фейк не рисуем. */}
          <button className="carb-panel" onClick={() => history.push('/ins')}>
            <div className="carb-macros">
              <div className="carb-macro"><span className="cm-k">Б</span><span className="cm-v">{DASH}</span></div>
              <div className="carb-macro"><span className="cm-k">Ж</span><span className="cm-v">{DASH}</span></div>
              <div className="carb-macro"><span className="cm-k">У</span><span className="cm-v">{dayCarbs}</span><span className="cm-u">г</span></div>
            </div>

            <div className="carb-center">
              <div className="carb-big">{cob != null ? cob : DASH}<span>г</span></div>
              <div className="carb-lbl">активные углеводы</div>
              <div className="carb-sub">всего за день · {dayCarbs} г</div>
            </div>

            <div className="carb-food">
              <IonIcon icon={restaurantOutline} />
              <div className="carb-food-t">Еда</div>
              <div className="carb-food-s">{mealCount} {mealsWord(mealCount)}</div>
            </div>
          </button>

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
        </div>
      </IonContent>
    </IonPage>
  );
}
