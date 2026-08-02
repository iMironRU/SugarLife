import { IonModal, IonContent, IonIcon } from '@ionic/react';
import { closeOutline, repeat } from 'ionicons/icons';

/* Шторка «Петля» — пока заглушка (настройки/статус замкнутого цикла позже). */
export default function LoopSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.5} breakpoints={[0, 0.5]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">Петля</div>
            <div className="sheet-subtitle">Замкнутый цикл</div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>
        <div className="loop-empty">
          <IonIcon icon={repeat} />
          <div className="loop-empty-t">Здесь появятся статус и настройки петли</div>
          <div className="loop-empty-s">Пока раздел в разработке.</div>
        </div>
      </IonContent>
    </IonModal>
  );
}
