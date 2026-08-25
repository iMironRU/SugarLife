import Иконка from '@/ui/Иконка';
import { checkmarkCircle, closeCircle, alertCircle, lockClosedOutline, createOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useStore } from '@/sources/store';
import { isModelKnown } from '@/settings/deviceConfig';
import { pumpById, sensorById } from '@/domain/catalog';
import { useМодели } from '@/показ/модели';
import HoldButton from '@/ui/HoldButton';
import Section from '@/ui/Section';
import {
  LOOP_MODES, limitsFor, outOfRec, anyOutOfRec, fmtLimit, уровеньРиска, сторонаРиска,
  useLoopProfile, saveLoopProfile, type LoopModeId, type LoopLimit,
} from '@/settings/loopProfile';

/* Мастер настройки профиля петли — четыре шага (из пятишагового прототипа inbox/loop.zip):
   Оборудование → Режим → Лимиты → Проверка.

   ТОЛЬКО интерфейс: команд в помпу отсюда не уходит, приложение на L0
   (см. docs/decisions/0004-loop-pro-redakciya.md).

   Отличие от прототипа одно и намеренное: шаг «Оборудование» опрашивает РЕАЛЬНЫЕ
   устройства, а не показывает захардкоженный список. Фикцию на экране, где
   настраивают подачу, показывать нельзя. */
/* Шагов четыре, а не пять (#279). «Деградация» уехала в раздел «Петля»: правила
   понижения полномочий нужны не при настройке, а когда полномочия упали и человек
   спрашивает почему. Мастер остался тем, чем должен быть, — разовой настройкой. */
type Step = 0 | 1 | 2 | 3;
const STEPS = ['Оборудование', 'Режим петли', 'Лимиты', 'Проверка'];
/* Описание каждого шага — там же, где у обычных разделов, и одной строкой на шаг.
   Раньше эти слова лежали внутри веток шага как <p class="wz-lede">, поэтому у одних
   шагов они были, у других нет. */
const ОПИСАНИЕ_ШАГА = [
  'Опрос устройств. Перечень доступных режимов определяется их возможностями.',
  'Режимы различаются объёмом полномочий алгоритма, а не набором настроек.',
  'Пределы, за которые алгоритм не выйдет ни при каких расчётах.',
  'Проверьте, что записывается, и подтвердите. Изменения профиля пишутся с датой и временем.',
];

type Check = { ok: 'yes' | 'no' | 'maybe'; name: string; note: string };

/** Уровень риска классом: «норма» — без класса, иначе цвет числа задаёт CSS (loop.css). */
const классРиска = (у: ReturnType<typeof уровеньРиска>) => (у === 'норма' ? '' : у);

export default function LoopSetupSection({ onClose }: { onClose: () => void }) {
  const profile = useLoopProfile();
  const [step, setStep] = useState<Step>(0);
  const [editing, setEditing] = useState<string | null>(null);
  // режим требуется выбрать ЯВНО: «Далее» заперта, пока не ткнули (как в прототипе)
  const [picked, setPicked] = useState<LoopModeId | null>(profile.savedAt ? profile.mode : null);
  const [done, setDone] = useState(false);
  const { data } = useStore();

  const close = () => { onClose(); setStep(0); setEditing(null); setDone(false); };

  const dev = data?.device ?? null;
  /* Модель спрашиваем у движка, локальный выбор — запасной (#224). Иначе после
     переустановки проверка писала бы «модель не указана» при работающей помпе. */
  const модели = useМодели();
  const pump = isModelKnown(модели.pumpId) ? pumpById(модели.pumpId) : null;
  const sensor = isModelKnown(модели.sensorId) ? sensorById(модели.sensorId) : null;
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

  /* Мастер живёт в обычной шапке раздела (SugarLife#259).

     Раньше у него была своя: шаги вместо заголовка сверху и закреплённый низ с «Назад»
     и «Далее». Низ съедал полосу экрана на каждом шаге ради двух кнопок — при том что
     содержимого на шаге часто было в половину экрана, а на «Проверке» под сводкой
     оставалось пусто.

     Теперь навигация симметрична и вся в шапке: слева шаг назад, справа шаг вперёд.
     Стрелка слева на первом шаге означает выход — то же, что и во всех разделах, и
     ровно то, что человек от неё ждёт; отдельной кнопки «Закрыть» больше нет нигде.

     Шаги переехали под заголовок, где у разделов живёт подзаголовок: они и есть
     уточнение «где я сейчас», а полоса прогресса — то же самое картинкой.

     Применение осталось в теле последнего шага, а не уехало в шапку: оно весомее
     навигации, требует удержания и должно стоять там, где человек читает, что именно
     применяет. */
  return (
    <Section
      onBack={step > 0 ? () => { setStep((step - 1) as Step); setEditing(null); } : close}
      className="wz"
      title={done ? 'Готово' : STEPS[step]}
      /* Запертая кнопка обязана объяснять себя: без подписи «Далее» просто не
         нажимается, и это выглядит поломкой, а не условием. */
      subtitle={done ? 'профиль записан' : `Шаг ${step + 1} из 4`}
      /* Описание шага стоит там же, где описание любого раздела, и одним видом с ним.
         Раньше шаг печатал своё имя ВТОРОЙ раз крупным заголовком, а под ним свой lede:
         человек читал «Оборудование», потом снова «Оборудование» размером больше — и
         только третьей строкой узнавал, что происходит (#311). */
      описание={done ? 'Профиль записан на этом устройстве. Подача не включена: приложение остаётся на L0.' : ОПИСАНИЕ_ШАГА[step]}
      подШапкой={!done ? (
        <div className="wz-prog">
          {STEPS.map((s, i) => (
            <span key={s} className={'wz-dot' + (i < step ? ' passed' : i === step ? ' on' : '')} />
          ))}
        </div>
      ) : undefined}
      действие={!done && step < 3 ? (
        <button className="head-next" disabled={!canNext}
          onClick={() => { setStep((step + 1) as Step); setEditing(null); }}>
          Далее
        </button>
      ) : done ? (
        <button className="head-next" onClick={close}>Понятно</button>
      ) : undefined}
    >


        {done ? (
          <>
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

            {step === 0 && (
              <>
                {checks.map((c) => (
                  <div key={c.name} className="wz-card wz-hw">
                    <Иконка className={'wz-ic ' + c.ok} icon={c.ok === 'yes' ? checkmarkCircle : c.ok === 'no' ? closeCircle : alertCircle} />
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
                <p className="sheet-note">
                  Значения по умолчанию — рекомендованные. Состав лимитов определяется режимом «{mode.name}».
                </p>
                {limits.length === 0 && (
                  <div className="wz-card"><span className="wz-hw-d">В этом режиме команды в помпу не отправляются, ограничивать нечего.</span></div>
                )}
                {limits.map((l) => {
                  const v = profile.values[l.id];
                  const warn = outOfRec(l, v);
                  /* Цвет числа — по тому, насколько ушли в рискованную сторону, и рискованная
                     сторона у каждого предела своя. Кнопки при этом НЕ заливаем: нажатие само по
                     себе ничем не грозит, опасно то, где число окажется. Красная заливка 62×62 в
                     ночной шторке — фонарь в глаза; хватает тонкого контура и цвета знака. */
                  const риск = уровеньРиска(l, v);
                  const хуже = сторонаРиска(l);
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
                            <Иконка icon={createOutline} /> Изменить
                          </button>
                        )}
                      </div>

                      {open ? (
                        <>
                          <div className="wz-why">{l.why}</div>
                          <div className="wz-stepper">
                            <button className={(atMin ? 'off' : '') + (хуже === -1 ? ' хуже' : '')}
                              disabled={atMin} onClick={() => bump(l, -l.step)} aria-label="Меньше">−</button>
                            <span className="wz-big">
                              <b className={классРиска(риск)}>{fmtLimit(l, v)}</b>
                              <i>{l.unit} · шаг {num(l.step)}</i>
                            </span>
                            <button className={(atMax ? 'off' : '') + (хуже === 1 ? ' хуже' : '')}
                              disabled={atMax} onClick={() => bump(l, l.step)} aria-label="Больше">+</button>
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
                            <b className={классРиска(риск)}>{fmtLimit(l, v)}</b><i>{l.unit}</i>
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
                <p className="sheet-note">Изменения профиля записываются с датой и временем.</p>
                <div className="wz-card wz-sum">
                  <div className="wz-srow"><span>Режим</span><b>{mode.code} · {mode.name}</b></div>
                  {limits.map((l) => (
                    <div key={l.id} className="wz-srow">
                      <span>{l.name}</span>
                      <b className={классРиска(уровеньРиска(l, profile.values[l.id]))}>
                        {fmtLimit(l, profile.values[l.id])} {l.unit}
                      </b>
                    </div>
                  ))}
                </div>
                {needDoctor && (
                  <button className={'wz-gate' + (profile.doctorOk ? ' on' : '')} onClick={() => saveLoopProfile({ doctorOk: !profile.doctorOk })}>
                    <Иконка icon={profile.doctorOk ? checkmarkCircle : alertCircle} />
                    <span>Часть значений вне рекомендованного диапазона. Подтверждаю согласование с лечащим врачом.</span>
                  </button>
                )}
                {/* «Ничего не уйдёт в помпу» сказано один раз и здесь.

                    Раньше эта плашка висела на каждом из пяти шагов и первой занимала
                    экран. Повторённое пять раз перестаёт читаться к третьему, а место
                    отнимает на всех. Но и выбросить совсем нельзя: единственное место,
                    где человек может решить, что сейчас включит подачу, — кнопка
                    удержания, и предупреждение должно стоять ровно над ней. */}
                <div className="wz-l0">
                  <Иконка icon={lockClosedOutline} />
                  <span>Приложение на L0: команды в помпу не отправляются. Это запись профиля, не включение подачи.</span>
                </div>
                <div className="wz-apply">
                  <HoldButton
                    label={needDoctor && !profile.doctorOk ? 'Требуется подтверждение' : 'Удерживайте, чтобы применить'}
                    disabled={needDoctor && !profile.doctorOk}
                    onComplete={apply}
                  />
                </div>
              </>
            )}
          </>
        )}
    </Section>
  );
}
