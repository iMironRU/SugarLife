import { IonModal, IonContent, IonFooter, IonIcon } from '@ionic/react';
import { closeOutline, arrowUndoOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useStore } from '../data/store';
import {
  type Seg, PARTS, STEP, MIN_RATE, MAX_RATE, fmtH, roundRate, toSegs, rateAt, daily,
  partDose, partAvg, segsIn, sameProfile, splitSeg, mergeSeg, scaleAll, flatten,
} from '../data/basal';
import HoldButton from './HoldButton';

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
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
};
const writeLog = (l: LogEntry[]) => { try { localStorage.setItem(KEY, JSON.stringify(l.slice(-40))); } catch { /* переполнение хранилища не должно ронять экран */ } };

const W = 300, H = 110;
function path(segs: Seg[], max: number): string {
  let d = '';
  for (const s of segs) {
    const x1 = (s.a / 24) * W, x2 = (s.b / 24) * W, y = H - (s.v / max) * H;
    d += (d ? ` L${x1.toFixed(1)},${y.toFixed(1)}` : `M${x1.toFixed(1)},${y.toFixed(1)}`) + ` L${x2.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}

type Inner = null | { kind: 'seg'; i: number } | { kind: 'scale' } | { kind: 'flat' } | { kind: 'transfer' };

export default function BasalProfileSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { data } = useStore();
  const pump = toSegs(data?.profile?.basalSchedule ?? []);

  const [edit, setEdit] = useState(false);
  const [work, setWork] = useState<Seg[]>(pump);
  const [undoStack, setUndo] = useState<Seg[][]>([]);
  const [openPart, setOpenPart] = useState(1);
  const [inner, setInner] = useState<Inner>(null);
  const [scalePct, setScalePct] = useState(0);
  const [done, setDone] = useState<number[]>([]);
  const [saved, setSaved] = useState(false);

  // при каждом открытии начинаем от того, что сейчас в помпе
  useEffect(() => {
    if (!isOpen) return;
    setWork(toSegs(data?.profile?.basalSchedule ?? []));
    setUndo([]); setEdit(false); setInner(null); setDone([]); setSaved(false); setScalePct(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const changedAll = !sameProfile(work, pump);
  const changedAt = (i: number) => Math.abs(work[i].v - rateAt(pump, work[i].a)) > 1e-6;

  const apply = (next: Seg[]) => { setUndo((u) => [...u.slice(-19), work]); setWork(next); };
  const undo = () => { if (!undoStack.length) return; setWork(undoStack[undoStack.length - 1]); setUndo((u) => u.slice(0, -1)); };

  const max = Math.max(1.05, ...pump.map((s) => s.v), ...work.map((s) => s.v)) * 1.05;
  const changedList = work.map((s, i) => ({ s, i })).filter((x) => changedAt(x.i));

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
      <IonModal isOpen={isOpen} onDidDismiss={onClose} className="full-page">
        <IonContent className="sheet">
          <div className="sheet-head">
            <div><div className="sheet-title">Базальный профиль</div></div>
            <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
          </div>
          <div className="loop-empty">
            <div className="loop-empty-t">Профиль не получен</div>
            <div className="loop-empty-s">
              Расписание базала приходит из Nightscout вместе с профилем. Пока его нет,
              редактировать нечего — показывать пустую сетку и делать вид, что это ваш
              профиль, было бы обманом.
            </div>
          </div>
        </IonContent>
      </IonModal>
    );
  }

  const seg = inner?.kind === 'seg' ? work[inner.i] : null;
  const segPump = seg ? rateAt(pump, seg.a) : 0;

  return (
    <>
      <IonModal isOpen={isOpen} onDidDismiss={onClose} backdropDismiss={!changedAll || saved} className={'full-page' + (inner ? ' is-behind' : '')}>
        <IonContent className="sheet">
          <div className="sheet-head">
            <div>
              <div className="sheet-title">Базальный профиль</div>
              <div className="sheet-subtitle">{data?.profile?.name ?? 'из Nightscout'}</div>
            </div>
            <button className="sheet-close" onClick={askClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
          </div>

          <div className="dev-seg">
            <button className={'dev-seg-btn' + (!edit ? ' on' : '')} onClick={() => setEdit(false)}>Как есть</button>
            <button className={'dev-seg-btn' + (edit ? ' on' : '')} onClick={() => setEdit(true)}>Правка</button>
          </div>

          {/* график: ступени за сутки, полосы частей суток для ориентира */}
          <div className="bas-card">
            <svg className="bas-chart" viewBox="0 0 300 132" preserveAspectRatio="none" aria-hidden="true">
              {PARTS.map((p, k) => (
                <rect key={p.nm} x={(p.a / 24) * W} y="0" width={((p.b - p.a) / 24) * W} height={H}
                  fill={k % 2 ? 'var(--color-neutral-900)' : 'transparent'} />
              ))}
              <line x1="0" y1={H} x2={W} y2={H} stroke="var(--color-neutral-800)" strokeWidth="1" />
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
                            <button key={d} className="bas-mb" onClick={() => {
                              const idx = new Set(segsIn(work, p).map((x) => x.i));
                              apply(work.map((s, i) => (idx.has(i) ? { ...s, v: roundRate(s.v * (1 + d / 100)) } : s)));
                            }}>{d > 0 ? '+' : '−'}{Math.abs(d)} %</button>
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
        </IonContent>
        <IonFooter className="page-foot">
          {!edit ? (
            <button className="page-back" onClick={() => setEdit(true)}>Править профиль</button>
          ) : (
            <div className="bas-act">
              <button className="page-back bas-undo" onClick={undo} disabled={!undoStack.length} aria-label="Отменить">
                <IonIcon icon={arrowUndoOutline} />
              </button>
              <button className="page-back bas-go" onClick={() => { setDone([]); setSaved(false); setInner({ kind: 'transfer' }); }} disabled={!changedAll}>
                Перенести в помпу
              </button>
            </div>
          )}
        </IonFooter>
      </IonModal>

      {/* ---- вложенные шторки ---- */}
      <IonModal isOpen={inner?.kind === 'seg'} onDidDismiss={() => setInner(null)} className="full-page">
        <IonContent className="sheet">
          {seg && (
            <>
              <div className="sheet-head">
                <div>
                  <div className="sheet-title">{fmtH(seg.a)}–{fmtH(seg.b)}</div>
                  <div className="sheet-subtitle">интервал профиля</div>
                </div>
                <button className="sheet-close" onClick={() => setInner(null)} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
              </div>
              <div className="lim-kid">В помпе <b>{segPump.toFixed(2)} ЕД/ч</b>.</div>
              <div className="bas-stepper">
                <button className="bas-pm" disabled={seg.v <= MIN_RATE}
                  onClick={() => apply(work.map((s, i) => (i === (inner as any).i ? { ...s, v: roundRate(s.v - STEP) } : s)))}>−</button>
                <div className="bas-stepval">{seg.v.toFixed(2)}<small>ЕД/ч · шаг {STEP.toFixed(2)}</small></div>
                <button className="bas-pm" disabled={seg.v >= MAX_RATE}
                  onClick={() => apply(work.map((s, i) => (i === (inner as any).i ? { ...s, v: roundRate(s.v + STEP) } : s)))}>+</button>
              </div>
              <div className="bas-under">
                за интервал {((seg.b - seg.a) * seg.v).toFixed(2)} ЕД · суточный станет {daily(work).toFixed(2)} ЕД
              </div>
              {(() => {
                const i = (inner as any).i as number;
                const prev = i > 0 ? work[i - 1].v : null, next = i < work.length - 1 ? work[i + 1].v : null;
                const jump = [prev, next].filter((x): x is number => x !== null)
                  .some((x) => Math.abs(seg.v - x) / Math.max(x, MIN_RATE) > 0.5);
                return jump ? (
                  <div className="lim-kid warn"><b>Резкий перепад с соседним интервалом</b> — больше чем в полтора раза. Так бывает, но чаще это опечатка.</div>
                ) : null;
              })()}
              <div className="bas-mini" style={{ marginTop: 12 }}>
                <button className="bas-mb" disabled={seg.b - seg.a < 1}
                  onClick={() => { apply(splitSeg(work, (inner as any).i)); setInner(null); }}>Разделить пополам</button>
                <button className="bas-mb" disabled={(inner as any).i >= work.length - 1}
                  onClick={() => { apply(mergeSeg(work, (inner as any).i)); setInner(null); }}>Слить со следующим</button>
              </div>
            </>
          )}
        </IonContent>
        <IonFooter className="page-foot">
          {seg && Math.abs(seg.v - segPump) > 1e-6 ? (
            <div className="bas-act-col">
              <button className="page-back bas-go" onClick={() => apply(work.map((s, i) => (i === (inner as any).i ? { ...s, v: segPump } : s)))}>
                ↺ Вернуть как в помпе {segPump.toFixed(2)}
              </button>
              <button className="page-back" onClick={() => setInner(null)}>Всё же оставить {seg.v.toFixed(2)}</button>
            </div>
          ) : (
            <button className="page-back" onClick={() => setInner(null)}>Готово</button>
          )}
        </IonFooter>
      </IonModal>

      <IonModal isOpen={inner?.kind === 'scale'} onDidDismiss={() => setInner(null)} className="full-page">
        <IonContent className="sheet">
          <div className="sheet-head">
            <div><div className="sheet-title">Весь профиль</div><div className="sheet-subtitle">пропорционально</div></div>
            <button className="sheet-close" onClick={() => setInner(null)} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
          </div>
          <div className="lim-kid">Меняет <b>весь профиль пропорционально</b>. Форма сохраняется, сдвигается уровень целиком — так поступают при болезни, смене сезона или после заметного изменения веса.</div>
          <div className="bas-stepper">
            <button className="bas-pm" onClick={() => setScalePct((f) => f - 5)}>−</button>
            <div className="bas-stepval">{scalePct > 0 ? '+' : ''}{scalePct} %<small>шаг 5 %</small></div>
            <button className="bas-pm" onClick={() => setScalePct((f) => f + 5)}>+</button>
          </div>
          <div className="bas-under">
            суточный {daily(work).toFixed(2)} → <span style={{ color: 'var(--c-glu)' }}>{daily(scaleAll(work, scalePct)).toFixed(2)}</span> ЕД
          </div>
          {Math.abs(scalePct) > 20 && (
            <div className="lim-kid warn"><b>Изменение больше 20 %.</b> Такие сдвиги обычно делят на несколько шагов и проверяют по несколько дней.</div>
          )}
        </IonContent>
        <IonFooter className="page-foot">
          <div className="bas-act-col">
            <button className="page-back bas-go" disabled={!scalePct}
              onClick={() => { apply(scaleAll(work, scalePct)); setInner(null); }}>Применить</button>
            <button className="page-back" onClick={() => setInner(null)}>Отмена</button>
          </div>
        </IonFooter>
      </IonModal>

      <IonModal isOpen={inner?.kind === 'flat'} onDidDismiss={() => setInner(null)} className="full-page">
        <IonContent className="sheet">
          <div className="sheet-head">
            <div><div className="sheet-title">Выровнять</div><div className="sheet-subtitle">один уровень на сутки</div></div>
            <button className="sheet-close" onClick={() => setInner(null)} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
          </div>
          <div className="lim-kid">Все интервалы станут равными <b>{roundRate(daily(work) / 24).toFixed(2)} ЕД/ч</b> — суточная доза не изменится, исчезнет только форма.</div>
          <div className="sheet-note">Годится как исходная точка, когда профиль строится с нуля и данных о потребности по часам ещё нет.</div>
        </IonContent>
        <IonFooter className="page-foot">
          <div className="bas-act-col">
            <button className="page-back bas-go" onClick={() => { apply(flatten(work)); setInner(null); }}>Выровнять</button>
            <button className="page-back" onClick={() => setInner(null)}>Отмена</button>
          </div>
        </IonFooter>
      </IonModal>

      <IonModal isOpen={inner?.kind === 'transfer'} onDidDismiss={() => setInner(null)} className="full-page">
        <IonContent className="sheet">
          <div className="sheet-head">
            <div><div className="sheet-title">Перенос в помпу</div><div className="sheet-subtitle">вручную, по интервалам</div></div>
            <button className="sheet-close" onClick={() => setInner(null)} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
          </div>
          {saved ? (
            <>
              <div className="lim-kid">Изменение профиля сохранено с датой и временем. При следующем разборе сравнение пойдёт <b>от этой точки</b>, а не от старого профиля.</div>
              <div className="sheet-note">Через две-три недели станет видно, помогло ли.</div>
            </>
          ) : (
            <>
              <div className="lim-kid">Приложение не отправляет команды в помпу. Введите значения на самой помпе, затем отметьте здесь — <b>это попадёт в историю профиля</b>.</div>
              {changedList.map((x) => {
                const on = done.includes(x.i);
                return (
                  <button key={x.i} className={'bas-chk' + (on ? ' on' : '')}
                    onClick={() => setDone((d) => (on ? d.filter((k) => k !== x.i) : [...d, x.i]))}>
                    <span className="bas-box">✓</span>
                    <span className="bas-chk-n">{fmtH(x.s.a)}–{fmtH(x.s.b)}</span>
                    <span className="bas-chk-t">{rateAt(pump, x.s.a).toFixed(2)} → <b>{x.s.v.toFixed(2)}</b> ЕД/ч</span>
                  </button>
                );
              })}
              <div className="sheet-note">Остальные интервалы не трогайте.</div>
            </>
          )}
        </IonContent>
        <IonFooter className="page-foot">
          {saved ? (
            <button className="page-back" onClick={() => setInner(null)}>Понятно</button>
          ) : (
            <div className="bas-act-col">
              <HoldButton
                label={done.length === changedList.length ? 'Удерживайте — записать в историю' : 'Отметьте все интервалы'}
                disabled={done.length !== changedList.length}
                onComplete={saveToHistory}
              />
              <button className="page-back" onClick={() => setInner(null)}>Позже</button>
            </div>
          )}
        </IonFooter>
      </IonModal>
    </>
  );
}
