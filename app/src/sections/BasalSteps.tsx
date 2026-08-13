import { IonModal, IonContent, IonFooter, IonIcon } from '@ionic/react';
import { closeOutline } from 'ionicons/icons';
import {
  type Seg, STEP, MIN_RATE, MAX_RATE, fmtH, roundRate, rateAt, daily,
  splitSeg, mergeSeg, scaleAll, flatten,
} from '@/domain/basal';
import HoldButton from '@/ui/HoldButton';

/* Шаги правки базального профиля: значение интервала, масштаб всего профиля,
   выравнивание и перенос в помпу.

   Это одноразовые подзадачи поверх страницы — именно то, для чего шторка и нужна,
   в отличие от разделов, которые стали страницами стека. Крестик у них не оговорка:
   шторку закрывают, страницу проходят назад.

   Состояние живёт в родителе, а не здесь: правка — это его данные, и раздваивать
   их между двумя компонентами значило бы заводить рассинхрон. */

export type Inner =
  | null
  | { kind: 'seg'; i: number }
  | { kind: 'scale' }
  | { kind: 'flat' }
  | { kind: 'transfer' };

export default function BasalSteps({
  inner, onClose, work, pump, apply,
  scalePct, setScalePct, done, setDone, saved, saveToHistory,
}: {
  inner: Inner;
  onClose: () => void;
  work: Seg[];
  pump: Seg[];
  apply: (next: Seg[]) => void;
  scalePct: number;
  setScalePct: (f: (p: number) => number) => void;
  done: number[];
  setDone: (f: (d: number[]) => number[]) => void;
  saved: boolean;
  saveToHistory: () => void;
}) {
  const segIdx = inner?.kind === 'seg' ? inner.i : -1;
  const seg = segIdx >= 0 ? work[segIdx] ?? null : null;
  const segPump = seg ? rateAt(pump, seg.a) : 0;
  const setSegRate = (v: number) => apply(work.map((s, i) => (i === segIdx ? { ...s, v } : s)));
  const changedAt = (i: number) => Math.abs(work[i].v - rateAt(pump, work[i].a)) > 1e-6;
  const changedList = work.map((s, i) => ({ s, i })).filter((x) => changedAt(x.i));

  return (
    <>
      <IonModal isOpen={inner?.kind === 'seg'} onDidDismiss={() => onClose()} className="sheet-modal">
        <IonContent className="sheet">
          {seg && (
            <>
              <div className="sheet-head">
                <div>
                  <div className="sheet-title">{fmtH(seg.a)}–{fmtH(seg.b)}</div>
                  <div className="sheet-subtitle">интервал профиля</div>
                </div>
                <button className="sheet-close" onClick={() => onClose()} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
              </div>
              <div className="lim-kid">В помпе <b>{segPump.toFixed(2)} ЕД/ч</b>.</div>
              <div className="bas-stepper">
                <button className="bas-pm" disabled={seg.v <= MIN_RATE}
                  onClick={() => setSegRate(roundRate(seg.v - STEP))}>−</button>
                <div className="bas-stepval">{seg.v.toFixed(2)}<small>ЕД/ч · шаг {STEP.toFixed(2)}</small></div>
                <button className="bas-pm" disabled={seg.v >= MAX_RATE}
                  onClick={() => setSegRate(roundRate(seg.v + STEP))}>+</button>
              </div>
              <div className="bas-under">
                за интервал {((seg.b - seg.a) * seg.v).toFixed(2)} ЕД · суточный станет {daily(work).toFixed(2)} ЕД
              </div>
              {(() => {
                const i = segIdx;
                const prev = i > 0 ? work[i - 1].v : null, next = i < work.length - 1 ? work[i + 1].v : null;
                const jump = [prev, next].filter((x): x is number => x !== null)
                  .some((x) => Math.abs(seg.v - x) / Math.max(x, MIN_RATE) > 0.5);
                return jump ? (
                  <div className="lim-kid warn"><b>Резкий перепад с соседним интервалом</b> — больше чем в полтора раза. Так бывает, но чаще это опечатка.</div>
                ) : null;
              })()}
              <div className="bas-mini" style={{ marginTop: 12 }}>
                <button className="bas-mb" disabled={seg.b - seg.a < 1}
                  onClick={() => { apply(splitSeg(work, segIdx)); onClose(); }}>Разделить пополам</button>
                <button className="bas-mb" disabled={segIdx >= work.length - 1}
                  onClick={() => { apply(mergeSeg(work, segIdx)); onClose(); }}>Слить со следующим</button>
              </div>
            </>
          )}
        </IonContent>
        <IonFooter className="page-foot">
          {seg && Math.abs(seg.v - segPump) > 1e-6 ? (
            <div className="bas-act-col">
              <button className="page-btn bas-go" onClick={() => setSegRate(segPump)}>
                ↺ Вернуть как в помпе {segPump.toFixed(2)}
              </button>
              <button className="page-btn" onClick={() => onClose()}>Всё же оставить {seg.v.toFixed(2)}</button>
            </div>
          ) : (
            <button className="page-btn" onClick={() => onClose()}>Готово</button>
          )}
        </IonFooter>
      </IonModal>

      <IonModal isOpen={inner?.kind === 'scale'} onDidDismiss={() => onClose()} className="sheet-modal">
        <IonContent className="sheet">
          <div className="sheet-head">
            <div><div className="sheet-title">Весь профиль</div><div className="sheet-subtitle">пропорционально</div></div>
            <button className="sheet-close" onClick={() => onClose()} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
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
            <button className="page-btn bas-go" disabled={!scalePct}
              onClick={() => { apply(scaleAll(work, scalePct)); onClose(); }}>Применить</button>
            <button className="page-btn" onClick={() => onClose()}>Отмена</button>
          </div>
        </IonFooter>
      </IonModal>

      <IonModal isOpen={inner?.kind === 'flat'} onDidDismiss={() => onClose()} className="sheet-modal">
        <IonContent className="sheet">
          <div className="sheet-head">
            <div><div className="sheet-title">Выровнять</div><div className="sheet-subtitle">один уровень на сутки</div></div>
            <button className="sheet-close" onClick={() => onClose()} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
          </div>
          <div className="lim-kid">Все интервалы станут равными <b>{roundRate(daily(work) / 24).toFixed(2)} ЕД/ч</b> — суточная доза не изменится, исчезнет только форма.</div>
          <div className="sheet-note">Годится как исходная точка, когда профиль строится с нуля и данных о потребности по часам ещё нет.</div>
        </IonContent>
        <IonFooter className="page-foot">
          <div className="bas-act-col">
            <button className="page-btn bas-go" onClick={() => { apply(flatten(work)); onClose(); }}>Выровнять</button>
            <button className="page-btn" onClick={() => onClose()}>Отмена</button>
          </div>
        </IonFooter>
      </IonModal>

      <IonModal isOpen={inner?.kind === 'transfer'} onDidDismiss={() => onClose()} className="sheet-modal">
        <IonContent className="sheet">
          <div className="sheet-head">
            <div><div className="sheet-title">Перенос в помпу</div><div className="sheet-subtitle">вручную, по интервалам</div></div>
            <button className="sheet-close" onClick={() => onClose()} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
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
            <button className="page-btn" onClick={() => onClose()}>Понятно</button>
          ) : (
            <div className="bas-act-col">
              <HoldButton
                label={done.length === changedList.length ? 'Удерживайте — записать в историю' : 'Отметьте все интервалы'}
                disabled={done.length !== changedList.length}
                onComplete={saveToHistory}
              />
              <button className="page-btn" onClick={() => onClose()}>Позже</button>
            </div>
          )}
        </IonFooter>
      </IonModal>
    </>
  );
}
