import { IonIcon, IonToggle } from '@ionic/react';
import { BasalProfileSection } from '@/sections/lazy';
import Row from '@/ui/Row';
import PageHead from '@/ui/PageHead';
import { chevronForward, batteryHalfOutline, hardwareChipOutline, flash, gitNetworkOutline, cloudOutline, bluetoothOutline, createOutline, pulseOutline, trashOutline, water } from 'ionicons/icons';
import { useState, useMemo } from 'react';
import { useDeviceConfig, setDeviceConfig, setParam, deviceStatus, deviceStatusLabel, forgetDevice, isRecorded, isModelKnown } from '@/settings/deviceConfig';
import ParamsForm from '@/ui/ParamsForm';
import { pumpSpec, missingParams } from '@/domain/driverParams';
import { BATTERY_KINDS, batteryKindName, type BatteryKind } from '@/domain/battery';
import { useSnapshot, sendIntent } from '@/sources/bridge';
import { useBridgeAlert, setBridgeAlert } from '@/settings/bridgeAlerts';
import { sourceStatusLabel, sourceStatusWarn } from '@/domain/sourceStatus';
import { agoText, toUnits, unitLabel } from '@/domain/units';
import { useStore } from '@/sources/store';
import { useChanges, type Consumable } from '@/settings/changes';
import ChangedButton from '@/ui/ChangedButton';
import { useDeviceExtras } from '@/sources/deviceExtras';
import { deviceAges, type Age } from '@/domain/treatmentStats';
import { fmt } from '@/domain/units';
import { Capacitor } from '@capacitor/core';
import { pumpById, sensorById, bridgeById, pumpNeedsBridge, insulinById } from '@/domain/catalog';

// В браузере прямого BLE нет и не будет — это свойство платформы, а не «пока не сделали»
const isNative = Capacitor.isNativePlatform();
import CatalogPicker from '@/sheets/CatalogPicker';
import { modelItems, bridgeItems, insulinItems } from '@/sheets/modelItems';
import DeviceScanSheet from '@/sheets/DeviceScanSheet';
import SmbgSheet from '@/sheets/SmbgSheet';
import { useSmbg } from '@/settings/smbg';
import { useStack } from '@/app/stackCtx';
import { toSegs, daily } from '@/domain/basal';

export type DeviceCatKey = 'sensor' | 'pump' | 'meter' | 'loop';

const ageText = (a: Age) => (a.days >= 1 ? a.days + ' дн' : a.hours + ' ч');

/* ЕДИНАЯ карточка устройства (docs/CONNECT-UX.md §7): состояние + способ подключения
   в одном месте. Сюда ведут все входы — и «Профиль → Устройства», и плитки на экранах
   «НМГ» и «Инсулин». Раньше рядом жили отдельные SensorSheet/PumpSheet/LoopSheet, и в
   PumpSheet был свой второй выбор модели помпы — теперь этого нет.
   Вкладка «Мост» появляется, только если модель известна (иначе неизвестно, нужен ли он). */
export default function DeviceSection({ onClose, cat, title }: {
  onClose: () => void; cat: DeviceCatKey; title: string;
}) {
  const { push, pop } = useStack();
  const cfg = useDeviceConfig();
  const { data } = useStore();
  const extras = useDeviceExtras();
  const changes = useChanges();
  const [pick, setPick] = useState<null | 'model' | 'bridge' | 'insulin' | 'battery'>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [smbgOpen, setSmbgOpen] = useState(false);
  const smbg = useSmbg();
  const последнее = smbg.length ? smbg[smbg.length - 1] : null;

  const hasModel = cat === 'sensor' || cat === 'pump';
  // Модель не указана (§2b) — мы не знаем, нужен ли мост и вещает ли железка сама,
  // поэтому ни «Мост», ни BLE не показываем: честно доступно только облако.
  const modelId = cat === 'pump' ? cfg.pumpId : cat === 'sensor' ? cfg.sensorId : null;
  const modelKnown = isModelKnown(modelId);
  const recordedNoModel = hasModel && isRecorded(modelId) && !modelKnown;
  const hasBridge = (cat === 'sensor' || cat === 'pump') && modelKnown;

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

  /* --- Состояние: то, что реально известно прямо сейчас (было в SensorSheet/PumpSheet) ---
     Считаем ТОЛЬКО когда шторка открыта и только при смене данных. Инстансов
     DeviceSection смонтировано несколько сразу (список устройств + «НМГ» + «Инсулин»),
     а deviceAges проходит по всем событиям замен — без этой памятки закрытые шторки
     молотили бы тысячи проходов на каждое обновление данных. */
  const dev = data?.device ?? null;
  const insulin = insulinById(cfg.fastInsulinId);
  const basalSegs = toSegs(data?.profile?.basalSchedule ?? []);
  const basalTotal = basalSegs.length ? daily(basalSegs) : null;

  const { stateRows, supplies } = useMemo(() => {
    type Row = { k: string; v: string };
    const rows: Row[] = [];

    const ages = deviceAges(extras.events, changes);
    if (cat === 'sensor' && ages.sensor) {
      rows.push({ k: 'День', v: String(ages.sensor.days + 1) });
      rows.push({ k: 'Носится', v: ageText(ages.sensor) });
    }
    if (cat === 'pump') {
      if (dev?.status) rows.push({ k: 'Статус', v: dev.status });
      if (dev?.reservoir != null) rows.push({ k: 'Резервуар', v: Math.round(dev.reservoir) + ' ед' });
      if (dev?.pumpBattery != null) rows.push({ k: 'Батарея', v: dev.pumpBattery + '%' });
      if (dev?.baseBasal != null) rows.push({ k: 'Базальная скорость', v: fmt(dev.baseBasal) + ' ед/ч' });
      if (dev?.tempRate != null) rows.push({ k: 'Временный базал', v: fmt(dev.tempRate) + ' ед/ч' });
      if (dev?.lastBolus != null) rows.push({ k: 'Последний болюс', v: fmt(dev.lastBolus) + ' ед' });
    }
    // расходники со сроками (§9) — пока только у помпы, из событий замен в Nightscout
    /* Расходники со сроками (§9). Ключ рядом с названием — чтобы отметить замену
       прямо здесь: событие в Nightscout может не появиться вовсе (проверено на живых
       данных), и тогда возраст врёт молча. */
    const sup = cat === 'pump'
      ? ([['Канюля', ages.site, 'site'], ['Резервуар', ages.reservoir, 'reservoir'], ['Батарея', ages.battery, 'battery']] as [string, Age | null, Consumable][])
        .filter((x): x is [string, Age, Consumable] => !!x[1])
      : cat === 'sensor'
      ? ([['Датчик', ages.sensor, 'sensor']] as [string, Age | null, Consumable][])
        .filter((x): x is [string, Age, Consumable] => !!x[1])
      : [];
    return { stateRows: rows, supplies: sup };
  }, [cat, extras.events, dev, changes]);

  /* Параметры драйвера (§7a): у радио-Medtronic это серийник и частота 868/916.
     Рисуем универсальной формой по спеке — экрана «настройки такой-то помпы» нет и не будет
     (см. ui/ParamsForm.tsx). Пустая спека = блока просто нет, и это нормальное состояние:
     у современных помп и у всех мостов настраивать нечего. */
  const spec = cat === 'pump' ? pumpSpec(pump) : null;
  const params = cfg.deviceParams[cat] ?? {};
  const paramsMissing = missingParams(spec, params);

  /* Телеметрия моста — то, что мост рассказывает о себе сам. Это НЕ настройки:
     у OrangeLink и MiaoMiao пользовательских параметров нет вовсе, а заряд, прошивка и
     RSSI есть. Пока натива нет, единственный реальный источник — Nightscout: AAPS кладёт
     заряд OrangeLink в pump.extended.OrangeLinkBattery. Чего не знаем — не рисуем. */
  const bridgeTelemetry: { k: string; v: string }[] = [];
  if (bridge && dev?.mountBattery != null) bridgeTelemetry.push({ k: 'Заряд моста', v: dev.mountBattery + '%' });
  /* Мост как устройство в снимке движка (SugarLifeCore#8). Пока его там нет, работаем
     с тем, что даёт Nightscout, — заряд. Появится в снимке: прошивка, сигнал, проверка. */
  const bleМост = (snap?.devices ?? []).find((d) => d.roles?.includes('Transport') || d.roles?.includes('Bridge')) ?? null;
  const [проверка, setПроверка] = useState<'нет' | 'идёт' | 'принято' | 'ошибка'>('нет');
  const alert = useBridgeAlert();

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

  /* --- Способы получения данных (§2b) ---
     Устройство одно, путей к нему несколько. Мост при этом НЕ отдельный путь: нужен
     он или нет — свойство модели, а не выбор человека (Libre 1 не вещает сам, Paradigm
     говорит по радио). Поэтому он живёт внутри «прямого чтения», а не рядом с ним.
     Ручной ввод вынесен из группы: он ничего не исключает, показания глюкометра вносят
     и при живом сенсоре.
     Выбора активного способа здесь намеренно нет — сначала честная картина того, что
     есть; приоритет и резерв при обрыве решаем отдельно. */
  /* Живое устройство из снимка моста — с ним и работаем дальше: у него есть статус,
     возраст показания, подсказка и тумблер авто-подключения (контракт 1.7).
     В браузере его нет вовсе: Nightscout-шим отдаёт только сервис, не железку. */
  const ble = (snap?.devices ?? []).find((d) => d.kind === cat) ?? null;
  const bleLive = ble?.connection === 'Connected' || ble?.connection === 'Streaming';
  /* Что мост рассказывает о себе сам (1.7). Чего не прислал — не рисуем: пустая
     строка «Последнее показание —» хуже отсутствующей, она выглядит как поломка. */
  const bleStatus = sourceStatusLabel(ble?.status);
  const bleAge = ble?.latestAtMs != null ? agoText(ble.latestAtMs) : null;

  const activeMeth: 'direct' | 'cloud' | null = bleLive ? 'direct' : nsFeed ? 'cloud' : null;
  const needsBridge = cat === 'pump' ? pumpNeedsBridge(pump) : !!sensor?.needsBridge;

  // Порядок условий = порядок препятствий: без модели не знаем даже, что искать;
  // в браузере BLE нет как класса; дальше — мост и наличие драйвера.
  const directSub =
    recordedNoModel ? 'сначала укажите модель — иначе неизвестно, как читать'
    : !isNative ? 'только в приложении для телефона — браузер не умеет BLE'
    : needsBridge && !bridge ? 'нужен мост — выбрать'
    : !hasBleDriver ? 'драйвер этого устройства ещё в разработке'
    : bleLive ? 'подключено' : 'подключить';
  const directTap =
    recordedNoModel ? () => setPick('model')
    : !isNative ? undefined
    : needsBridge && !bridge ? () => setPick('bridge')
    : hasBleDriver ? () => setScanOpen(true)
    : undefined;

  const onForget = () => {
    if (cat !== 'sensor' && cat !== 'pump') return;
    if (!window.confirm(`Забыть ${title.toLowerCase()}? Модель и мост нужно будет выбрать заново.`)) return;
    forgetDevice(cat);
    onClose();
  };

  return (
    <div className="sheet stack-body">
        <PageHead title={title} subtitle={status ? deviceStatusLabel(status) : 'Устройство'} onBack={onClose} />

        <>
            {hasModel && (
              <>
                <div className="section-label sec">Как получаем данные</div>
                <div className="list">
                  {/* Прямое чтение. Мост — вложенной строкой, а не соседом: его не выбирают
                      вместо блютуса, он и есть способ добраться до такой железки. */}
                  {directTap ? (
                    <button className={'list-row meth' + (activeMeth === 'direct' ? ' meth-on' : '')} onClick={directTap}>
                      <IonIcon icon={bluetoothOutline} className="list-ico" />
                      <span className="pick-main">
                        <span className="list-title">Прямое чтение</span>
                        <span className="pick-sub">{directSub}</span>
                      </span>
                      {activeMeth === 'direct' && <span className="meth-now">сейчас</span>}
                      <IonIcon icon={chevronForward} className="list-chev" />
                    </button>
                  ) : (
                    <div className="list-row meth" style={{ cursor: 'default' }}>
                      <IonIcon icon={bluetoothOutline} className="list-ico muted" />
                      <span className="pick-main">
                        <span className="list-title muted">Прямое чтение</span>
                        <span className="pick-sub">{directSub}</span>
                      </span>
                    </div>
                  )}
                  {needsBridge && modelKnown && (
                    <button className="list-row meth meth-in" onClick={() => setPick('bridge')}>
                      <IonIcon icon={gitNetworkOutline} className="list-ico" />
                      <span className="pick-main">
                        <span className="list-title">Мост / трансмиттер</span>
                        <span className="pick-sub">{bridge ? bridge.name : 'не выбран'}</span>
                      </span>
                      <IonIcon icon={chevronForward} className="list-chev" />
                    </button>
                  )}

                  {/* Облако. Отсюда в карточку облака не ведём: путь туда уже есть в обратную
                      сторону («Забираем отсюда» → устройство), а взаимные ссылки запутали бы. */}
                  <div className={'list-row meth' + (activeMeth === 'cloud' ? ' meth-on' : '')} style={{ cursor: 'default' }}>
                    <IonIcon icon={cloudOutline} className="list-ico" />
                    <span className="pick-main">
                      <span className="list-title">Через Nightscout</span>
                      <span className="pick-sub">{nsFeed ? 'приходит: ' + nsFeed : 'данных пока нет'}</span>
                    </span>
                    {activeMeth === 'cloud' && <span className="meth-now">сейчас</span>}
                  </div>

                  {/* Ручной ввод не заменяет остальные способы, а дополняет: показание
                      с пальца отвечает на вопрос «сенсор не врёт?», и данными самого
                      сенсора на него не ответить. */}
                  <button className="list-row meth" onClick={() => setSmbgOpen(true)}>
                    <IonIcon icon={createOutline} className="list-ico" />
                    <span className="pick-main">
                      <span className="list-title">Ручной ввод</span>
                      <span className="pick-sub">
                        {последнее
                          ? `последнее: ${toUnits(последнее.mmol)} ${unitLabel()} · ${agoText(последнее.t)}`
                          : 'внести показание глюкометра'}
                      </span>
                    </span>
                    <IonIcon icon={chevronForward} className="list-chev" />
                  </button>
                </div>
                <div className="sheet-note">
                  {needsBridge ? bridgeHint + ' ' : ''}
                  Способы не спорят друг с другом: Nightscout работает вместе с прямым чтением,
                  а не вместо него. Пометка «сейчас» — откуда данные приходят в эту минуту.
                </div>
              </>
            )}
            {hasModel ? (
              <div className="list">
                <Row icon={modelIcon} title="Модель" value={modelName || 'выбрать'}
                  valueMuted={!modelName} onClick={() => setPick('model')} />
                {cat === 'pump' && (
                  <Row icon={water} title="Инсулин" value={insulin ? insulin.name : 'выбрать'}
                    valueMuted={!insulin} onClick={() => setPick('insulin')} />
                )}
                {cat === 'pump' && (
                  /* Тип батарейки — не украшение: процент заряда без него не отвечает
                     на вопрос «успею ли до утра» (domain/battery.ts). */
                  <Row icon={batteryHalfOutline} title="Батарейка"
                    value={batteryKindName(cfg.pumpBatteryKind) ?? 'выбрать'}
                    valueMuted={!cfg.pumpBatteryKind}
                    onClick={() => setPick('battery')} />
                )}
                {cat === 'pump' && (
                  <Row icon={pulseOutline} title="Базальный профиль"
                    value={basalTotal != null ? basalTotal.toFixed(2) + ' ЕД/сут' : 'нет данных'}
                    valueMuted={basalTotal == null}
                    onClick={() => push(<BasalProfileSection onClose={pop} />)} />
                )}
              </div>
            ) : (
              <div className="loop-empty">
                <IonIcon icon={cat === 'loop' ? gitNetworkOutline : hardwareChipOutline} />
                <div className="loop-empty-t">{cat === 'loop' ? 'Петля' : 'Глюкометр'}</div>
                <div className="loop-empty-s">{cat === 'loop'
                  ? 'Алгоритм замкнутого цикла (AAPS/Loop/встроенный) и статус — в разработке.'
                  : 'Модель глюкометра и расходники (тест-полоски, ланцеты) — в разработке. Показания можно вносить уже сейчас.'}</div>
                {cat === 'meter' && (
                  <button className="loop-empty-btn" onClick={() => setSmbgOpen(true)}>Внести показание</button>
                )}
              </div>
            )}
            {recordedNoModel && (
              <div className="sheet-note">
                Пока модель не указана, остаётся только облако: мы не знаем, вещает ли эта
                железка сама или ей нужен мост. Данные при переходе на прямое чтение не потеряются.
              </div>
            )}
            {cat === 'pump' && hasModel && (
              <div className="sheet-note">
                В помпе один быстрый инсулин — он идёт и на базал, и на болюс.
              </div>
            )}

            {spec && modelKnown && (
              <>
                <ParamsForm title="Параметры помпы" spec={spec} values={params}
                  onChange={(k, v) => setParam(cat, k, v)} />
                <div className="sheet-note">
                  {paramsMissing.length
                    ? 'Без этого прямое чтение по радио не заработает: ' + paramsMissing.map((p) => p.title.toLowerCase()).join(', ') + '.'
                    : 'Понадобится приложению для чтения помпы по радио. Через Nightscout данные идут и без этого.'}
                </div>
              </>
            )}

            {ble && (bleStatus || bleAge || ble.note || ble.autoConnect != null) && (
              <>
                <div className="section-label sec">Связь</div>
                {(bleStatus || bleAge) && (
                  <div className="basal-rows">
                    {bleStatus && (
                      <div className="basal-row">
                        <span>Состояние</span>
                        <b className={sourceStatusWarn(ble.status) ? 'val-warn' : undefined}>{bleStatus}</b>
                      </div>
                    )}
                    {bleAge && <div className="basal-row"><span>Последнее показание</span><b>{bleAge}</b></div>}
                  </div>
                )}
                {/* Подсказка от ядра — например, что железку держит другой телефон.
                    Текст пишет движок: он один знает, что именно пошло не так. */}
                {ble.note && <div className="sheet-note warn">{ble.note}</div>}
                {ble.autoConnect != null && (
                  <div className="list">
                    <div className="list-row">
                      <IonIcon icon={bluetoothOutline} className="list-ico" />
                      <span className="pick-main">
                        <span className="list-title">Подключаться автоматически</span>
                        <span className="pick-sub">при запуске приложения</span>
                      </span>
                      <IonToggle checked={ble.autoConnect}
                        onIonChange={(e) => sendIntent({ type: 'setAutoConnect', deviceId: ble.id, autoConnect: e.detail.checked })} />
                    </div>
                  </div>
                )}
              </>
            )}

            {bridgeTelemetry.length > 0 && (
              <>
                <div className="section-label sec">Мост</div>
                <div className="basal-rows">
                  {bridgeTelemetry.map((r) => (
                    <div key={r.k} className="basal-row"><span>{r.k}</span><b>{r.v}</b></div>
                  ))}
                </div>
                {/* «Проверить связь» — единственное действие, которое у моста есть:
                    настраивать в нём нечего, а вот убедиться, что он отвечает, нужно
                    ровно тогда, когда помпа молчит и непонятно, кто виноват. */}
                {bleМост?.testable && (
                  <button className="changed-btn" style={{ marginTop: 10 }}
                    onClick={() => { setПроверка('идёт'); void sendIntent({ type: 'testDevice', deviceId: bleМост.id })
                      .then((r) => setПроверка(r.accepted ? 'принято' : 'ошибка')); }}>
                    {проверка === 'идёт' ? 'Проверяю…' : проверка === 'принято' ? 'Запрос отправлен' : 'Проверить связь'}
                  </button>
                )}

                {/* Порог разрядки — настройка приложения, а не железа: в мосте нет
                    понятия «когда меня беспокоить». Когда его батарейка сядет, помпа
                    просто перестанет отвечать, и человек будет искать поломку там, где
                    её нет (settings/bridgeAlerts.ts). */}
                <div className="list" style={{ marginTop: 10 }}>
                  <div className="list-row">
                    <span className="pick-main">
                      <span className="list-title">Предупредить о разряде</span>
                      <span className="pick-sub">один раз, когда заряд упадёт ниже {alert.threshold}%</span>
                    </span>
                    <IonToggle checked={alert.on} onIonChange={(e) => setBridgeAlert({ on: e.detail.checked })} />
                  </div>
                </div>

                <div className="sheet-note">
                  Настраивать в мосте нечего — это транспорт. Серийник и частота относятся
                  к помпе за ним. Прошивку и уровень сигнала покажем, когда приложение
                  начнёт читать мост напрямую.
                </div>
              </>
            )}

            {/* Состояние — только то, что реально знаем; пустых строк не рисуем.
                Идёт последним: это следствие настройки, а не то, что настраивают. */}
            {stateRows.length > 0 && (
              <>
              <div className="section-label sec">Сейчас на устройстве</div>
              <div className="basal-rows">
                {stateRows.map((r) => (
                  <div key={r.k} className="basal-row"><span>{r.k}</span><b>{r.v}</b></div>
                ))}
              </div>
              </>
            )}
            {supplies.length > 0 && (
              <>
                <div className="section-label sec">Расходники</div>
                <div className="sensor-ages sensor-ages-solo">
                  {supplies.map(([name, a, key]) => (
                    <div key={name} className="age-pill">
                      <span>{name}</span>
                      <b>{ageText(a)}</b>
                      <ChangedButton what={key} />
                    </div>
                  ))}
                </div>
                <div className="sheet-note">
                  Возраст считается по событиям из Nightscout, а их может не быть: замена,
                  не залогированная в AAPS, не оставляет следа вовсе. Поменял — отметь здесь,
                  это никуда не отправляется и живёт только на этом устройстве.
                </div>
              </>
            )}

            {cat === 'meter' && smbg.length > 0 && (
              <>
                <div className="section-label sec">Последние показания</div>
                <div className="basal-rows">
                  {[...smbg].reverse().slice(0, 8).map((x) => (
                    <div key={x.t} className="basal-row">
                      <span>{new Date(x.t).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      <b>{toUnits(x.mmol)} {unitLabel()}</b>
                    </div>
                  ))}
                </div>
                <div className="sheet-note">
                  Эти показания не подмешиваются в ленту сенсора: с пальца точнее по крови,
                  но реже по времени, и в расчётах диапазона вес у них был бы неправильный.
                </div>
              </>
            )}

            {hasModel && modelName && (
              <button className="sheet-danger" onClick={onForget}>
                <IonIcon icon={trashOutline} />
                Забыть устройство
              </button>
            )}
          </>

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
        {cat === 'pump' && (
          <CatalogPicker
            isOpen={pick === 'battery'} onClose={() => setPick(null)}
            title="Батарейка помпы" subtitle="От химии зависит, что значит процент заряда"
            items={BATTERY_KINDS.map((b) => ({ id: b.id, title: b.name, subtitle: b.note, current: true }))}
            selectedId={cfg.pumpBatteryKind}
            onSelect={(id) => setDeviceConfig({ pumpBatteryKind: id as BatteryKind })}
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
        <SmbgSheet isOpen={smbgOpen} onClose={() => setSmbgOpen(false)} />
        {hasModel && hasBleDriver && (cat === 'sensor' || cat === 'pump') && (
          <DeviceScanSheet isOpen={scanOpen} onClose={() => setScanOpen(false)} kind={cat} title={title} />
        )}
    </div>
  );
}
