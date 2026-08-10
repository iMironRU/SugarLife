import { IonModal, IonContent, IonFooter, IonIcon } from '@ionic/react';
import { chevronBack, chevronForward, cloudOutline, addCircleOutline, pulse, flash } from 'ionicons/icons';
import { useState } from 'react';
import { useClouds, addCloud, type CloudConfig } from '../data/clouds';
import CloudSheet from './CloudSheet';

/* Профиль → «Сервисы» — отдельный полноэкранный раздел (docs/CONNECT-UX.md §10,
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

  /* Роли — иконками, а не словами: адрес Nightscout длинный, и подпись «глюкоза · помпа»
     отбирала у него половину строки, из-за чего адрес переносился посреди слова.
     Иконки те же, что на панели и в карточках: пульс — глюкоза, молния — помпа. */
  const roleIcons = (c: CloudConfig) => {
    if (!c.enabled) return <span className="list-value">выкл</span>;
    if (!c.sourceGlucose && !c.sourcePumpStatus) return <span className="list-value">ничего не берём</span>;
    return (
      <span className="list-roles">
        {c.sourceGlucose && <IonIcon icon={pulse} aria-label="глюкоза" title="глюкоза" />}
        {c.sourcePumpStatus && <IonIcon icon={flash} aria-label="статус помпы" title="статус помпы" />}
      </span>
    );
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={close} className="full-page">
      <IonContent className="sheet">
        <div className="sheet-head">
          <button className="sheet-close" onClick={close} aria-label="Назад"><IonIcon icon={chevronBack} /></button>
          <div style={{ flex: 1 }}>
            <div className="sheet-title">Сервисы</div>
            <div className="sheet-subtitle">Профиль · Сервисы</div>
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
              <span className="list-title one-line">{c.name || 'Nightscout'}</span>
              {roleIcons(c)}
              <IonIcon icon={chevronForward} className="list-chev" />
            </button>
          ))}
          <button className="list-row" onClick={onAdd}>
            <IonIcon icon={addCircleOutline} className="list-ico" />
            <span className="list-title">Добавить облако</span>
          </button>
        </div>

        <CloudSheet isOpen={!!open} onClose={() => setOpenId(null)} cloud={open} />
      </IonContent>
      {/* подвал ВНЕ прокрутки: фиксированный слой поверх контента перекрывал
          последнюю кнопку, пока не домотаешь до конца */}
      <IonFooter className="page-foot">
        <button className="page-back" onClick={close}>
          <IonIcon icon={chevronBack} />
          Назад
        </button>
      </IonFooter>
    </IonModal>
  );
}
