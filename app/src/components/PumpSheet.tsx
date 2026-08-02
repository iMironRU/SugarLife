import { IonModal, IonContent, IonIcon } from '@ionic/react';
import { closeOutline, flash, water, chevronForward } from 'ionicons/icons';
import { fmt } from '../data/units';
import type { Device, Profile } from '../data/nightscout';
import type { DeviceAges, Age } from '../data/treatmentStats';

const ageText = (a: Age) => (a.days >= 1 ? a.days + ' дн' : a.hours + ' ч');

/* Шторка «Помпа»: базал/болюс, расходники (канюля/резервуар/батарея), инсулины. */
export default function PumpSheet({
  isOpen, onClose, dev, profile, ages,
}: {
  isOpen: boolean; onClose: () => void;
  dev: Device | null; profile: Profile | null; ages: DeviceAges;
}) {
  const hasSupplies = ages.site || ages.reservoir || ages.battery;
  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.75} breakpoints={[0, 0.75, 1]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">Помпа</div>
            <div className="sheet-subtitle">{dev?.status || 'Помпа'}</div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        {/* базал / болюс */}
        <div className="basal-rows sheet-basal">
          <div className="basal-row">
            <span>Активный инсулин</span>
            <b>{dev?.iob != null ? fmt(dev.iob) + ' ед' : '—'}</b>
          </div>
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

        {/* расходники */}
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

        {/* инсулины */}
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
      </IonContent>
    </IonModal>
  );
}
