import { IonIcon } from '@ionic/react';
import PageHead from './PageHead';
import Row from './Row';
import { chevronForward, hardwareChipOutline, flash, repeat, speedometerOutline, helpCircleOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useStore } from '../data/store';
import { useDeviceConfig, deviceStatus, deviceStatusLabel } from '../data/deviceConfig';
import { pumpById, sensorById } from '../data/catalog';
import DeviceSheet, { type DeviceCatKey } from './DeviceSheet';
import { useStack } from '../data/stackCtx';
import RequirementsCatalogSheet from './RequirementsCatalogSheet';

/* Профиль → «Устройства» — отдельный полноэкранный раздел (не вложенная секция), как в
   docs/CONNECT-UX.md §10 «Карта интерфейса». Группировка по классу устройства (§2a: реестр).
   Детали (резервуар/батарея и т.п.) показываем только когда данные реально есть — честно. */
export default function DevicesScreen({ onClose }: { onClose: () => void }) {
  const { push, pop } = useStack();
  const { data } = useStore();
  const devCfg = useDeviceConfig();
  const [reqOpen, setReqOpen] = useState(false);

  const pump = pumpById(devCfg.pumpId);
  const sensor = sensorById(devCfg.sensorId);
  const dev = data?.device ?? null;

  // деталь-строка честна: показываем только то, что реально знаем (из Nightscout devicestatus)
  const pumpDetail = pump
    ? [dev?.reservoir != null ? Math.round(dev.reservoir) + ' ед' : null, dev?.pumpBattery != null ? dev.pumpBattery + '%' : null]
        .filter(Boolean).join(' · ') || 'нет данных о резервуаре/батарее'
    : null;

  const titles: Record<DeviceCatKey, string> = {
    sensor: 'Сенсор (НМГ)', pump: 'Ввод инсулина', loop: 'Петля', meter: 'Глюкометр',
  };
  const openCat = (c: DeviceCatKey) => push(<DeviceSheet cat={c} title={titles[c]} onClose={pop} />);

  return (
    <div className="sheet stack-body">
        <PageHead title="Устройства" subtitle="Профиль · Устройства" onBack={onClose} />
        <div className="sheet-note">
          Тапни устройство — там все действия (мост, подключение, «забыть»). На плитке ничего не отключишь случайно.
        </div>

        <div className="section-label sec">Помпа</div>
        <div className="list">
          <button className="list-row" onClick={() => openCat('pump')}>
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
          <button className="list-row" onClick={() => openCat('sensor')}>
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
          <Row icon={speedometerOutline} title="Глюкометр" value="настроить" onClick={() => openCat('meter')} />
          <Row icon={repeat} title="Петля" value="настроить" onClick={() => openCat('loop')} />
        </div>

        <div className="list" style={{ marginTop: 12 }}>
          <Row icon={helpCircleOutline} title="Проверить / записать по модели" onClick={() => setReqOpen(true)} />
        </div>
        <RequirementsCatalogSheet isOpen={reqOpen} onClose={() => setReqOpen(false)} />
    </div>
  );
}
