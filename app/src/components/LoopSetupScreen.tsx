import { IonModal, IonContent, IonFooter, IonIcon } from '@ionic/react';
import { chevronBack, checkmarkCircle, closeCircle, alertCircle, lockClosedOutline, createOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useStore } from '../data/store';
import { useDeviceConfig, isModelKnown } from '../data/deviceConfig';
import { pumpById, sensorById } from '../data/catalog';
import HoldButton from './HoldButton';
import {
  LOOP_MODES, limitsFor, outOfRec, anyOutOfRec, fmtLimit,
  useLoopProfile, saveLoopProfile, type LoopModeId, type LoopLimit,
} from '../data/loopProfile';

/* Мастер настройки профиля петли — пять шагов из прототипа (inbox/loop.zip):
   Оборудование → Режим → Лимиты → Деградация → Проверка.

   ТОЛЬКО интерфейс: команд в помпу отсюда не уходит, приложение на L0
   (см. docs/decisions/0004-loop-pro-redakciya.md).

   Отличие от прототипа одно и намеренное: шаг «Оборудование» опрашивает РЕАЛЬНЫЕ
   устройства, а не показывает захардкоженный список. Фикцию на экране, где
   настраивают подачу, показывать нельзя. */
type Step = 0 | 1 | 2 | 3 | 4;
const STEPS = ['Оборудование', 'Режим петли', 'Лимиты', 'Деградация', 'Проверка'];

type Check = { ok: 'yes' | 'no' | 'maybe'; name: string; note: string };

export default function LoopSetupScreen({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const profile = useLoopProfile();
  const [step, setStep] = useState<Step>(0);
  const [editing, setEditing] = useState<string | null>(null);
  // режим требуется выбрать ЯВНО: «Далее» заперта, пока не ткнули (как в прототипе)
  const [picked, setPicked] = useState<LoopModeId | null>(profile.savedAt ? profile.mode : null);
  const [done, setDone] = useState(false);
  const { data } = useStore();
  const devCfg = useDeviceConfig();

  const close = () => { onClose(); setStep(0); setEditing(null); setDone(false); };

  const dev = data?.device ?? null;
  const pump = isModelKnown(devCfg.pumpId) ? pumpById(devCfg.pumpId) : null;
  const sensor = isModelKnown(devCfg.sensorId) ? sensorById(devCfg.sensorId) : null;
  const checks: Check[] = [
    pump ? { ok: 'yes', name: `Помпа ${pump.model}`, note: 'модель записана в «Устройствах»' }
         : { ok: 'maybe', name: 'Помпа — модель не указана', note: 'без модели неизвестно, какие полномочия она поддерживает' },
    sensor ? { ok: 'yes', name: `НМГ ${sensor.name}`, note: 'модель записана' }
           : { ok: 'maybe', name: 'НМГ — модель не указана', note: 'данные идут, но модель не выбрана' },
    data?.latest ? { ok: 'yes', name: 'Данные гликемии поступают', note: 'последняя точка получена' }
                 : { ok: 'no', name: 'Нет данных гликемии', note: 'без НМГ недоступен ни один режим' },
    dev?.baseBasal != null ? { ok: 'yes', name: 'Базальный профиль читается', note: `текущая скорость ${dev.baseBasal} ЕД/ч` }
                           : { ok: 'maybe', name: 'Базальный профиль неизвестен', note: 'не пришёл из Nightscout' },
    { ok: 'maybe', name: 'Отправка команд в помпу', note: 'канала записи нет — приложение только читает' },
    { ok: 'no', name: 'Второй гормон отсутствует', note: 'двухгормональные режимы недоступны' },
  ];

  const mode = LOOP_MODES.find((m) => m.id === profile.mode)!;
  const limits = limitsFor(profile.mode);
  const needDoctor = anyOutOfRec(profile);

  const bump = (l: LoopLimit, delta: number) => {
    const v = Math.min(l.max, Math.max(l.min, +(profile.values[l.id] + delta).toFixed(3)));
    saveLoopProfile({ values: { ...profile.values, [l.id]: v } });
  };

  const apply = () => { saveLoopProfile({ savedAt: Date.now() }); setDone(true); };

  const canNext = step !== 1 || picked != null;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={close} className="full-page">
      <IonContent className="sheet wz">
        <div className="wz-top">ШАГ {step + 1} ИЗ 5 · {STEPS[step].toUpperCase()}</div>
        <div className="wz-prog">
          {STEPS.map((s, i) => (
            <span key={s} className={'wz-dot' + (i < step ? ' passed' : i === step ? ' on' : '')} />
          ))}
        </div>

        <div className="wz-l0">
          <IonIcon icon={lockClosedOutline} />
          <span>Сейчас L0: команды в помпу не отправляются. Это настройка профиля, не включение подачи.</span>
        </div>

        {done ? (
          <>
            <h2 className="wz-h">Профиль применён</h2>
            <div className="wz-fixed ok">
              <div className="wz-fixed-v ok">Петля стартует на уровне L2</div>
              <div className="sheet-note">
                И поднимется до выбранного режима после трёх циклов без замечаний. Так уровень не
                скачет на каждом разрыве связи.
              </div>
            </div>
            <div className="sheet-note">
              Профиль сохранён на этом устройстве. Подача не включена: приложение остаётся на L0.
            </div>
          </>
        ) : (
          <>
            <h2 className="wz-h">{STEPS[step]}</h2>

            {step === 0 && (
              <>
                <p className="wz-lede">Опрос устройств. Перечень доступных режимов определяется их возможностями.</p>
                {checks.map((c) => (
                  <div key={c.name} className="wz-card wz-hw">
                    <IonIcon className={'wz-ic ' + c.ok} icon={c.ok === 'yes' ? checkmarkCircle : c.ok === 'no' ? closeCircle : alertCircle} />
                    <span className="pick-main">
                      <span className="wz-hw-n">{c.name}</span>
                      <span className="wz-hw-d">{c.note}</span>
                    </span>
                  </div>
                ))}
              </>
            )}

            {step === 1 && (
              <>
                <p className="wz-lede">Режимы различаются объёмом полномочий алгоритма, а не набором настроек.</p>
                {LOOP_MODES.map((m) => (
                  <button
                    key={m.id}
                    className={'wz-card wz-mode' + (picked === m.id ? ' on' : '') + (m.available ? '' : ' locked')}
                    disabled={!m.available}
                    onClick={() => { setPicked(m.id); saveLoopProfile({ mode: m.id }); }}
                  >
                    <span className="wz-mrow">
                      <span className="wz-code">{m.code}</span>
                      {m.lock && <span className="wz-lock">{m.lock}</span>}
                      {m.warn && <span className="wz-warn">{m.warn}</span>}
                    </span>
                    <span className="wz-mname">{m.name}</span>
                    <span className="wz-mdesc">{m.desc}</span>
                    <span className="wz-mneed">{m.need}</span>
                  </button>
                ))}
              </>
            )}

            {step === 2 && (
              <>
                <p className="wz-lede">
                  Значения по умолчанию — рекомендованные. Состав лимитов определяется режимом «{mode.name}».
                </p>
                {limits.length === 0 && (
                  <div className="wz-card"><span className="wz-hw-d">В этом режиме команды в помпу не отправляются, ограничивать нечего.</span></div>
                )}
                {limits.map((l) => {
                  const v = profile.values[l.id];
                  const warn = outOfRec(l, v);
                  const open = editing === l.id;
                  // на пределах кнопки гаснут и объясняют, что это предел приложения
                  const atMin = v <= l.min + 1e-9;
                  const atMax = v >= l.max - 1e-9;
                  const changed = Math.abs(v - l.rec) > 1e-9;
                  const num = (x: number) => x.toFixed(l.dp).replace('.', ',');
                  return (
                    <div key={l.id} className={'wz-card wz-lim' + (open ? ' open' : '') + (warn ? ' warn' : '')}>
                      <div className="wz-limtop">
                        <span className="wz-limname">{l.name}</span>
                        {!open && (
                          <button className="wz-edit-btn" onClick={() => setEditing(l.id)}>
                            <IonIcon icon={createOutline} /> Изменить
                          </button>
                        )}
                      </div>

                      {open ? (
                        <>
                          <div className="wz-why">{l.why}</div>
                          <div className="wz-stepper">
                            <button className={atMin ? 'off' : ''} disabled={atMin} onClick={() => bump(l, -l.step)} aria-label="Меньше">−</button>
                            <span className="wz-big">
                              <b className={warn ? 'warn' : ''}>{fmtLimit(l, v)}</b>
                              <i>{l.unit} · шаг {num(l.step)}</i>
                            </span>
                            <button className={atMax ? 'off' : ''} disabled={atMax} onClick={() => bump(l, l.step)} aria-label="Больше">+</button>
                          </div>
                          <div className="wz-impact"><b>Станет так:</b> {l.impact(v)}</div>

                          {atMax && <div className="wz-edge hard"><b>Выше недоступно.</b> {num(l.max)} {l.unit} — предел приложения.</div>}
                          {atMin && <div className="wz-edge hard"><b>Ниже недоступно.</b> {num(l.min)} {l.unit} — предел приложения.</div>}
                          {warn && !atMax && !atMin && (
                            <div className="wz-edge"><b>Вне рекомендованного диапазона.</b> Рекомендовано {fmtLimit(l, l.rec)} {l.unit}.</div>
                          )}

                          <div className="wz-why2">{l.why2}</div>

                          {changed ? (
                            <div className="wz-erow">
                              {/* вернуть рекомендованное — главный выход, оставить своё — осознанный */}
                              <button className="wz-done go" onClick={() => saveLoopProfile({ values: { ...profile.values, [l.id]: l.rec } })}>
                                ↺ Вернуть рекомендованное {fmtLimit(l, l.rec)} {l.unit}
                              </button>
                              <button className="wz-done ghost" onClick={() => setEditing(null)}>
                                Всё же оставить {fmtLimit(l, v)} {l.unit}
                              </button>
                            </div>
                          ) : (
                            <button className="wz-done" onClick={() => setEditing(null)}>Готово</button>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="wz-big collapsed">
                            <b className={warn ? 'warn' : ''}>{fmtLimit(l, v)}</b><i>{l.unit}</i>
                          </span>
                          <div className="wz-why">{l.why}</div>
                          <div className="wz-why2">{l.why2}</div>
                          <div className="wz-impact"><b>На практике:</b> {l.impact(v)}</div>
                          {warn && (
                            <div className="wz-edge">
                              <b>Вне рекомендованного диапазона.</b> Рекомендовано {fmtLimit(l, l.rec)} {l.unit}.
                              На последнем шаге потребуется подтверждение согласования с врачом.
                            </div>
                          )}
                          <div className="wz-range">
                            рекомендовано {fmtLimit(l, l.rec)} · допустимо {num(l.min)}…{num(l.max)} {l.unit}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
                <div className="wz-fixed">
                  <div className="wz-fixed-n">Не настраивается</div>
                  <div className="wz-fixed-v">запрет ввода ниже 4,5 ммоль/л</div>
                  <div className="sheet-note">
                    Также: подтверждение доз из истории помпы, пессимистичный расчёт активного инсулина,
                    отмена ВБС при потере связи.
                  </div>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <p className="wz-lede">Правила понижения полномочий. Не настраиваются.</p>
                {([
                  ['нет данных НМГ', `через ${profile.values.stale} мин полномочия понижаются на ступень, далее ещё на одну`],
                  ['доза не подтверждена', 'микроболюсы снимаются немедленно'],
                  ['расхождение часов помпы', 'понижение до L1: временную привязку доз восстановить нельзя, активный инсулин не считается'],
                  ['потеря связи', 'ВБС отменяется, помпа возвращается к базальному профилю'],
                  ['перезапуск приложения', 'старт с L2 с последующим подъёмом'],
                  ['восстановление', 'после трёх циклов без замечаний, не ранее 15 минут'],
                ] as [string, string][]).map(([a, b]) => (
                  <div key={a} className="wz-rule">
                    <span className="wz-rule-a">{a}</span>
                    <span className="wz-rule-b">{b}</span>
                  </div>
                ))}
                <div className="wz-fixed ok">
                  <div className="wz-fixed-n">Нижняя ступень — не нулевая подача</div>
                  <div className="wz-fixed-v ok">возврат к базальному профилю помпы</div>
                  <div className="sheet-note">
                    Полное прекращение подачи опасно так же, как избыток. Крайняя мера — вернуть управление профилю помпы.
                  </div>
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <p className="wz-lede">Изменения профиля записываются с датой и временем.</p>
                <div className="wz-card wz-sum">
                  <div className="wz-srow"><span>Режим</span><b>{mode.code} · {mode.name}</b></div>
                  {limits.map((l) => (
                    <div key={l.id} className="wz-srow">
                      <span>{l.name}</span>
                      <b className={outOfRec(l, profile.values[l.id]) ? 'warn' : ''}>
                        {fmtLimit(l, profile.values[l.id])} {l.unit}
                      </b>
                    </div>
                  ))}
                </div>
                {needDoctor && (
                  <button className={'wz-gate' + (profile.doctorOk ? ' on' : '')} onClick={() => saveLoopProfile({ doctorOk: !profile.doctorOk })}>
                    <IonIcon icon={profile.doctorOk ? checkmarkCircle : alertCircle} />
                    <span>Часть значений вне рекомендованного диапазона. Подтверждаю согласование с лечащим врачом.</span>
                  </button>
                )}
              </>
            )}
          </>
        )}
      </IonContent>

      <IonFooter className="page-foot">
        <div className="wz-nav">
          {done ? (
            <button className="page-next" onClick={close}>Понятно</button>
          ) : (
            <>
              <button className="page-back" onClick={step === 0 ? close : () => { setStep((step - 1) as Step); setEditing(null); }}>
                <IonIcon icon={chevronBack} />
                {step === 0 ? 'Закрыть' : 'Назад'}
              </button>
              {step < 4 ? (
                <button className="page-next" disabled={!canNext} onClick={() => { setStep((step + 1) as Step); setEditing(null); }}>
                  Далее
                </button>
              ) : (
                <HoldButton
                  label={needDoctor && !profile.doctorOk ? 'Требуется подтверждение' : 'Удерживайте, чтобы применить'}
                  disabled={needDoctor && !profile.doctorOk}
                  onComplete={apply}
                />
              )}
            </>
          )}
        </div>
      </IonFooter>
    </IonModal>
  );
}
