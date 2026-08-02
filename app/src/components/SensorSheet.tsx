import { IonModal, IonContent, IonIcon } from '@ionic/react';
import { closeOutline, hardwareChipOutline } from 'ionicons/icons';
import type { Age } from '../data/treatmentStats';

const fmtWhen = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} в ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* Шторка «Датчик» — детали сенсора. Пока в основном заглушка: показываем то, что
   есть из Nightscout (день/установлен), остальное появится позже. */
export default function SensorSheet({
  isOpen, onClose, sensor,
}: { isOpen: boolean; onClose: () => void; sensor: Age | null }) {
  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.6} breakpoints={[0, 0.6]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">Датчик</div>
            <div className="sheet-subtitle">{sensor ? 'День ' + (sensor.days + 1) : 'Нет данных'}</div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        {sensor && (
          <div className="basal-rows sheet-basal">
            <div className="basal-row"><span>День</span><b>{sensor.days + 1}</b></div>
            <div className="basal-row"><span>Установлен</span><b>{fmtWhen(sensor.at)}</b></div>
            <div className="basal-row"><span>Носится</span><b>{sensor.days >= 1 ? sensor.days + ' дн' : sensor.hours + ' ч'}</b></div>
          </div>
        )}

        <div className="loop-empty">
          <IonIcon icon={hardwareChipOutline} />
          <div className="loop-empty-t">Больше о датчике появится позже</div>
          <div className="loop-empty-s">Модель, серийник, калибровки и переключение между датчиками — в разработке.</div>
        </div>
      </IonContent>
    </IonModal>
  );
}
