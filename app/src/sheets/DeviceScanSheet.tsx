import { IonModal, IonContent, IonIcon, IonSpinner } from '@ionic/react';
import { closeOutline, bluetoothOutline, chevronForward, radioOutline, checkmarkCircle } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useSnapshot, sendIntent } from '@/sources/bridge';
import type { Discovered, DriverDescriptor } from '@/sources/bridge';
import DeviceSettingsForm from './DeviceSettingsForm';

type Step = { kind: 'list' } | { kind: 'target'; item: Discovered } | { kind: 'params'; item: Discovered; target: DriverDescriptor | null };

/* Plug-and-play подключение устройства по контракту (§2.3/§3): «Подключить» → startScan →
   discovered[] → тап → прямое устройство (форма параметров) или мост (второй экран — выбор
   целевого устройства из transportFor) → addDiscovered. Показывается ТОЛЬКО когда мост
   реально предлагает драйвер для этой категории (availableDrivers) — иначе секции нет:
   Nightscout-шим никогда не сканирует, категории без BLE (шприцы/глюкометры) сюда не попадают. */
export default function DeviceScanSheet({ isOpen, onClose, kind, title }: {
  isOpen: boolean; onClose: () => void; kind: 'sensor' | 'pump'; title: string;
}) {
  const snap = useSnapshot();
  const drivers = snap?.availableDrivers ?? [];
  const discovered = snap?.discovered ?? [];
  const scanning = !!snap?.scanning;
  const driverById = (id: string) => drivers.find((d) => d.id === id) ?? null;

  const [step, setStep] = useState<Step>({ kind: 'list' });
  const [mode, setMode] = useState<'attach' | 'activate'>('attach');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!isOpen) { setStep({ kind: 'list' }); setValues({}); setMode('attach'); } }, [isOpen]);
  useEffect(() => { if (isOpen) sendIntent({ type: 'startScan' }); return () => { if (isOpen) sendIntent({ type: 'stopScan' }); }; }, [isOpen]);

  // релевантные категории: прямые устройства нужного kind + мосты, ведущие к нему
  const relevant = discovered.filter((d) => {
    const own = driverById(d.driverId);
    if (own?.kind === kind) return true;
    if (d.isTransport) return d.transportFor.some((t) => driverById(t)?.kind === kind);
    return false;
  });

  const pick = (item: Discovered) => {
    if (item.isTransport) { setStep({ kind: 'target', item }); return; }
    const own = driverById(item.driverId);
    if (item.needsMoreParams) { setStep({ kind: 'params', item, target: own }); return; }
    void confirm(item, null, {});
  };

  const pickTarget = (item: Discovered, targetId: string) => {
    setStep({ kind: 'params', item, target: driverById(targetId) });
  };

  const confirm = async (item: Discovered, target: DriverDescriptor | null, params: Record<string, string>) => {
    setBusy(true);
    await sendIntent({
      type: 'addDiscovered', bleId: item.bleId, driverType: item.driverId, params,
      mode: target?.canActivate ? mode : undefined, targetDriver: target?.id,
    });
    setBusy(false);
    onClose();
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.75} breakpoints={[0, 0.75, 1]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">Подключение по BLE</div>
            <div className="sheet-subtitle">{title}</div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        {step.kind === 'list' && (
          <>
            <div className={'scan-state' + (scanning ? ' on' : '')}>
              {scanning ? <IonSpinner name="crescent" /> : <IonIcon icon={bluetoothOutline} />}
              <span>{scanning ? 'Ищу устройства рядом…' : 'Поиск остановлен'}</span>
            </div>
            <div className="list">
              {relevant.map((d) => (
                <button key={d.bleId} className="list-row" onClick={() => pick(d)}>
                  <IonIcon icon={d.isTransport ? radioOutline : bluetoothOutline} className="list-ico" />
                  <span className="pick-main">
                    <span className="list-title">{d.displayName}</span>
                    {d.name && <span className="pick-sub">{d.name}</span>}
                  </span>
                  {d.rssi != null && <span className="list-value">{d.rssi} дБм</span>}
                  <IonIcon icon={chevronForward} className="list-chev" />
                </button>
              ))}
            </div>
            {!relevant.length && (
              <div className="metric-note" style={{ marginTop: 14 }}>
                {scanning ? 'Рядом ничего подходящего — держите устройство ближе.' : 'Пока ничего не найдено.'}
              </div>
            )}
          </>
        )}

        {step.kind === 'target' && (
          <>
            <div className="metric-note" style={{ marginTop: 0, marginBottom: 10 }}>«{step.item.displayName}» — мост. Выберите устройство, которое через него подключаем.</div>
            <div className="list">
              {step.item.transportFor.map((tid) => {
                const t = driverById(tid);
                if (!t || t.kind !== kind) return null;
                return (
                  <button key={tid} className="list-row" onClick={() => pickTarget(step.item, tid)}>
                    <IonIcon icon={bluetoothOutline} className="list-ico" />
                    <span className="list-title">{t.displayName}</span>
                    <IonIcon icon={chevronForward} className="list-chev" />
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step.kind === 'params' && (
          <>
            {step.target?.canActivate && (
              <div className="dev-seg" style={{ marginTop: 0 }}>
                <button className={'dev-seg-btn' + (mode === 'attach' ? ' on' : '')} onClick={() => setMode('attach')}>Уже активирован</button>
                <button className={'dev-seg-btn' + (mode === 'activate' ? ' on' : '')} onClick={() => setMode('activate')}>Активировать новый</button>
              </div>
            )}
            <DeviceSettingsForm
              params={step.target?.settings.parameters ?? []}
              values={values}
              onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
            />
            <button className="food-save" disabled={busy} onClick={() => confirm(step.item, step.target, values)} style={{ marginTop: 16 }}>
              <IonIcon icon={checkmarkCircle} style={{ marginRight: 6, verticalAlign: -2 }} />
              {busy ? 'Подключаю…' : 'Подключить'}
            </button>
          </>
        )}
      </IonContent>
    </IonModal>
  );
}
