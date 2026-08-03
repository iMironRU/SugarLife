import { IonModal, IonContent, IonIcon } from '@ionic/react';
import { closeOutline, constructOutline } from 'ionicons/icons';

/* Заглушка карточки устройства (Сенсор/Ввод инсулина/Петля/Глюкометр/Источник).
   Пока раздел «Устройства» строится рядом с существующими шторками — здесь только
   честный плейсхолдер с описанием, что тут будет. */
export default function DeviceStubSheet({
  isOpen, onClose, title, desc,
}: {
  isOpen: boolean; onClose: () => void; title: string; desc: string;
}) {
  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.5} breakpoints={[0, 0.5]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">{title}</div>
            <div className="sheet-subtitle">Устройство</div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>
        <div className="loop-empty">
          <IonIcon icon={constructOutline} />
          <div className="loop-empty-t">В разработке</div>
          <div className="loop-empty-s">{desc}</div>
        </div>
      </IonContent>
    </IonModal>
  );
}
