import { IonModal, IonContent, IonIcon } from '@ionic/react';
import { chevronBack, chevronForward, cloudOutline, addCircleOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useClouds, addCloud, type CloudConfig } from '../data/clouds';
import CloudSheet from './CloudSheet';

/* Профиль → «Способы / Сервисы» — отдельный полноэкранный раздел (docs/CONNECT-UX.md §10,
   §2b). Список облаков, а не одно поле: можно держать несколько Nightscout одновременно
   (свой + партнёра), у каждого — своя роль («забираем» глюкозу и/или статус помпы). */
export default function ServicesScreen({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const clouds = useClouds();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = clouds.find((c) => c.id === openId) ?? null;

  const close = () => { onClose(); setOpenId(null); };

  const onAdd = () => {
    const c = addCloud({
      kind: 'nightscout', name: 'Новое облако', url: '', token: '', enabled: false,
      sourceGlucose: true, sourcePumpStatus: true,
    });
    setOpenId(c.id);
  };

  const roleLabel = (c: CloudConfig) => {
    if (!c.enabled) return 'выкл';
    const roles = [c.sourceGlucose && 'глюкоза', c.sourcePumpStatus && 'помпа'].filter(Boolean);
    return roles.length ? roles.join(' · ') : 'подключено, ничего не берём';
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={close} className="full-page">
      <IonContent className="sheet">
        <div className="sheet-head">
          <button className="sheet-close" onClick={close} aria-label="Назад"><IonIcon icon={chevronBack} /></button>
          <div style={{ flex: 1 }}>
            <div className="sheet-title">Способы / Сервисы</div>
            <div className="sheet-subtitle">Профиль · Способы / Сервисы</div>
          </div>
        </div>
        <div className="sheet-note">
          Облако — такой же способ подключения, как мост, только со своими адресом/токеном.
          Можно держать несколько одновременно, у каждого своя роль в «Забираем отсюда».
        </div>

        <div className="section-label sec">Облака</div>
        <div className="list">
          {clouds.length === 0 && (
            <div className="list-row" style={{ cursor: 'default' }}>
              <span className="list-title muted">Нет ни одного облака</span>
            </div>
          )}
          {clouds.map((c) => (
            <button key={c.id} className="list-row" onClick={() => setOpenId(c.id)}>
              <IonIcon icon={cloudOutline} className="list-ico" />
              <span className="list-title">{c.name || 'Nightscout'}</span>
              <span className="list-value">{roleLabel(c)}</span>
              <IonIcon icon={chevronForward} className="list-chev" />
            </button>
          ))}
          <button className="list-row" onClick={onAdd}>
            <IonIcon icon={addCircleOutline} className="list-ico" />
            <span className="list-title">Добавить облако</span>
          </button>
        </div>

        <CloudSheet isOpen={!!open} onClose={() => setOpenId(null)} cloud={open} />
        {/* дубль «назад» внизу — вверху экрана до него не дотянуться большим пальцем */}
        <div className="page-foot" slot="fixed">
          <button className="page-back" onClick={close}>
            <IonIcon icon={chevronBack} />
            Назад
          </button>
        </div>
      </IonContent>
    </IonModal>
  );
}
