import PageHead from '@/ui/PageHead';
import Row from '@/ui/Row';
import { hardwareChipOutline, flash, repeat, speedometerOutline, helpCircleOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useStore } from '@/sources/store';
import { useDeviceConfig, deviceStatus, deviceStatusLabel } from '@/settings/deviceConfig';
import { pumpById, sensorById } from '@/domain/catalog';
import DeviceSection, { type DeviceCatKey } from '@/sections/DeviceSection';
import { useStack } from '@/app/stackCtx';
import RequirementsCatalogSheet from '@/sheets/RequirementsCatalogSheet';

/* Профиль → «Устройства» — отдельный полноэкранный раздел (не вложенная секция), как в
   docs/CONNECT-UX.md §10 «Карта интерфейса». Группировка по классу устройства (§2a: реестр).
   Детали (резервуар/батарея и т.п.) показываем только когда данные реально есть — честно. */
export default function DevicesSection({ onClose }: { onClose: () => void }) {
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
  const openCat = (c: DeviceCatKey) => push(<DeviceSection cat={c} title={titles[c]} onClose={pop} />);

  return (
    <div className="sheet stack-body">
        <PageHead title="Устройства" subtitle="Профиль · Устройства" onBack={onClose} />
        <div className="sheet-note">
          Тапни устройство — там все действия (мост, подключение, «забыть»). На плитке ничего не отключишь случайно.
        </div>

        <div className="section-label sec">Помпа</div>
        <div className="list">
          <Row icon={flash} title={pump?.model ?? 'Ввод инсулина'} sub={pumpDetail || undefined}
            value={deviceStatusLabel(deviceStatus('pump', devCfg))} onClick={() => openCat('pump')} />
        </div>

        <div className="section-label sec">Сенсоры</div>
        <div className="list">
          <Row icon={hardwareChipOutline} title={sensor?.name ?? 'Сенсор (НМГ)'}
            value={deviceStatusLabel(deviceStatus('sensor', devCfg))} onClick={() => openCat('sensor')} />
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
