import { IonModal, IonContent, IonIcon, IonSpinner, IonToggle } from '@ionic/react';
import { closeOutline, chevronForward, hardwareChipOutline, flash, gitNetworkOutline, cloudOutline, bluetoothOutline, pulseOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useDeviceConfig, setDeviceConfig } from '../data/deviceConfig';
import { useSnapshot, sendIntent } from '../data/bridge';
import type { DeviceInfo } from '../data/bridge';

// Метка состояния сессии сенсора + обратный отсчёт (контракт §2.2).
const SESSION_RU: Record<string, string> = {
  WarmingUp: 'прогрев', Active: 'работает', Expiring: 'истекает',
  Expired: 'истёк', Stopped: 'остановлен', Failed: 'сбой', Unknown: '—',
};
function sessionLabel(d: DeviceInfo): string {
  const st = d.sessionState;
  if (!st) return connLabel(d.connection);
  const parts = [SESSION_RU[st] ?? st];
  if (st === 'WarmingUp' && d.warmupEndsAtMs) {
    parts.push(`${Math.max(0, Math.round((d.warmupEndsAtMs - Date.now()) / 60000))} мин`);
  } else if ((st === 'Active' || st === 'Expiring') && d.expiresAtMs) {
    parts.push(`осталось ${Math.max(0, Math.floor((d.expiresAtMs - Date.now()) / 86400000))} дн`);
  }
  return parts.join(' · ');
}
const CONN_RU: Record<string, string> = {
  Streaming: 'поток', Connected: 'связь', Connecting: 'подключение', Disconnected: 'нет связи', Error: 'ошибка',
};
function connLabel(c: string): string { return CONN_RU[c] ?? c; }
// Единый статус источника (ядро) → человекочитаемо. Приоритет над connLabel.
const STATUS_RU: Record<string, string> = {
  Disconnected: 'нет связи', Connecting: 'подключаюсь…', Acquiring: 'получаю данные…', Live: 'на связи', Delayed: 'задержка',
};
function statusText(d: DeviceInfo): string {
  const s = d.status;
  return (s && STATUS_RU[s]) ? STATUS_RU[s] : connLabel(d.connection);
}
// Идёт захват BLE (крутим спиннер) vs догрузка истории.
function isCapturing(d: DeviceInfo): boolean { return d.status === 'Connecting' || (!d.status && d.connection === 'Connecting'); }
function isBusy(d: DeviceInfo): boolean { return isCapturing(d) || d.status === 'Acquiring'; }
// BLE-устройство (не облачный Nightscout): только для него осмыслены авто-подключение и «Отмена/Пауза».
function isBleDevice(d: DeviceInfo): boolean { return !(d.id === 'nightscout' || d.id.startsWith('ns-')); }
import {
  PUMPS, SENSORS, BRIDGES, pumpById, sensorById, bridgeById,
  isCurrentPump, pumpBrand, pumpNeedsBridge,
} from '../data/catalog';
import CatalogPicker, { type PickerItem } from './CatalogPicker';
import DeviceScanSheet from './DeviceScanSheet';

export type DeviceCatKey = 'sensor' | 'pump' | 'meter' | 'loop';

const pumpItems: PickerItem[] = PUMPS
  .map((p) => ({ id: p.id, title: p.model, subtitle: pumpBrand(p), meta: p.reservoir || '', current: isCurrentPump(p) }))
  .sort((a, b) => Number(b.current) - Number(a.current) || a.subtitle!.localeCompare(b.subtitle!) || a.title.localeCompare(b.title));
const sensorItems: PickerItem[] = SENSORS
  .map((s) => ({ id: s.id, title: s.name, subtitle: s.brand, meta: s.needsBridge ? 'нужен мост' : '', current: s.current }))
  .sort((a, b) => Number(b.current) - Number(a.current) || a.title.localeCompare(b.title));
const bridgeItems: PickerItem[] = BRIDGES.map((b) => ({ id: b.id, title: b.name, subtitle: b.forWhat, current: true }));

/* Общий каркас карточки устройства: вкладка «Устройство» (модель + путь подключения) и,
   если у категории бывает посредник, вкладка «Мост» (трансмиттер/RileyLink). Реального
   BLE ещё нет — честно: сейчас всё «через Nightscout», прямое подключение = заглушка. */
export default function DeviceSheet({ isOpen, onClose, cat, title }: {
  isOpen: boolean; onClose: () => void; cat: DeviceCatKey; title: string;
}) {
  const cfg = useDeviceConfig();
  const [tab, setTab] = useState<'device' | 'bridge'>('device');
  const [pick, setPick] = useState<null | 'model' | 'bridge'>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const hasModel = cat === 'sensor' || cat === 'pump';
  const hasBridge = cat === 'sensor' || cat === 'pump';

  // реальное BLE-подключение показываем ТОЛЬКО когда мост действительно предлагает
  // драйвер для этой категории (прямой или через мост) — иначе секции нет вообще
  const snap = useSnapshot();
  const connected = (snap?.devices ?? []).filter((d) => d.kind === cat);
  const drivers = snap?.availableDrivers ?? [];
  const driverKind = (id: string) => drivers.find((d) => d.id === id)?.kind;
  const hasBleDriver = hasModel && drivers.some((d) => d.kind === cat || (d.providesTransportFor ?? []).some((t) => driverKind(t) === cat));

  // выбранная модель
  const pump = cat === 'pump' ? pumpById(cfg.pumpId) : null;
  const sensor = cat === 'sensor' ? sensorById(cfg.sensorId) : null;
  const modelName = cat === 'pump' ? pump?.model : cat === 'sensor' ? sensor?.name : null;

  // выбранный мост
  const bridgeId = cat === 'pump' ? cfg.bridgePumpId : cat === 'sensor' ? cfg.bridgeSensorId : null;
  const bridge = bridgeById(bridgeId);

  // подсказка про мост
  const bridgeHint = cat === 'pump'
    ? (pumpNeedsBridge(pump) ? 'Эта помпа управляется по радио — нужен мост (RileyLink/OrangeLink).' : 'Старые Medtronic (Paradigm, 5xx/7xx) — по радио, требуют RileyLink/OrangeLink. Современные — напрямую/через аплоадер.')
    : (sensor?.needsBridge ? 'Этот сенсор не вещает BLE сам — нужен мост (MiaoMiao/Bubble).' : 'Libre 1 и старые сенсоры подключаются через мост (MiaoMiao/Bubble). Современные — напрямую.');

  const modelIcon = cat === 'pump' ? flash : hardwareChipOutline;
  const setModel = (id: string) => setDeviceConfig(cat === 'pump' ? { pumpId: id } : { sensorId: id });
  const setBridge = (id: string) => setDeviceConfig(cat === 'pump' ? { bridgePumpId: id } : { bridgeSensorId: id });
  const modelItems = cat === 'pump' ? pumpItems : sensorItems;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={() => { setTab('device'); onClose(); }} initialBreakpoint={0.7} breakpoints={[0, 0.7, 1]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">{title}</div>
            <div className="sheet-subtitle">Устройство</div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Закрыть"><IonIcon icon={closeOutline} /></button>
        </div>

        {hasBridge && (
          <div className="dev-seg">
            <button className={'dev-seg-btn' + (tab === 'device' ? ' on' : '')} onClick={() => setTab('device')}>Устройство</button>
            <button className={'dev-seg-btn' + (tab === 'bridge' ? ' on' : '')} onClick={() => setTab('bridge')}>Мост</button>
          </div>
        )}

        {tab === 'device' && (
          <>
            {hasModel ? (
              <div className="list">
                <button className="list-row" onClick={() => setPick('model')}>
                  <IonIcon icon={modelIcon} className="list-ico" />
                  <span className="list-title">Модель</span>
                  <span className={'list-value' + (modelName ? '' : ' muted')}>{modelName || 'выбрать'}</span>
                  <IonIcon icon={chevronForward} className="list-chev" />
                </button>
                <div className="list-row" style={{ cursor: 'default' }}>
                  <IonIcon icon={cloudOutline} className="list-ico" />
                  <span className="list-title">Подключение</span>
                  <span className="list-value">через Nightscout</span>
                </div>
              </div>
            ) : (
              <div className="loop-empty">
                <IonIcon icon={cat === 'loop' ? gitNetworkOutline : hardwareChipOutline} />
                <div className="loop-empty-t">{cat === 'loop' ? 'Петля' : 'Глюкометр'}</div>
                <div className="loop-empty-s">{cat === 'loop'
                  ? 'Алгоритм замкнутого цикла (AAPS/Loop/встроенный) и статус — в разработке.'
                  : 'Модель глюкометра и расходники (тест-полоски, ланцеты) — в разработке.'}</div>
              </div>
            )}
            {hasModel && (
              <div className="sheet-note">Модель выше — для учёта, хранится только на этом устройстве.</div>
            )}
            {hasModel && (
              hasBleDriver ? (
                <div className="list" style={{ marginTop: 12 }}>
                  <button className="list-row" onClick={() => setScanOpen(true)}>
                    <IonIcon icon={bluetoothOutline} className="list-ico" />
                    <span className="list-title">Подключить по BLE</span>
                    <IonIcon icon={chevronForward} className="list-chev" />
                  </button>
                </div>
              ) : (
                <div className="sheet-note">Прямое подключение по BLE появится, когда будет готов драйвер этого устройства.</div>
              )
            )}

            {connected.length > 0 && (
              <>
                <div className="sheet-note" style={{ marginTop: 12, marginBottom: 4 }}>Подключённые</div>
                <div className="list">
                  {connected.map((d) => {
                    const ble = isBleDevice(d);
                    return (
                      <div key={d.id} style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="list-row" style={{ cursor: 'default' }}>
                          <IonIcon icon={pulseOutline} className="list-ico" />
                          <span className="pick-main">
                            <span className="list-title">
                              {d.name}
                              {d.primary && <span className="badge-primary">основной</span>}
                              {!ble && <span className="pick-sub" style={{ marginLeft: 6 }}>облако</span>}
                            </span>
                            <span className="pick-sub">{sessionLabel(d)}</span>
                          </span>
                          <span className="list-value" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {isBusy(d) && <IonSpinner name="crescent" style={{ width: 14, height: 14 }} />}
                            {statusText(d)}
                          </span>
                          {/* Управление «сейчас» — только для BLE (облако восстанавливается само). */}
                          {ble && (
                            <button
                              onClick={() => void sendIntent(d.connection === 'Disconnected'
                                ? { type: 'connect', deviceId: d.id }
                                : { type: 'disconnect', deviceId: d.id })}
                              style={{ marginLeft: 8, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--line2, #3a3d50)', background: 'transparent', color: 'inherit', fontSize: 13, fontWeight: 600 }}
                            >
                              {d.connection === 'Disconnected' ? 'Подключить' : (isCapturing(d) ? 'Отмена' : 'Пауза')}
                            </button>
                          )}
                        </div>
                        {/* Авто-подключение на старте — настройка только для BLE (реконнект без ручного ввода). */}
                        {ble && (
                          <div className="list-row" style={{ cursor: 'default', paddingTop: 0, opacity: 0.9 }}>
                            <span className="list-ico" />
                            <span className="pick-main">
                              <span className="list-title" style={{ fontSize: 13 }}>Подключать автоматически</span>
                              <span className="pick-sub">переподключать при запуске приложения</span>
                            </span>
                            <IonToggle
                              checked={d.autoConnect !== false}
                              onIonChange={(e) => void sendIntent({ type: 'setAutoConnect', deviceId: d.id, autoConnect: e.detail.checked })}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {tab === 'bridge' && hasBridge && (
          <>
            <div className="list">
              <button className="list-row" onClick={() => setPick('bridge')}>
                <IonIcon icon={gitNetworkOutline} className="list-ico" />
                <span className="list-title">Мост / трансмиттер</span>
                <span className={'list-value' + (bridge ? '' : ' muted')}>{bridge ? bridge.name : 'нет'}</span>
                <IonIcon icon={chevronForward} className="list-chev" />
              </button>
            </div>
            <div className="sheet-note">{bridgeHint} Подключение моста по BLE — с нативным драйвером (в разработке).</div>
          </>
        )}

        {hasModel && (
          <CatalogPicker
            isOpen={pick === 'model'} onClose={() => setPick(null)}
            title={cat === 'pump' ? 'Выбор помпы' : 'Выбор сенсора'} subtitle="Справочник моделей"
            items={modelItems} selectedId={cat === 'pump' ? cfg.pumpId : cfg.sensorId}
            onSelect={setModel} currentLabel="только актуальные"
          />
        )}
        {hasBridge && (
          <CatalogPicker
            isOpen={pick === 'bridge'} onClose={() => setPick(null)}
            title="Выбор моста" subtitle="Трансмиттер / радио-мост"
            items={bridgeItems} selectedId={bridgeId}
            onSelect={setBridge} currentLabel="только актуальные"
          />
        )}
        {hasModel && hasBleDriver && (cat === 'sensor' || cat === 'pump') && (
          <DeviceScanSheet isOpen={scanOpen} onClose={() => setScanOpen(false)} kind={cat} title={title} />
        )}
      </IonContent>
    </IonModal>
  );
}
