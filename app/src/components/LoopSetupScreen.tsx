import { IonModal, IonContent, IonFooter, IonIcon } from '@ionic/react';
import { chevronBack, checkmarkCircle, closeCircle, alertCircle, lockClosedOutline, refreshOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useStore } from '../data/store';
import { useDeviceConfig, isModelKnown } from '../data/deviceConfig';
import { pumpById, sensorById } from '../data/catalog';
import {
  LOOP_MODES, limitsFor, outOfRec, anyOutOfRec, fmtLimit,
  useLoopProfile, saveLoopProfile, type LoopModeId, type LoopLimit,
} from '../data/loopProfile';

/* Мастер настройки профиля петли — пять шагов из прототипа (inbox/loop.zip):
   Оборудование → Режим → Лимиты → Деградация → Проверка.

   ТОЛЬКО интерфейс: ни одна команда в помпу отсюда не уходит, приложение работает
   на L0 (см. docs/decisions/0004-loop-pro-redakciya.md). Выбор режима выше L0 здесь —
   это запись в локальный профиль, а не включение подачи. */
type Step = 0 | 1 | 2 | 3 | 4;
const STEPS = ['Оборудование', 'Режим петли', 'Лимиты', 'Деградация', 'Проверка'];

type Check = { ok: 'yes' | 'no' | 'maybe'; name: string; note: string };

export default function LoopSetupScreen({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [step, setStep] = useState<Step>(0);
  const [editing, setEditing] = useState<string | null>(null);
  const profile = useLoopProfile();
  const { data } = useStore();
  const devCfg = useDeviceConfig();

  const close = () => { onClose(); setStep(0); setEditing(null); };

  /* Опрос оборудования — по тому, что РЕАЛЬНО известно, а не по списку из прототипа.
     Чего не знаем — помечаем «неизвестно», а не выдаём за проверенное. */
  const dev = data?.device ?? null;
  const pump = isModelKnown(devCfg.pumpId) ? pumpById(devCfg.pumpId) : null;
  const sensor = isModelKnown(devCfg.sensorId) ? sensorById(devCfg.sensorId) : null;
  const checks: Check[] = [
    pump
      ? { ok: 'yes', name: `Помпа ${pump.model}`, note: 'модель записана в «Устройствах»' }
      : { ok: 'maybe', name: 'Помпа — модель не указана', note: 'без модели неизвестно, какие полномочия она поддерживает' },
    sensor
      ? { ok: 'yes', name: `НМГ ${sensor.name}`, note: 'модель записана' }
      : { ok: 'maybe', name: 'НМГ — модель не указана', note: 'данные идут, но модель не выбрана' },
    data?.latest
      ? { ok: 'yes', name: 'Данные гликемии поступают', note: 'последняя точка получена' }
      : { ok: 'no', name: 'Нет данных гликемии', note: 'без НМГ недоступен ни один режим' },
    dev?.baseBasal != null
      ? { ok: 'yes', name: 'Базальный профиль читается', note: `текущая скорость ${dev.baseBasal} ЕД/ч` }
      : { ok: 'maybe', name: 'Базальный профиль неизвестен', note: 'не пришёл из Nightscout' },
    { ok: 'maybe', name: 'Отправка команд в помпу', note: 'канала записи нет — приложение только читает' },
    { ok: 'no', name: 'Второй гормон отсутствует', note: 'двухгормональные режимы недоступны' },
  ];

  const limits = limitsFor(profile.mode);
  const needDoctor = anyOutOfRec(profile);
  const mode = LOOP_MODES.find((m) => m.id === profile.mode)!;

  const setValue = (l: LoopLimit, delta: number) => {
    const v = Math.min(l.max, Math.max(l.min, +(profile.values[l.id] + delta).toFixed(3)));
    saveLoopProfile({ values: { ...profile.values, [l.id]: v } });
  };

  const apply = () => {
    saveLoopProfile({ savedAt: Date.now() });
    close();
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={close} className="full-page">
      <IonContent className="sheet">
        <div className="sheet-head">
          <button className="sheet-close" onClick={close} aria-label="Назад"><IonIcon icon={chevronBack} /></button>
          <div style={{ flex: 1 }}>
            <div className="sheet-title">Профиль петли</div>
            <div className="sheet-subtitle">Шаг {step + 1} из 5 · {STEPS[step]}</div>
          </div>
        </div>
        <div className="wz-prog">
          {STEPS.map((s, i) => <span key={s} className={'wz-dot' + (i <= step ? ' on' : '')} />)}
        </div>

        {/* приложение никуда ничего не отправляет — это должно быть видно на каждом шаге */}
        <div className="wz-l0">
          <IonIcon icon={lockClosedOutline} />
          <span>Сейчас L0: команды в помпу не отправляются. Это настройка профиля, не включение подачи.</span>
        </div>

        {step === 0 && (
          <>
            <p className="sheet-desc">Опрос устройств. Перечень доступных режимов определяется их возможностями.</p>
            {checks.map((c) => (
              <div key={c.name} className="wz-hw">
                <IonIcon className={'wz-ic ' + c.ok} icon={c.ok === 'yes' ? checkmarkCircle : c.ok === 'no' ? closeCircle : alertCircle} />
                <span className="pick-main">
                  <span className="list-title">{c.name}</span>
                  <span className="pick-sub">{c.note}</span>
                </span>
              </div>
            ))}
          </>
        )}

        {step === 1 && (
          <>
            <p className="sheet-desc">Режимы различаются объёмом полномочий алгоритма, а не набором настроек.</p>
            {LOOP_MODES.map((m) => (
              <button
                key={m.id}
                className={'wz-mode' + (profile.mode === m.id ? ' on' : '') + (m.available ? '' : ' locked')}
                disabled={!m.available}
                onClick={() => saveLoopProfile({ mode: m.id as LoopModeId })}
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
            <p className="sheet-desc">
              Значения по умолчанию — рекомендованные. Состав лимитов определяется режимом «{mode.name}».
            </p>
            {limits.length === 0 && (
              <div className="sheet-note">В этом режиме команды в помпу не отправляются — ограничивать нечего.</div>
            )}
            {limits.map((l) => {
              const v = profile.values[l.id];
              const warn = outOfRec(l, v);
              const open = editing === l.id;
              return (
                <div key={l.id} className={'wz-lim' + (warn ? ' warn' : '')}>
                  <button className="wz-limhead" onClick={() => setEditing(open ? null : l.id)}>
                    <span className="pick-main">
                      <span className="list-title">{l.name}</span>
                      <span className="pick-sub">{l.impact(v)}</span>
                    </span>
                    <span className={'wz-val' + (warn ? ' warn' : '')}>{fmtLimit(l, v)} {l.unit}</span>
                  </button>
                  {open && (
                    <div className="wz-edit">
                      <div className="wz-stepper">
                        <button onClick={() => setValue(l, -l.step)} aria-label="Меньше">−</button>
                        <span>{fmtLimit(l, v)} {l.unit}</span>
                        <button onClick={() => setValue(l, l.step)} aria-label="Больше">+</button>
                        <button className="wz-reset" onClick={() => saveLoopProfile({ values: { ...profile.values, [l.id]: l.rec } })}>
                          <IonIcon icon={refreshOutline} /> рекомендованное
                        </button>
                      </div>
                      <div className="sheet-note">{l.why}</div>
                      <div className="sheet-note">{l.why2}</div>
                    </div>
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
            <p className="sheet-desc">Правила понижения полномочий. Не настраиваются.</p>
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
            <p className="sheet-desc">Изменения профиля записываются с датой и временем.</p>
            <div className="list">
              <div className="list-row" style={{ cursor: 'default' }}>
                <span className="list-title">Режим</span>
                <span className="list-value">{mode.code} · {mode.name}</span>
              </div>
              {limits.map((l) => (
                <div key={l.id} className="list-row" style={{ cursor: 'default' }}>
                  <span className="list-title">{l.name}</span>
                  <span className={'list-value' + (outOfRec(l, profile.values[l.id]) ? ' warn' : '')}>
                    {fmtLimit(l, profile.values[l.id])} {l.unit}
                  </span>
                </div>
              ))}
            </div>
            {needDoctor && (
              <button className={'wz-gate' + (profile.doctorOk ? ' on' : '')} onClick={() => saveLoopProfile({ doctorOk: !profile.doctorOk })}>
                <IonIcon icon={profile.doctorOk ? checkmarkCircle : alertCircle} />
                <span>Часть значений вне рекомендованного диапазона. Подтверждаю согласование с лечащим врачом.</span>
              </button>
            )}
            <div className="sheet-note">
              Применение сохраняет профиль на этом устройстве. Подача не включается: приложение остаётся на L0.
            </div>
          </>
        )}
      </IonContent>

      <IonFooter className="page-foot">
        <div className="wz-nav">
          <button className="page-back" onClick={step === 0 ? close : () => setStep((step - 1) as Step)}>
            <IonIcon icon={chevronBack} />
            {step === 0 ? 'Закрыть' : 'Назад'}
          </button>
          {step < 4 ? (
            <button className="page-next" onClick={() => setStep((step + 1) as Step)}>Далее</button>
          ) : (
            <button className="page-next" disabled={needDoctor && !profile.doctorOk} onClick={apply}>
              Применить профиль
            </button>
          )}
        </div>
      </IonFooter>
    </IonModal>
  );
}
