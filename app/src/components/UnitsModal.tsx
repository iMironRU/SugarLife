import { IonModal, IonContent, IonIcon } from '@ionic/react';
import { closeOutline, checkmarkCircle, ellipseOutline } from 'ionicons/icons';
import { useUnit, setUnit, type Unit } from '../data/units';

const OPTS: { key: Unit; title: string; sub: string; unit: string; normal: string; low: string; high: string; scale: string }[] = [
  {
    key: 'mmol', title: 'ммоль/л', sub: 'Россия, Европа, Австралия', unit: 'ммоль/л',
    normal: '5,8', low: '3,4', high: '12,8',
    scale: 'Единицы и десятые: значения от 2 до 25 — привычная шкала «5,8».',
  },
  {
    key: 'mgdl', title: 'мг/дл', sub: 'США, Германия, Израиль', unit: 'мг/дл',
    normal: '104', low: '61', high: '230',
    scale: 'Сотни: те же значения выглядят как «104» — умножены примерно на 18.',
  },
];

export default function UnitsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const unit = useUnit();

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.85} breakpoints={[0, 0.85]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">Единицы измерения</div>
            <div className="sheet-subtitle">Глюкоза во всём приложении</div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        <div className="section-label" style={{ marginTop: 6 }}>Глюкоза</div>
        <div className="unit-opts">
          {OPTS.map((o) => {
            const on = unit === o.key;
            return (
              <button key={o.key} className={'unit-opt' + (on ? ' on' : '')} onClick={() => setUnit(o.key)}>
                <div className="unit-opt-head">
                  <div>
                    <div className="unit-opt-title">{o.title}</div>
                    <div className="unit-opt-sub">{o.sub}</div>
                  </div>
                  <IonIcon
                    icon={on ? checkmarkCircle : ellipseOutline}
                    className="unit-opt-check"
                    style={{ color: on ? 'var(--color-accent)' : 'var(--color-neutral-700)' }}
                  />
                </div>
                <div className="unit-opt-ex">
                  <div className="unit-ex">
                    <span className="unit-ex-lbl">норма</span>
                    <span className="unit-ex-val" style={{ color: 'var(--c-glu)' }}>{o.normal}<i>{o.unit}</i></span>
                  </div>
                  <div className="unit-ex">
                    <span className="unit-ex-lbl">гипо</span>
                    <span className="unit-ex-val" style={{ color: 'var(--c-danger-2)' }}>{o.low}<i>{o.unit}</i></span>
                  </div>
                  <div className="unit-ex">
                    <span className="unit-ex-lbl">гипер</span>
                    <span className="unit-ex-val" style={{ color: 'var(--c-carb)' }}>{o.high}<i>{o.unit}</i></span>
                  </div>
                </div>
                <div className="unit-opt-scale">{o.scale}</div>
              </button>
            );
          })}
        </div>

        <div className="sheet-note">Пересчёт: 1 ммоль/л ≈ 18 мг/дл. Смена единиц не меняет историю — только то, как она показана.</div>
      </IonContent>
    </IonModal>
  );
}
