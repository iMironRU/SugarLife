import { IonModal, IonContent, IonIcon } from '@ionic/react';
import { closeOutline, flash, water, chevronForward } from 'ionicons/icons';
import { useState } from 'react';
import { fmt } from '../data/units';
import type { Device, Profile } from '../data/nightscout';
import type { DeviceAges, Age } from '../data/treatmentStats';
import { useDeviceConfig, setDeviceConfig } from '../data/deviceConfig';
import {
  INSULINS, PUMPS, insulinById, pumpById, isFastInsulin, isCurrentInsulin, isCurrentPump, pumpBrand,
} from '../data/catalog';
import CatalogPicker, { type PickerItem } from './CatalogPicker';

const ageText = (a: Age) => (a.days >= 1 ? a.days + ' дн' : a.hours + ' ч');

// элементы пикеров (в помпе — один быстрый инсулин)
const pumpItems: PickerItem[] = PUMPS
  .map((p) => ({ id: p.id, title: p.model, subtitle: pumpBrand(p), meta: p.reservoir || '', current: isCurrentPump(p) }))
  .sort((a, b) => Number(b.current) - Number(a.current) || a.subtitle!.localeCompare(b.subtitle!) || a.title.localeCompare(b.title));
const insulinItems: PickerItem[] = INSULINS
  .map((i) => ({
    id: i.id, title: i.name,
    subtitle: [i.action_type, i.manufacturer].filter(Boolean).join(' · '),
    meta: (i.concentrations || []).join('/'),
    current: isFastInsulin(i) && isCurrentInsulin(i),
  }))
  .sort((a, b) => Number(b.current) - Number(a.current) || a.title.localeCompare(b.title));

/* Шторка «Помпа»: базал/болюс, расходники, устройство (помпа + один инсулин).
   Помпа кормит и базал, и болюс из ОДНОГО быстрого инсулина — поэтому инсулин один.
   Выбор помпы/инсулина хранится локально (deviceConfig), в Nightscout не пишется. */
export default function PumpSheet({
  isOpen, onClose, dev, profile, ages,
}: {
  isOpen: boolean; onClose: () => void;
  dev: Device | null; profile: Profile | null; ages: DeviceAges;
}) {
  const cfg = useDeviceConfig();
  const [pick, setPick] = useState<null | 'pump' | 'insulin'>(null);
  const pump = pumpById(cfg.pumpId);
  const insulin = insulinById(cfg.fastInsulinId);
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

        {/* устройство и инсулин — выбор из справочника */}
        <div className="section-label sec">Устройство и инсулин</div>
        <div className="list">
          <button className="list-row" onClick={() => setPick('pump')}>
            <IonIcon icon={flash} className="list-ico" />
            <span className="list-title">Помпа</span>
            <span className={'list-value' + (pump ? '' : ' muted')}>{pump ? pump.model : 'выбрать'}</span>
            <IonIcon icon={chevronForward} className="list-chev" />
          </button>
          <button className="list-row" onClick={() => setPick('insulin')}>
            <IonIcon icon={water} className="list-ico" />
            <span className="list-title">Инсулин</span>
            <span className={'list-value' + (insulin ? '' : ' muted')}>{insulin ? insulin.name : 'выбрать'}</span>
            <IonIcon icon={chevronForward} className="list-chev" />
          </button>
        </div>
        <div className="sheet-note">В помпе один быстрый инсулин — он идёт и на базал, и на болюс. Выбор хранится только на этом устройстве.</div>

        <CatalogPicker
          isOpen={pick === 'pump'} onClose={() => setPick(null)}
          title="Выбор помпы" subtitle="Справочник моделей"
          items={pumpItems} selectedId={cfg.pumpId}
          onSelect={(id) => setDeviceConfig({ pumpId: id })}
          currentLabel="только актуальные модели"
        />
        <CatalogPicker
          isOpen={pick === 'insulin'} onClose={() => setPick(null)}
          title="Выбор инсулина" subtitle="Быстрый инсулин для помпы"
          items={insulinItems} selectedId={cfg.fastInsulinId}
          onSelect={(id) => setDeviceConfig({ fastInsulinId: id })}
          currentLabel="только актуальные быстрые"
        />
      </IonContent>
    </IonModal>
  );
}
