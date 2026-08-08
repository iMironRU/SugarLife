import { IonModal, IonContent, IonIcon } from '@ionic/react';
import { closeOutline, chevronForward, hardwareChipOutline, flash, gitNetworkOutline, cloudOutline, bluetoothOutline, trashOutline, water } from 'ionicons/icons';
import { useState } from 'react';
import { useDeviceConfig, setDeviceConfig, deviceStatus, deviceStatusLabel, forgetDevice, isRecorded, isModelKnown } from '../data/deviceConfig';
import { useSnapshot } from '../data/bridge';
import { useStore } from '../data/store';
import { useDeviceExtras } from '../data/deviceExtras';
import { deviceAges, type Age } from '../data/treatmentStats';
import { fmt } from '../data/units';
import { pumpById, sensorById, bridgeById, pumpNeedsBridge, insulinById } from '../data/catalog';
import CatalogPicker from './CatalogPicker';
import { modelItems, bridgeItems, insulinItems } from './modelItems';
import DeviceScanSheet from './DeviceScanSheet';

export type DeviceCatKey = 'sensor' | 'pump' | 'meter' | 'loop';

const ageText = (a: Age) => (a.days >= 1 ? a.days + ' дн' : a.hours + ' ч');

/* ЕДИНАЯ карточка устройства (docs/CONNECT-UX.md §7): состояние + способ подключения
   в одном месте. Сюда ведут все входы — и «Профиль → Устройства», и плитки на экранах
   «НМГ» и «Инсулин». Раньше рядом жили отдельные SensorSheet/PumpSheet/LoopSheet, и в
   PumpSheet был свой второй выбор модели помпы — теперь этого нет.
   Вкладка «Мост» появляется, только если модель известна (иначе неизвестно, нужен ли он). */
export default function DeviceSheet({ isOpen, onClose, cat, title }: {
  isOpen: boolean; onClose: () => void; cat: DeviceCatKey; title: string;
}) {
  const cfg = useDeviceConfig();
  const { data } = useStore();
  const extras = useDeviceExtras();
  const [rawTab, setTab] = useState<'device' | 'bridge'>('device');
  const [pick, setPick] = useState<null | 'model' | 'bridge' | 'insulin'>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const hasModel = cat === 'sensor' || cat === 'pump';
  // Модель не указана (§2b) — мы не знаем, нужен ли мост и вещает ли железка сама,
  // поэтому ни «Мост», ни BLE не показываем: честно доступно только облако.
  const modelId = cat === 'pump' ? cfg.pumpId : cat === 'sensor' ? cfg.sensorId : null;
  const modelKnown = isModelKnown(modelId);
  const recordedNoModel = hasModel && isRecorded(modelId) && !modelKnown;
  const hasBridge = (cat === 'sensor' || cat === 'pump') && modelKnown;
  // вкладки «Мост» может не быть (модель неизвестна) — тогда всегда показываем «Устройство»,
  // иначе шторка осталась бы пустой
  const tab = hasBridge ? rawTab : 'device';

  // реальное BLE-подключение показываем ТОЛЬКО когда мост действительно предлагает
  // драйвер для этой категории (прямой или через мост) — иначе секции нет вообще
  const snap = useSnapshot();
  const drivers = snap?.availableDrivers ?? [];
  const driverKind = (id: string) => drivers.find((d) => d.id === id)?.kind;
  const hasBleDriver = modelKnown && drivers.some((d) => d.kind === cat || (d.providesTransportFor ?? []).some((t) => driverKind(t) === cat));

  // выбранная модель
  const pump = cat === 'pump' ? pumpById(cfg.pumpId) : null;
  const sensor = cat === 'sensor' ? sensorById(cfg.sensorId) : null;
  const modelName = recordedNoModel ? 'не указана'
    : cat === 'pump' ? pump?.model : cat === 'sensor' ? sensor?.name : null;

  // выбранный мост
  const bridgeId = cat === 'pump' ? cfg.bridgePumpId : cat === 'sensor' ? cfg.bridgeSensorId : null;
  const bridge = bridgeById(bridgeId);

  // подсказка про мост
  const bridgeHint = cat === 'pump'
    ? (pumpNeedsBridge(pump) ? 'Эта помпа управляется по радио — нужен мост (RileyLink/OrangeLink).' : 'Старые Medtronic (Paradigm, 5xx/7xx) — по радио, требуют RileyLink/OrangeLink. Современные — напрямую/через аплоадер.')
    : (sensor?.needsBridge ? 'Этот сенсор не вещает BLE сам — нужен мост (MiaoMiao/Bubble).' : 'Libre 1 и старые сенсоры подключаются через мост (MiaoMiao/Bubble). Современные — напрямую.');

  /* --- Состояние: то, что реально известно прямо сейчас (было в SensorSheet/PumpSheet) --- */
  const dev = data?.device ?? null;
  const ages = deviceAges(extras.events);
  const insulin = insulinById(cfg.fastInsulinId);

  type Row = { k: string; v: string };
  const stateRows: Row[] = [];
  if (cat === 'sensor' && ages.sensor) {
    stateRows.push({ k: 'День', v: String(ages.sensor.days + 1) });
    stateRows.push({ k: 'Носится', v: ageText(ages.sensor) });
  }
  if (cat === 'pump') {
    if (dev?.status) stateRows.push({ k: 'Статус', v: dev.status });
    if (dev?.reservoir != null) stateRows.push({ k: 'Резервуар', v: Math.round(dev.reservoir) + ' ед' });
    if (dev?.pumpBattery != null) stateRows.push({ k: 'Батарея', v: dev.pumpBattery + '%' });
    if (dev?.baseBasal != null) stateRows.push({ k: 'Базальная скорость', v: fmt(dev.baseBasal) + ' ед/ч' });
    if (dev?.tempRate != null) stateRows.push({ k: 'Временный базал', v: fmt(dev.tempRate) + ' ед/ч' });
    if (dev?.lastBolus != null) stateRows.push({ k: 'Последний болюс', v: fmt(dev.lastBolus) + ' ед' });
  }
  // расходники со сроками (§9) — пока только у помпы, из событий замен в Nightscout
  const supplies = cat === 'pump'
    ? ([['Канюля', ages.site], ['Резервуар', ages.reservoir], ['Батарея', ages.battery]] as [string, Age | null][])
      .filter(([, a]) => !!a)
    : [];

  const modelIcon = cat === 'pump' ? flash : hardwareChipOutline;
  const setModel = (id: string) => setDeviceConfig(cat === 'pump' ? { pumpId: id } : { sensorId: id });
  const setBridge = (id: string) => setDeviceConfig(cat === 'pump' ? { bridgePumpId: id } : { bridgeSensorId: id });
  const pickerItems = hasModel ? modelItems(cat as 'pump' | 'sensor') : [];

  // реестр (docs/CONNECT-UX.md §2a): статус записи — только для категорий с моделью
  const status = (cat === 'sensor' || cat === 'pump') ? deviceStatus(cat, cfg) : null;

  // «Забираем через Nightscout» (§2b) — честная строка того, что реально приходит
  const nsFeed = cat === 'pump'
    ? ([dev?.reservoir != null ? Math.round(dev.reservoir) + ' ед' : null,
        dev?.pumpBattery != null ? dev.pumpBattery + '%' : null].filter(Boolean).join(' · ') || null)
    : cat === 'sensor' ? (data?.latest ? 'сахар и тренд' : null)
    : null;

  const onForget = () => {
    if (cat !== 'sensor' && cat !== 'pump') return;
    if (!window.confirm(`Забыть ${title.toLowerCase()}? Модель и мост нужно будет выбрать заново.`)) return;
    forgetDevice(cat);
    onClose();
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={() => { setTab('device'); onClose(); }} initialBreakpoint={0.7} breakpoints={[0, 0.7, 1]} handle>
      <IonContent className="sheet">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">{title}</div>
            <div className="sheet-subtitle">{status ? deviceStatusLabel(status) : 'Устройство'}</div>
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
            {/* Состояние — только то, что реально знаем; пустых строк не рисуем */}
            {stateRows.length > 0 && (
              <div className="basal-rows">
                {stateRows.map((r) => (
                  <div key={r.k} className="basal-row"><span>{r.k}</span><b>{r.v}</b></div>
                ))}
              </div>
            )}
            {supplies.length > 0 && (
              <>
                <div className="section-label sec">Расходники</div>
                <div className="sensor-ages sensor-ages-solo">
                  {supplies.map(([name, a]) => (
                    <div key={name} className="age-pill"><span>{name}</span><b>{ageText(a!)}</b></div>
                  ))}
                </div>
              </>
            )}

            {hasModel ? (
              <div className="list">
                <button className="list-row" onClick={() => setPick('model')}>
                  <IonIcon icon={modelIcon} className="list-ico" />
                  <span className="list-title">Модель</span>
                  <span className={'list-value' + (modelName ? '' : ' muted')}>{modelName || 'выбрать'}</span>
                  <IonIcon icon={chevronForward} className="list-chev" />
                </button>
                {cat === 'pump' && (
                  <button className="list-row" onClick={() => setPick('insulin')}>
                    <IonIcon icon={water} className="list-ico" />
                    <span className="list-title">Инсулин</span>
                    <span className={'list-value' + (insulin ? '' : ' muted')}>{insulin ? insulin.name : 'выбрать'}</span>
                    <IonIcon icon={chevronForward} className="list-chev" />
                  </button>
                )}
                <div className="list-row" style={{ cursor: 'default' }}>
                  <IonIcon icon={cloudOutline} className="list-ico" />
                  <span className="list-title">Через Nightscout</span>
                  <span className={'list-value' + (nsFeed ? '' : ' muted')}>{nsFeed ?? 'пока нет данных'}</span>
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
              <div className="sheet-note">
                {cat === 'pump' && 'В помпе один быстрый инсулин — он идёт и на базал, и на болюс. '}
                Модель выше — для учёта, хранится только на этом устройстве. Nightscout — способ
                получать данные удалённо: работает уже сейчас, даже без прямого моста, вместе с ним,
                а не вместо.
              </div>
            )}
            {recordedNoModel && (
              <div className="sheet-note">
                Модель не указана — поэтому доступно только облако. Мы не знаем, нужен ли этой
                железке мост или она вещает сама. Укажите модель, когда захотите перейти
                с Nightscout на прямое чтение — данные при этом не потеряются.
              </div>
            )}
            {hasModel && !recordedNoModel && (
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
            {hasModel && modelName && (
              <button className="sheet-danger" onClick={onForget}>
                <IonIcon icon={trashOutline} />
                Забыть устройство
              </button>
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
            items={pickerItems} selectedId={cat === 'pump' ? cfg.pumpId : cfg.sensorId}
            onSelect={setModel} currentLabel="только актуальные"
          />
        )}
        {cat === 'pump' && (
          <CatalogPicker
            isOpen={pick === 'insulin'} onClose={() => setPick(null)}
            title="Выбор инсулина" subtitle="Быстрый инсулин для помпы"
            items={insulinItems} selectedId={cfg.fastInsulinId}
            onSelect={(id) => setDeviceConfig({ fastInsulinId: id })}
            currentLabel="только актуальные быстрые"
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
