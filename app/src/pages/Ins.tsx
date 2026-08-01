import { IonPage, IonContent, IonIcon } from '@ionic/react';
import { reportContentScroll } from '../data/panel';
import { water, batteryHalf, pulse, flash, add, remove, chevronForward, syncCircle } from 'ionicons/icons';
import { useState, useEffect } from 'react';
import { useStore, useWritable } from '../data/store';
import { detectTherapy, therapyLabel } from '../data/therapy';
import { getCfg, loadEventsRange, loadTreatmentsRange, type Treatment } from '../data/nightscout';
import { deviceAges, type Age } from '../data/treatmentStats';
import { fmt, toUnits, unitLabel, useUnit } from '../data/units';
import InsulinTimeChart from '../components/InsulinTimeChart';

const round1 = (v: number) => Math.round(v * 10) / 10;
const ageText = (a: Age) => a.days >= 1 ? a.days + ' дн' : a.hours + ' ч';
const SHOW_BOLUS_CALC = false; // временно скрыт калькулятор болюса
const WINDOWS = [1, 3, 6, 12, 24];

export default function Ins() {
  const { data } = useStore();
  const dev = data?.device || null;
  const profile = data?.profile || null;
  const latest = data?.latest || null;
  const therapy = detectTherapy(data);
  const isPen = therapy === 'pen';
  const unit = useUnit();
  const writable = useWritable();
  const gluShort = (mmol: number) => (unit === 'mgdl' ? String(Math.round(mmol * 18)) : fmt(mmol));

  // расходники помпы — из событий замен в Nightscout
  const cfg = getCfg();
  const [events, setEvents] = useState<Treatment[]>([]);
  useEffect(() => {
    let cancel = false;
    if (cfg?.enabled && cfg.url) {
      loadEventsRange(cfg.url, cfg.token, 30).then((e) => { if (!cancel) setEvents(e); }).catch(() => {});
    }
    return () => { cancel = true; };
  }, [cfg?.url, cfg?.enabled]);
  const ages = deviceAges(events);
  const hasSupplies = !isPen && (ages.site || ages.reservoir || ages.battery);

  // подача инсулина за 24 ч (temp basal + болюсы) для графика
  const [win, setWin] = useState(3);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  useEffect(() => {
    let cancel = false;
    if (cfg?.enabled && cfg.url) {
      loadTreatmentsRange(cfg.url, cfg.token, 1).then((t) => { if (!cancel) setTreatments(t); }).catch(() => {});
    }
    return () => { cancel = true; };
  }, [cfg?.url, cfg?.enabled]);
  const tempBasals = treatments.filter((t) => t.type === 'Temp Basal');
  const boluses = treatments.filter((t) => t.type !== 'Temp Basal' && (t.insulin ?? 0) > 0);
  const baseBasal = dev?.baseBasal ?? profile?.basal ?? null;

  // калькулятор болюса из профиля
  const IC = profile?.ic ?? 8;
  const ISF = profile?.isf ?? 2.0;
  const TARGET = profile && profile.targetLow != null
    ? (profile.targetLow + (profile.targetHigh ?? profile.targetLow)) / 2 : 6.0;
  const IOB = dev?.iob ?? 0;
  const bg = latest?.mmol ?? 6.0;
  const [carbs, setCarbs] = useState(40);
  const food = carbs / IC;
  const corr = Math.max(0, (bg - TARGET) / ISF);
  const suggested = Math.max(0, round1(food + corr - IOB));

  return (
    <IonPage>
      <IonContent fullscreen scrollEvents onIonScroll={reportContentScroll}>
        <div className="screen screen-pad">
          <div className="mon-head">
            <div>
              <div className="mon-title">Инсулин</div>
              <div className="mon-sub">{therapyLabel(therapy)}{therapy !== 'pen' ? ' · авто' : ''}</div>
            </div>
          </div>

          {!isPen && (
            <>
              {/* статус помпы/петли */}
              <div className="mon-status">
                <div className="mon-stat">
                  <IonIcon icon={pulse} style={{ color: 'var(--c-ins)' }} />
                  <div className="mon-stat-val">{dev?.iob != null ? fmt(dev.iob) : '—'}</div>
                  <div className="mon-stat-label">активный ед</div>
                </div>
                <div className="mon-stat">
                  <IonIcon icon={water} style={{ color: 'var(--c-ins)' }} />
                  <div className="mon-stat-val">{dev?.reservoir != null ? Math.round(dev.reservoir) : '—'}</div>
                  <div className="mon-stat-label">резервуар ед</div>
                </div>
                <div className="mon-stat">
                  <IonIcon icon={batteryHalf} style={{ color: 'var(--color-accent)' }} />
                  <div className="mon-stat-val">{dev?.pumpBattery != null ? dev.pumpBattery + '%' : '—'}</div>
                  <div className="mon-stat-label">помпа</div>
                </div>
              </div>

              {/* базал */}
              <div className="basal-card">
                <div className="basal-head">
                  <IonIcon icon={syncCircle} style={{ color: therapy === 'loop' ? 'var(--c-glu)' : 'var(--color-accent)' }} />
                  <span>{dev?.status || (therapy === 'loop' ? 'Замкнутый цикл' : 'Помпа')}</span>
                </div>
                <div className="basal-rows">
                  <div className="basal-row">
                    <span>Базальная скорость</span>
                    <b>{dev?.baseBasal != null ? fmt(dev.baseBasal) : profile?.basal != null ? fmt(profile.basal) : '—'} ед/ч</b>
                  </div>
                  <div className="basal-row">
                    <span>Временный базал</span>
                    <b>{dev?.tempRate != null ? fmt(dev.tempRate) + ' ед/ч' : 'выкл'}{dev?.tempRemaining ? ` · ${dev.tempRemaining} мин` : ''}</b>
                  </div>
                  <div className="basal-row">
                    <span>Последний болюс</span>
                    <b>{dev?.lastBolus != null ? fmt(dev.lastBolus) + ' ед' : '—'}</b>
                  </div>
                </div>
              </div>

              {/* график подачи инсулина (базал + болюсы) */}
              <div className="section-label sec">Подача инсулина</div>
              <div className="win-chips">
                {WINDOWS.map((w) => (
                  <button key={w} className={'win-chip' + (win === w ? ' on' : '')} onClick={() => setWin(w)}>{w}ч</button>
                ))}
              </div>
              <InsulinTimeChart tempBasals={tempBasals} boluses={boluses} windowH={win} baseBasal={baseBasal} />
              <div className="chart-legend">
                <span className="lg-item"><i className="lg-dot" style={{ background: 'var(--c-ins)' }} />базал, ед/ч</span>
                <span className="lg-item"><i className="lg-dot" style={{ background: 'var(--c-carb)' }} />болюс, ед</span>
                <span className="lg-item"><i className="lg-dash" />базовая скорость</span>
              </div>
            </>
          )}

          {isPen && (
            <div className="basal-card">
              <div className="basal-head"><IonIcon icon={flash} style={{ color: 'var(--c-ins)' }} /><span>Шприц-ручка</span></div>
              <div className="basal-rows">
                <div className="basal-row"><span>Последняя инъекция</span><b>{dev?.lastBolus != null ? fmt(dev.lastBolus) + ' ед' : '—'}</b></div>
                <div className="basal-row"><span>Активный инсулин</span><b>{dev?.iob != null ? fmt(dev.iob) + ' ед' : '—'}</b></div>
              </div>
            </div>
          )}

          {/* расходники помпы */}
          {hasSupplies && (
            <>
              <div className="section-label sec">Расходники</div>
              <div className="sensor-ages sensor-ages-solo">
                {ages.site && <div className="age-pill"><span>Канюля</span><b>{ageText(ages.site)}</b></div>}
                {ages.reservoir && <div className="age-pill"><span>Резервуар</span><b>{ageText(ages.reservoir)}</b></div>}
                {ages.battery && <div className="age-pill"><span>Батарея</span><b>{ageText(ages.battery)}</b></div>}
              </div>
            </>
          )}

          {/* калькулятор болюса — временно скрыт (SHOW_BOLUS_CALC) */}
          {SHOW_BOLUS_CALC && (
            <>
              <div className="section-label sec">Калькулятор болюса</div>
              <div className="bolus-card">
                <div className="bolus-input">
                  <span>Углеводы</span>
                  <div className="stepper">
                    <button onClick={() => setCarbs((c) => Math.max(0, c - 5))}><IonIcon icon={remove} /></button>
                    <b>{carbs}<i>г</i></b>
                    <button onClick={() => setCarbs((c) => Math.min(300, c + 5))}><IonIcon icon={add} /></button>
                  </div>
                </div>
                <div className="bolus-input">
                  <span>Текущий сахар</span>
                  <b className="bolus-bg">{toUnits(bg)} <i>{unitLabel()}</i></b>
                </div>
                <div className="bolus-result">
                  <div className="bolus-rec-label">Рекомендовано</div>
                  <div className="bolus-rec"><b>{fmt(suggested)}</b><span>ед</span></div>
                  <div className="bolus-breakdown">
                    на еду {fmt(round1(food))} · коррекция {fmt(round1(corr))} · − активный {fmt(round1(IOB))}
                  </div>
                </div>
                <div className="bolus-note">
                  {profile ? `Профиль «${profile.name}»: СУИ 1:${fmt(IC)} · ISF ${gluShort(ISF)} · цель ${toUnits(TARGET)} ${unitLabel()}` : 'Профиль не загружен — значения по умолчанию.'}
                </div>
              </div>
            </>
          )}

          {/* настройки инсулина */}
          <div className="section-label sec">Инсулины</div>
          <div className="list">
            <button className="list-row" disabled>
              <IonIcon icon={flash} className="list-ico" />
              <span className="list-title">Быстрый инсулин</span>
              <span className="list-value">—</span>
              <IonIcon icon={chevronForward} className="list-chev" />
            </button>
            <button className="list-row" disabled>
              <IonIcon icon={water} className="list-ico" />
              <span className="list-title">Базальный инсулин</span>
              <span className="list-value">—</span>
              <IonIcon icon={chevronForward} className="list-chev" />
            </button>
          </div>

          <div className="metric-note">
            Режим определяется автоматически из Nightscout. У вас — {therapyLabel(therapy).toLowerCase()}: инсулин идёт базалом, дискретных болюсов почти нет. {writable
              ? 'Подача болюса (запись в Nightscout) — в планах.'
              : 'Запись в Nightscout выключена: нет токена с правом записи, поэтому калькулятор работает только на чтение (подать/записать нельзя).'}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
