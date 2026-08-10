import { IonModal, IonContent, IonFooter, IonIcon } from '@ionic/react';
import { chevronBack, chevronForward, hardwareChipOutline, flash, repeat, speedometerOutline, helpCircleOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useStore } from '../data/store';
import { useDeviceConfig, deviceStatus, deviceStatusLabel } from '../data/deviceConfig';
import { pumpById, sensorById } from '../data/catalog';
import DeviceSheet, { type DeviceCatKey } from './DeviceSheet';
import RequirementsCatalogSheet from './RequirementsCatalogSheet';

/* Профиль → «Устройства» — отдельный полноэкранный раздел (не вложенная секция), как в
   docs/CONNECT-UX.md §10 «Карта интерфейса». Группировка по классу устройства (§2a: реестр).
   Детали (резервуар/батарея и т.п.) показываем только когда данные реально есть — честно. */
export default function DevicesScreen({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { data } = useStore();
  const devCfg = useDeviceConfig();
  const [cat, setCat] = useState<DeviceCatKey | null>(null);
  const [reqOpen, setReqOpen] = useState(false);

  const pump = pumpById(devCfg.pumpId);
  const sensor = sensorById(devCfg.sensorId);
  const dev = data?.device ?? null;

  // деталь-строка честна: показываем только то, что реально знаем (из Nightscout devicestatus)
  const pumpDetail = pump
    ? [dev?.reservoir != null ? Math.round(dev.reservoir) + ' ед' : null, dev?.pumpBattery != null ? dev.pumpBattery + '%' : null]
        .filter(Boolean).join(' · ') || 'нет данных о резервуаре/батарее'
    : null;

  const close = () => { onClose(); setCat(null); setReqOpen(false); };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={close} className={'full-page' + (cat || reqOpen ? ' is-behind' : '')}>
      <IonContent className="sheet">
        <div className="sheet-head">
          <button className="sheet-close" onClick={close} aria-label="Назад"><IonIcon icon={chevronBack} /></button>
          <div style={{ flex: 1 }}>
            <div className="sheet-title">Устройства</div>
            <div className="sheet-subtitle">Профиль · Устройства</div>
          </div>
        </div>
        <div className="sheet-note">
          Тапни устройство — там все действия (мост, подключение, «забыть»). На плитке ничего не отключишь случайно.
        </div>

        <div className="section-label sec">Помпа</div>
        <div className="list">
          <button className="list-row" onClick={() => setCat('pump')}>
            <IonIcon icon={flash} className="list-ico" />
            <span className="pick-main">
              <span className="list-title">{pump?.model ?? 'Ввод инсулина'}</span>
              {pumpDetail && <span className="pick-sub">{pumpDetail}</span>}
            </span>
            <span className="list-value">{deviceStatusLabel(deviceStatus('pump', devCfg))}</span>
            <IonIcon icon={chevronForward} className="list-chev" />
          </button>
        </div>

        <div className="section-label sec">Сенсоры</div>
        <div className="list">
          <button className="list-row" onClick={() => setCat('sensor')}>
            <IonIcon icon={hardwareChipOutline} className="list-ico" />
            <span className="pick-main">
              <span className="list-title">{sensor?.name ?? 'Сенсор (НМГ)'}</span>
            </span>
            <span className="list-value">{deviceStatusLabel(deviceStatus('sensor', devCfg))}</span>
            <IonIcon icon={chevronForward} className="list-chev" />
          </button>
        </div>

        <div className="section-label sec">Глюкометры и петля</div>
        <div className="list">
          <button className="list-row" onClick={() => setCat('meter')}>
            <IonIcon icon={speedometerOutline} className="list-ico" />
            <span className="list-title">Глюкометр</span>
            <span className="list-value">настроить</span>
            <IonIcon icon={chevronForward} className="list-chev" />
          </button>
          <button className="list-row" onClick={() => setCat('loop')}>
            <IonIcon icon={repeat} className="list-ico" />
            <span className="list-title">Петля</span>
            <span className="list-value">настроить</span>
            <IonIcon icon={chevronForward} className="list-chev" />
          </button>
        </div>

        <div className="list" style={{ marginTop: 12 }}>
          <button className="list-row" onClick={() => setReqOpen(true)}>
            <IonIcon icon={helpCircleOutline} className="list-ico" />
            <span className="list-title">Проверить / записать по модели</span>
            <IonIcon icon={chevronForward} className="list-chev" />
          </button>
        </div>

        {(['sensor', 'pump', 'loop', 'meter'] as DeviceCatKey[]).map((c) => (
          <DeviceSheet
            key={c} isOpen={cat === c} onClose={() => setCat(null)} cat={c}
            title={c === 'sensor' ? 'Сенсор (НМГ)' : c === 'pump' ? 'Ввод инсулина' : c === 'loop' ? 'Петля' : 'Глюкометр'}
            
          />
        ))}
        <RequirementsCatalogSheet isOpen={reqOpen} onClose={() => setReqOpen(false)} />
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
