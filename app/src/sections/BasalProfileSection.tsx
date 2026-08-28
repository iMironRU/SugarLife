import Иконка from '@/ui/Иконка';
import { arrowUndoOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useStore } from '@/sources/store';
import { прочитатьJson, записатьJson } from '@/settings/storage';
import { useSnapshot } from '@/sources/bridge';
import {
  type Seg, PARTS, STEP, fmtH, toSegs, rateAt, daily,
  partDose, partAvg, segsIn, scalePart, sameProfile, tzShiftMinutes, tzShiftText,
} from '@/domain/basal';
import BasalSteps, { type Inner } from './BasalSteps';
import Section from '@/ui/Section';

/* Редактор базального профиля (docs/prototypes/basal-profile.html).

   Что взято из прототипа как есть: два режима «Как есть» / «Правка», ступенчатый
   график за сутки, разбивка по частям суток, правка интервала шагом 0.05, деление
   и слияние интервалов, инструменты «весь профиль %», «выровнять», «как в помпе»,
   отмена последнего действия и перенос в помпу списком с удержанием.

   Чего в прототипе есть, а здесь НЕТ намеренно: линии «фактическая потребность»,
   находки «с 03:00 до 06:00 профиля не хватает» и предложения по интервалам. В
   прототипе это захардкоженные числа-заглушки. Считать потребность по работе петли
   мы пока не умеем, а нарисовать правдоподобную оранжевую линию, к которой человек
   станет подгонять свой базал, — это выдумать медицинские данные. Появится расчёт —
   появятся и они.

   Приложение не пишет в помпу (L0). Поэтому «перенести» — это чеклист: значения
   вводят на самой помпе, здесь отмечают, что ввели, и правка попадает в историю. */

const KEY = 'sl.basal.v1';

type LogEntry = { at: number; segs: Seg[] };
const readLog = (): LogEntry[] => {
  return прочитатьJson<LogEntry[]>(KEY, []);
};
const writeLog = (l: LogEntry[]) => записатьJson(KEY, l.slice(-40));

const W = 300, H = 110;
function path(segs: Seg[], max: number): string {
  let d = '';
  for (const s of segs) {
    const x1 = (s.a / 24) * W, x2 = (s.b / 24) * W, y = H - (s.v / max) * H;
    d += (d ? ` L${x1.toFixed(1)},${y.toFixed(1)}` : `M${x1.toFixed(1)},${y.toFixed(1)}`) + ` L${x2.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}


export default function BasalProfileSection({ onClose }: { onClose: () => void }) {
  const { data } = useStore();
  const snap = useSnapshot();

  /* Профиль с помпы важнее облачного. На помпе лежит то, что реально работает сейчас;
     в Nightscout — то, что туда однажды выгрузили. Это разные степени доверия, и когда
     доступны оба, показывать надо тот, по которому идёт подача (SugarLifeCore#7). */
  const сДвижка = snap?.pumpBasal ?? null;
  /* Приводим к нашей форме через тот же toSegs, что и облачный профиль: он достраивает
     границы интервалов и закрывает сутки. Дублировать эту логику под второй источник
     значило бы завести две версии одного правила. */
  /* ОБЛАЧНЫЙ ПРОФИЛЬ — ТОЖЕ ОТ ДВИЖКА (мост 1.43, #528). Он читает Nightscout сам; наша загрузка
     оставалась последним куском второго источника. Порядок доверия не меняется: помпа важнее
     облака — на ней лежит то, что реально работает сейчас. */
  const профильДвижка = snap?.therapyProfile ?? null;
  const облачныеШаги = профильДвижка?.basal?.length
    ? профильДвижка.basal.map((x) => ({ h: x.fromMin / 60, v: x.value }))
    : (data?.profile?.basalSchedule ?? []);
  const pump = toSegs(сДвижка
    ? сДвижка.segments.map((x) => ({ h: x.startMinutes / 60, v: x.rateUPerHour }))
    : облачныеШаги);
  const источник: 'Pump' | 'Nightscout' = сДвижка?.origin ?? 'Nightscout';
  /* Зона профиля. У помпы её нет вовсе — и это не «данных нет», а смысл: у 722 нет
     понятия зоны, времена размечены её собственными настенными часами. Считать их
     локальными для телефона нельзя: у путешественника телефон в одной зоне, помпа в
     другой, и он правил бы не тот интервал. */
  const зонаПрофиля = сДвижка ? сДвижка.timezone
    : (профильДвижка?.timezone ?? data?.profile?.timezone ?? null);
  const зонаНеизвестна = источник === 'Pump' && зонаПрофиля == null;

  const [edit, setEdit] = useState(false);
  const [work, setWork] = useState<Seg[]>(pump);
  const [undoStack, setUndo] = useState<Seg[][]>([]);
  const [openPart, setOpenPart] = useState(1);
  const [inner, setInner] = useState<Inner>(null);
  const [scalePct, setScalePct] = useState(0);
  const [done, setDone] = useState<number[]>([]);
  const [saved, setSaved] = useState(false);

  const changedAll = !sameProfile(work, pump);
  const changedAt = (i: number) => Math.abs(work[i].v - rateAt(pump, work[i].a)) > 1e-6;

  /* Расхождение с часами телефона. Время интервалов оставляем помповым — значения
     вводят на самой помпе, глядя на её часы, — но молчать о разнице нельзя: иначе
     в поездке человек правит «ночь», которая у помпы вовсе не ночь. */
  const сдвиг = tzShiftMinutes(зонаПрофиля ?? undefined);

  const apply = (next: Seg[]) => { setUndo((u) => [...u.slice(-19), work]); setWork(next); };
  const undo = () => { if (!undoStack.length) return; setWork(undoStack[undoStack.length - 1]); setUndo((u) => u.slice(0, -1)); };

  const max = Math.max(1.05, ...pump.map((s) => s.v), ...work.map((s) => s.v)) * 1.05;
  /* Линии шкалы — по «круглому» шагу, чтобы подписи читались (0.5, а не 0.42).
     Берём первый шаг, при котором линий выходит не больше четырёх: гуще — рябит. */
  const gridStep = [0.1, 0.2, 0.25, 0.5, 1, 2].find((s) => max / s <= 4) ?? 5;
  const grid: number[] = [];
  for (let g = gridStep; g < max; g += gridStep) grid.push(+g.toFixed(2));

  /* Правка профиля живёт в состоянии до переноса в помпу. Здесь цена потери выше,
     чем где-либо ещё в приложении: человек мог перебрать все интервалы за сутки, и
     один случайный тап по панели стирал бы всю работу. Пока есть правки — по панели
     не закрываем, крестик переспрашивает. */
  const askClose = () => {
    // после записи в историю переспрашивать не за что: работа не потеряна.
    // Профиль в Nightscout при этом остаётся прежним — значения вводят на самой помпе.
    if (changedAll && !saved && !window.confirm('Правки профиля не перенесены в помпу и не записаны в историю. Закрыть и потерять их?')) return;
    onClose();
  };

  const saveToHistory = () => {
    writeLog([...readLog(), { at: Date.now(), segs: work }]);
    setSaved(true);
  };

  if (!pump.length) {
    return (
      <Section title="Базальный профиль" описание="Сколько инсулина помпа подаёт в фоне, по часам суток. По нему же считается, хватит ли резервуара до утра." onBack={onClose}>
          <div className="loop-empty">
            <div className="loop-empty-t">Профиль не получен</div>
            <div className="loop-empty-s">
              Расписание базала приходит из Nightscout вместе с профилем. Пока его нет,
              редактировать нечего — показывать пустую сетку и делать вид, что это ваш
              профиль, было бы обманом.
            </div>
          </div>
      </Section>
    );
  }

  return (
    <>
      <Section
        title="Базальный профиль"
        subtitle={источник === 'Pump' ? 'прочитан с помпы' : (data?.profile?.name ?? 'из Nightscout')}
        onBack={askClose}
        footer={edit && changedAll ? (
          <div className="page-foot">
            <div className="bas-act">
              <button className="page-btn bas-undo" onClick={undo} disabled={!undoStack.length} aria-label="Отменить">
                <Иконка icon={arrowUndoOutline} />
              </button>
              <button className="page-btn bas-go" onClick={() => { setDone([]); setSaved(false); setInner({ kind: 'transfer' }); }}>
                Перенести в помпу
              </button>
            </div>
          </div>
        ) : null}
      >

          {/* Зона неизвестна — говорим об этом прямо, а не молчим и не подставляем
              местное время. У помпы нет понятия часового пояса: её времена это её
              настенные часы. Пока телефон и помпа в одной зоне, разницы нет; в поездке
              человек правил бы не тот интервал, и узнал бы об этом по сахару. */}
          {зонаНеизвестна && (
            <div className="lim-kid warn">
              <b>Часы интервалов — помповые.</b> У помпы нет часового пояса, и совпадают
              ли её часы с телефоном, приложение не знает. Если вы меняли пояс — сверьте
              время на самой помпе, прежде чем править интервалы.
            </div>
          )}

          {!зонаНеизвестна && сдвиг !== 0 && (
            <div className="lim-kid warn">
              <b>Время помпы отличается от времени телефона {tzShiftText(сдвиг)}.</b> Часы
              интервалов ниже — помповые ({зонаПрофиля}), потому что значения
              вы будете вводить на самой помпе. С местным временем они не совпадают.
            </div>
          )}

          <div className="dev-seg">
            <button className={'dev-seg-btn' + (!edit ? ' on' : '')} onClick={() => setEdit(false)}>Как есть</button>
            <button className={'dev-seg-btn' + (edit ? ' on' : '')} onClick={() => setEdit(true)}>Правка</button>
          </div>

          {/* График: ступени за сутки.

              Полосы частей суток были и в прототипе, но у меня они не читались: заливка
              совпадала с цветом карточки. Поле графика сделано темнее карточки, полосы —
              двумя разными тонами, как в прототипе.

              Горизонтальных линий с подписями в прототипе не было, и это его слабое
              место: по одной ломаной без шкалы не понять, 1.2 ЕД/ч — это много или мало,
              и насколько правка сдвинула уровень. На экране, где меняют дозу инсулина,
              шкала нужнее декора. */}
          <div className="bas-card">
            <svg className="bas-chart" viewBox="0 0 300 132" preserveAspectRatio="none" aria-hidden="true">
              <rect x="0" y="0" width={W} height={H} fill="var(--color-bg)" />
              {PARTS.map((p, k) => (k % 2 ? (
                <rect key={p.nm} x={(p.a / 24) * W} y="0" width={((p.b - p.a) / 24) * W} height={H}
                  fill="color-mix(in srgb, var(--color-neutral-800) 45%, var(--color-bg))" />
              ) : null))}
              {grid.map((g) => (
                <g key={g}>
                  <line x1="0" y1={H - (g / max) * H} x2={W} y2={H - (g / max) * H}
                    stroke="var(--color-neutral-800)" strokeWidth="0.7" />
                  <text x="2" y={H - (g / max) * H - 2.5} fill="var(--color-neutral-500)" fontSize="7.5">{g.toFixed(1)}</text>
                </g>
              ))}
              <line x1="0" y1={H} x2={W} y2={H} stroke="var(--color-neutral-700, var(--color-neutral-800))" strokeWidth="1" />
              <path d={path(pump, max)} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" opacity={edit ? 0.45 : 1} />
              {edit && changedAll && <path d={path(work, max)} fill="none" stroke="var(--c-glu)" strokeWidth="2.5" />}
              {PARTS.map((p) => (
                <text key={p.nm} x={(p.a / 24) * W + 3} y="126" fill="var(--color-neutral-500)" fontSize="8.5">{p.nm.toLowerCase()}</text>
              ))}
            </svg>
            <div className="bas-legend">
              <span><i style={{ background: 'var(--color-accent)' }} />в помпе</span>
              {edit && changedAll && <span><i style={{ background: 'var(--c-glu)' }} />правка</span>}
            </div>
            <div className="bas-tot">
              <span>суточный базал</span>
              <b>
                {daily(pump).toFixed(2)}
                {edit && changedAll && <span style={{ color: 'var(--c-glu)' }}> → {daily(work).toFixed(2)}</span>}
                <span className="bas-unit"> ЕД</span>
              </b>
            </div>
          </div>

          {!edit ? (
            <>
              <div className="section-label sec">По частям суток</div>
              {PARTS.map((p) => (
                <div key={p.nm} className="bas-part">
                  <span className="bas-part-nm">{p.nm}<span className="bas-part-hr">{fmtH(p.a)}–{fmtH(p.b)}</span></span>
                  <span className="bas-part-av">{partAvg(pump, p).toFixed(2)}<span className="bas-part-du">{partDose(pump, p).toFixed(2)} ЕД</span></span>
                </div>
              ))}
              <div className="sheet-note">
                Значения в ЕД/ч. Профиль читается из Nightscout — это то, что сейчас стоит
                в помпе. Разбор «где профиля не хватает» по работе петли пока не считается,
                поэтому здесь его нет: рисовать потребность, которую мы не измерили, нельзя.
              </div>
            </>
          ) : (
            <>
              <div className="bas-tools">
                <button className="bas-tool" onClick={() => { setScalePct(0); setInner({ kind: 'scale' }); }}><b>%</b>весь профиль</button>
                <button className="bas-tool" onClick={() => setInner({ kind: 'flat' })}><b>≡</b>выровнять</button>
                <button className="bas-tool" onClick={() => apply(pump)}><b>↺</b>как в помпе</button>
              </div>
              <div className="section-label sec">Части суток</div>
              {PARTS.map((p, k) => {
                const op = openPart === k;
                return (
                  <div key={p.nm} className="bas-part-box">
                    <button className="bas-part bas-part-btn" onClick={() => setOpenPart(op ? -1 : k)}>
                      <span className="bas-cx">{op ? '▾' : '▸'}</span>
                      <span className="bas-part-nm">{p.nm}<span className="bas-part-hr">{fmtH(p.a)}–{fmtH(p.b)}</span></span>
                      <span className="bas-part-av">{partAvg(work, p).toFixed(2)}<span className="bas-part-du">{partDose(work, p).toFixed(2)} ЕД</span></span>
                    </button>
                    {op && (
                      <div className="bas-ivs">
                        <div className="bas-mini">
                          {[-5, 5, 10].map((d) => (
                            <button key={d} className="bas-mb"
                              onClick={() => apply(scalePart(work, p, d))}
                            >{d > 0 ? '+' : '−'}{Math.abs(d)} %</button>
                          ))}
                        </div>
                        {segsIn(work, p).map((x) => (
                          <button key={x.i} className={'bas-iv' + (changedAt(x.i) ? ' chg' : '')} onClick={() => setInner({ kind: 'seg', i: x.i })}>
                            <span className="bas-iv-t">{fmtH(x.s.a)}–{fmtH(x.s.b)}</span>
                            <span className="bas-iv-v">{x.s.v.toFixed(2)}</span>
                            <span className="bas-iv-f">в помпе {rateAt(pump, x.s.a).toFixed(2)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="sheet-note">Значения в ЕД/ч · шаг {STEP.toFixed(2)} · границы кратны 30 минутам — так же, как принимает помпа.</div>
            </>
          )}
      </Section>

      {/* Шаги правки — одноразовые подзадачи, им шторка и подходит. Вынесены в
          отдельный файл: пять экранов в одном компоненте не помещались в голову,
          и правка одного заставляла прокручивать четыре чужих. */}
      <BasalSteps
        inner={inner} onClose={() => setInner(null)}
        work={work} pump={pump} apply={apply}
        scalePct={scalePct} setScalePct={setScalePct}
        done={done} setDone={setDone} saved={saved} saveToHistory={saveToHistory}
      />
    </>
  );
}
