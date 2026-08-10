import { IonModal, IonContent, IonIcon } from '@ionic/react';
import { closeOutline, checkmarkCircle, ellipseOutline } from 'ionicons/icons';
import { useCarbUnit, setCarbUnit, type CarbUnit } from '@/domain/units';

const OPTS: { key: CarbUnit; title: string; sub: string; unit: string; ex1: string; ex2: string; ex3: string; scale: string }[] = [
  {
    key: 'g', title: 'Граммы', sub: 'точный вес углеводов', unit: 'г',
    ex1: '42', ex2: '19', ex3: '186',
    scale: 'Десятки и сотни: считаете граммы прямо с упаковки или из справочника.',
  },
  {
    key: 'xe', title: 'Хлебные единицы', sub: 'традиционный счёт, 1 Х.Е. = 12 г', unit: 'Х.Е.',
    ex1: '3,5', ex2: '1,6', ex3: '15,5',
    scale: 'Единицы: те же порции выглядят как «3,5» — удобно, если врач считает в Х.Е.',
  },
];

export default function CarbUnitsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const unit = useCarbUnit();

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.85} breakpoints={[0, 0.85]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">Единицы еды</div>
            <div className="sheet-subtitle">Углеводы во всём приложении</div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        <div className="section-label" style={{ marginTop: 6 }}>Углеводы</div>
        <div className="unit-opts">
          {OPTS.map((o) => {
            const on = unit === o.key;
            return (
              <button key={o.key} className={'unit-opt' + (on ? ' on' : '')} onClick={() => setCarbUnit(o.key)}>
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
                    <span className="unit-ex-lbl">тарелка</span>
                    <span className="unit-ex-val" style={{ color: 'var(--c-carb)' }}>{o.ex1}<i>{o.unit}</i></span>
                  </div>
                  <div className="unit-ex">
                    <span className="unit-ex-lbl">перекус</span>
                    <span className="unit-ex-val" style={{ color: 'var(--c-carb)' }}>{o.ex2}<i>{o.unit}</i></span>
                  </div>
                  <div className="unit-ex">
                    <span className="unit-ex-lbl">за день</span>
                    <span className="unit-ex-val" style={{ color: 'var(--c-carb)' }}>{o.ex3}<i>{o.unit}</i></span>
                  </div>
                </div>
                <div className="unit-opt-scale">{o.scale}</div>
              </button>
            );
          })}
        </div>

        <div className="sheet-note">Пересчёт: 1 Х.Е. = 12 г. Смена единиц не меняет данные — только то, как они показаны и вводятся.</div>
      </IonContent>
    </IonModal>
  );
}
