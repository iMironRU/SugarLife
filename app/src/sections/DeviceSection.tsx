import { IonIcon, IonToggle } from '@ionic/react';
import { BasalProfileSection } from '@/sections/lazy';
import Row from '@/ui/Row';
import Section from '@/ui/Section';
import { chevronForward, batteryHalfOutline, hardwareChipOutline, flash, gitNetworkOutline, cloudOutline, bluetoothOutline, createOutline, pulseOutline, trashOutline, water } from 'ionicons/icons';
import { useState, useMemo } from 'react';
import { useDeviceConfig, setDeviceConfig, setParam, deviceStatus, deviceStatusLabel, forgetDevice, isRecorded, isModelKnown } from '@/settings/deviceConfig';
import ParamsForm from '@/ui/ParamsForm';
import { pumpSpec, missingParams } from '@/domain/driverParams';
import { BATTERY_KINDS, batteryKindName, type BatteryKind } from '@/domain/battery';
import { связь, меткаСвязи, предложениеСлияния, своиЖелезки, черезЧто, СЛОВО_КАНАЛА } from '@/domain/deviceState';
import { мостСлота } from '@/domain/slotStatus';
import { устройствоДляПараметров, значенияПараметров } from '@/domain/deviceParams';
import { useSnapshot, sendIntent, type DeviceView } from '@/sources/bridge';

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

/* Заголовок строки канала — тот же словарь, что и везде (domain/deviceState.ts), с
   заглавной. Свой словарь здесь уже был, и он разошёлся с остальным приложением:
   в списке каналов писалось «Через облако», а человеку нужно знать, через какое. */
const сЗаглавной = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  /* Мост спрашиваем у снимка, локальный выбор оставляем запасным (#281, шаг 2).

     Движок знает, за каким мостом стоит железка, — он это видит, а не помнит с наших
     слов. Наш `bridgePumpId` был нужен, пока спросить было некого; теперь он отвечает
     только там, где движка нет вовсе (браузер) или он ещё не опознал прибор.

     Показываем при этом РАЗНОЕ по смыслу: движок отдаёт экземпляр моста, который реально
     обслуживает прибор, а локальный выбор — модель моста из справочника, которую человек
     назвал. Совпадать они обязаны, но первый вернее. */
  const мостИзСнимка = (cat === 'pump' || cat === 'sensor') ? мостСлота(snap, cat) : null;
  const bridgeId = cat === 'pump' ? cfg.bridgePumpId : cat === 'sensor' ? cfg.bridgeSensorId : null;
  const bridge = bridgeById(bridgeId);
  const имяМоста = мостИзСнимка?.name || bridge?.name || null;

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
  /* Параметры драйвера: спрашиваем движок, пишем движку — и только в браузере себе
     (#224, domain/deviceParams.ts). Серийник нужен драйверу, а не нам: осевший в
     localStorage, он не поможет прочитать помпу по радио, но человек будет уверен,
     что ввёл его. */
  const адресат = устройствоДляПараметров(snap, cat);
  const params = значенияПараметров(адресат, cfg.deviceParams[cat] ?? {});
  const записатьПараметр = (k: string, v: string) => {
    if (адресат) void sendIntent({ type: 'setParams', deviceId: адресат.id, params: { ...params, [k]: v } });
    else setParam(cat, k, v);
  };
  const paramsMissing = missingParams(spec, params);

  /* Телеметрия моста — то, что мост рассказывает о себе сам. Это НЕ настройки:
     у OrangeLink и MiaoMiao пользовательских параметров нет вовсе, а заряд, прошивка и
     RSSI есть. Пока натива нет, единственный реальный источник — Nightscout: AAPS кладёт
     заряд OrangeLink в pump.extended.OrangeLinkBattery. Чего не знаем — не рисуем. */
  /* Мост как устройство в снимке движка (SugarLifeCore#8, инкремент 1 приехал).
     Берём мост ЭТОГО слота (domain/slotStatus.ts): у железки есть ссылка behindBridgeId,
     и по ней видно, кто её обслуживает. Прежде брали первый мост из снимка — пока мост
     один, разницы нет, а с двумя карточка сенсора показала бы заряд помпиного моста, и
     человек менял бы батарейку не в том приборе (#224).

     Поиск по ролям оставлен запасным для старых сборок: без него на прежней сборке блок
     «Мост» исчез бы целиком. */
  const bleМост = (cat === 'pump' || cat === 'sensor' ? мостСлота(snap, cat) : null)
    ?? (snap?.devices ?? []).find((d) => d.roles?.includes('Transport') || d.roles?.includes('Bridge'))
    ?? null;

  /* Телеметрия: сначала то, что мост рассказал о себе сам, потом то, что дошло через
     Nightscout. Порядок не вкусовой — прямое чтение живёт своей жизнью и не зависит
     от того, считал ли цикл; заряд из AAPS приходит только вместе с расчётом и при
     молчащем цикле пропадает вместе с ним. Чего не знаем — не рисуем: пустая строка
     «Прошивка —» выглядит как поломка, а не как отсутствие данных. */
  const bridgeTelemetry: { k: string; v: string }[] = [];
  const зарядМоста = bleМост?.batteryPct ?? (bridge ? dev?.mountBattery ?? null : null);
  if (зарядМоста != null) bridgeTelemetry.push({ k: 'Заряд моста', v: зарядМоста + '%' });
  if (bleМост?.firmware) bridgeTelemetry.push({ k: 'Прошивка', v: bleМост.firmware });
  /* RSSI в дБм — отрицательное число, и меньше значит хуже. Человеку это ни о чём не
     говорит, поэтому рядом со значением пишем словом. Пороги грубые и намеренно
     такие: точность тут не нужна, нужен ответ «стоит ли переложить телефон ближе». */
  if (bleМост?.rssi != null) {
    const r = bleМост.rssi;
    bridgeTelemetry.push({ k: 'Сигнал', v: `${r} дБм · ${r >= -70 ? 'хороший' : r >= -85 ? 'средний' : 'слабый'}` });
  }
  /* Что стоит за мостом — по ссылке от устройства, а не по нашим догадкам. Связь
     направлена от железки к мосту: мост может обслуживать несколько устройств, и
     «мост знает свою помпу» было бы неправдой. */
  const заМостом = bleМост
    ? (snap?.devices ?? []).filter((d) => d.behindBridgeId === bleМост.id).map((d) => d.name).join(', ')
    : '';
  const [проверка, setПроверка] = useState<'нет' | 'идёт' | 'принято' | 'ошибка'>('нет');
  const alert = useBridgeAlert();

  const modelIcon = cat === 'pump' ? flash : hardwareChipOutline;
  /* Выбор модели уходит и в движок (SugarLife#281, шаг 2).

     Пока пишем в оба места: локально — как было, и в инвентарь движка интентом
     recordDevice. Это переходное состояние и оно намеренное: сначала запись должна
     появиться у них и пережить перезапуск, и только потом можно убирать нашу. Убрать
     раньше значит на один релиз остаться вообще без реестра, если что-то не сойдётся.

     driverType — ключ ДРАЙВЕРА из нашего справочника (`driverKey`), а не id модели: у
     движка драйвер один на семейство («medtronic»), а моделей в семействе десяток.
     Модель кладём в params под своим ключом — она нужна нам для резервуара и
     спецификаций, движку она безразлична.

     Модели без драйвера (только облако) записываются с driverType = null: прибор всё
     равно существует, просто читать его напрямую нечем. */
  const setModel = (id: string) => {
    setDeviceConfig(cat === 'pump' ? { pumpId: id } : { sensorId: id });
    if (cat !== 'pump' && cat !== 'sensor') return;
    const модель = cat === 'pump' ? pumpById(id) : sensorById(id);
    void sendIntent({
      type: 'recordDevice',
      kind: cat,
      driverType: модель?.driverKey ?? null,
      params: {
        /* Ключ без нашего префикса хранилища намеренно: `sl.` у нас зарезервирован за
           localStorage, и барьер полноты ключей (settings/reset.test.ts) справедливо
           принял бы его за забытую запись. Это параметр драйвера, а не наша память. */
        clientModel: id,
        name: (cat === 'pump' ? pumpById(id)?.model : sensorById(id)?.name) ?? '',
      },
    });
  };
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
  /* Живость — по общему правилу (domain/deviceState.ts), а не по линку на месте.
     Здесь и на «Сегодня» это должен быть один и тот же ответ: расхождение экранов
     ровно с такой самодельной проверки и начиналось (SugarLifeCore#19). Разница не
     косметическая: Connected при Acquiring — связь есть, показаний нет. */
  const bleLive = связь(ble) === 'live';
  /* Что мост рассказывает о себе сам (1.7). Чего не прислал — не рисуем: пустая
     строка «Последнее показание —» хуже отсутствующей, она выглядит как поломка. */
  /* Кандидаты в основной источник — те, кто отдаёт глюкозу. Роль берём из снимка, а
     не гадаем по виду устройства: помпа тоже kind-устройство, но сахар не отдаёт. */
  const источникиГлюкозы = (snap?.devices ?? []).filter(
    (d) => d.kind === 'sensor' || (d.roles ?? []).includes('GlucoseSource'),
  );

  /* Спрашивать ли про слияние каналов. Отказ живёт до закрытия экрана и не пишется
     в настройки намеренно: «нет» здесь значит «не сейчас», а не «никогда». Записать
     его навсегда — значит закрыть человеку путь, когда он купит второй мост или
     разберётся, чья это помпа в облаке; а движок, получив серийник, сольёт их сам. */
  const [спрашивать, setСпрашивать] = useState(true);
  const слияние = cat === 'pump' && спрашивать ? предложениеСлияния(snap) : null;

  const bleStatus = sourceStatusLabel(ble?.status);
  /* Через что пришло это состояние (SugarLifeCore#34). Без него «на связи» отвечает
     только на половину вопроса, и вторая половина — та, из-за которой чинят не то. */
  const bleКанал = черезЧто(ble);
  const bleAge = ble?.latestAtMs != null ? agoText(ble.latestAtMs) : null;

  const activeMeth: 'direct' | 'cloud' | null = bleLive ? 'direct' : nsFeed ? 'cloud' : null;
  const needsBridge = cat === 'pump' ? pumpNeedsBridge(pump) : !!sensor?.needsBridge;

  // Порядок условий = порядок препятствий: без модели не знаем даже, что искать;
  // в браузере BLE нет как класса; дальше — мост и наличие драйвера.
  const directSub =
    recordedNoModel ? 'сначала укажите модель — иначе неизвестно, как читать'
    : !isNative ? 'только в приложении для телефона — браузер не умеет BLE'
    : needsBridge && !имяМоста ? 'нужен мост — выбрать'
    : !hasBleDriver ? 'драйвер этого устройства ещё в разработке'
    : bleLive ? 'подключено' : 'подключить';
  const directTap =
    recordedNoModel ? () => setPick('model')
    : !isNative ? undefined
    : needsBridge && !имяМоста ? () => setPick('bridge')
    : hasBleDriver ? () => setScanOpen(true)
    : undefined;

  /* «Забыть» должно доходить до движка, а не только до нашего конфига.

     Симптом с железа (SugarLifeCore#26): два Sibionics на один сенсор, «забыть» не
     убирает — карточка возвращается. Мы чистили локальный реестр моделей, а запись в
     базе движка оставалась и восстанавливалась на старте. Для человека это выглядит
     как «кнопка не работает», и он жмёт её снова и снова.

     Убираем ВСЕ устройства этого вида, а не только то, что показано в карточке.
     Ровно в этом суть находки ядра: живые инстансы одного сенсора движок сливает по
     MAC, а мёртвый старый bleId не сольётся никогда — он не подключается, резолвить
     нечего. Убрать его может только «забыть», и если убрать одно из двух, второе
     останется висеть, а человек будет думать, что забыл.

     Облачные источники не трогаем. На нативе облачный поток приезжает с тем же kind
     (движок метит вид по ролям), и «забыть свою помпу» снесло бы заодно приём данных
     о ней из Nightscout — то есть выключило бы мониторинг вместо удаления записи. */
  const [неЗабылось, setНеЗабылось] = useState<string | null>(null);

  const onForget = async () => {
    if (cat !== 'sensor' && cat !== 'pump') return;
    const свои = своиЖелезки(snap, cat);
    const хвост = свои.length > 1 ? ` Записей в движке: ${свои.length} — уберём все.` : '';
    if (!window.confirm(`Забыть ${title.toLowerCase()}? Модель и мост нужно будет выбрать заново.${хвост}`)) return;

    const отказ: string[] = [];
    for (const d of свои) {
      const r = await sendIntent({ type: 'removeDevice', deviceId: d.id });
      if (!r.accepted) отказ.push(d.name || d.id);
    }
    /* Движок отказал — локальный конфиг не трогаем и не закрываемся. Иначе получилось
       бы худшее из двух: модель забыта, а карточка вернётся при следующем запуске, и
       связать одно с другим человек уже не сможет. */
    if (отказ.length) { setНеЗабылось(отказ.join(', ')); return; }

    forgetDevice(cat);
    onClose();
  };

  return (
    <Section title={title} subtitle={status ? deviceStatusLabel(status) : 'Устройство'} onBack={onClose}>

        <>
            {/* Вопрос про слияние — до всего остального: пока он не решён, экран ниже
                показывает одну помпу дважды, и это первое, что стоит объяснить.

                Утверждения тут нет: показываем строку, которой назвался источник в
                Nightscout, и модель с серийником своей помпы — и спрашиваем. Сказать
                за человека «похоже, это одна и та же» было бы догадкой по соседству
                в списке, а цена ошибки — два разных устройства, слитые в одно
                (общий Nightscout в семье, вторая помпа в доме). Правило, когда
                спрашивать вообще, — в domain/deviceState.ts. */}
            {слияние && (
              <div className="today-alert">
                <IonIcon icon={cloudOutline} />
                <div>
                  <b>Это ваша помпа?</b>
                  <span>
                    Nightscout сообщает устройство «{слияние.облако.sourceLabel}».
                    У вас записана {слияние.железка.name}
                    {слияние.серийник ? ` (SN ${слияние.серийник})` : ''}. Серийник не
                    совпал, поэтому сами не объединяем. Если это она — состояние будет
                    одной карточкой с двумя каналами вместо двух помп в списке.
                  </span>
                  <span className="alert-ask alert-ask-row">
                    <button className="changed-btn is-undo" onClick={() => {
                      sendIntent({ type: 'mapChannel', channelId: слияние.облако.id, deviceId: слияние.железка.id });
                      setСпрашивать(false);
                    }}>Да, это она</button>
                    <button className="changed-btn" onClick={() => setСпрашивать(false)}>Нет</button>
                  </span>
                </div>
              </div>
            )}

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
                        {/* Имя из снимка вернее выбранного: движок видит, какой мост
                            реально обслуживает прибор, а справочник помнит, какой
                            назвали (#281). */}
                        <span className="pick-sub">{имяМоста ?? 'не выбран'}</span>
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

                  {/* Только у сенсора (#163). Ручной ввод не заменяет остальные способы, а
                      дополняет: показание с пальца отвечает на вопрос «сенсор не врёт?», и
                      данными самого сенсора на него не ответить.

                      На карточке помпы этой строки быть не должно, а она там была: нажатие
                      затемняло экран и открывало шторку «Показание глюкометра». Снаружи это
                      читается не как «не туда нажал», а как «приложение сломалось» — и
                      дальше человек перестаёт трогать соседние кнопки тоже. */}
                  {cat === 'sensor' && (
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
                  )}
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
                  onChange={записатьПараметр} />
                <div className="sheet-note">
                  {paramsMissing.length
                    ? 'Без этого прямое чтение по радио не заработает: ' + paramsMissing.map((p) => p.title.toLowerCase()).join(', ') + '.'
                    : 'Понадобится приложению для чтения помпы по радио. Через Nightscout данные идут и без этого.'}
                </div>
              </>
            )}

            {/* Основной источник глюкозы. Показываем ТОЛЬКО когда источников больше
                одного: при единственном сенсоре выбор бессмысленен, а список из одной
                строки с отметкой «сейчас» — это интерфейс ради интерфейса.

                Отмечаем тот, у кого primary в снимке, а не тот, что мы отправили:
                интент подтверждает приём, а не результат, и рисовать выбор по своему
                намерению значит однажды показать не то, что происходит на деле
                (SugarLifeCore#14). */}
            {cat === 'sensor' && источникиГлюкозы.length > 1 && (
              <>
                <div className="section-label sec">Основной источник</div>
                <div className="list">
                  {источникиГлюкозы.map((d) => (
                    <button key={d.id} className="list-row"
                      onClick={() => sendIntent({ type: 'setPrimarySource', sourceId: d.id })}>
                      <span className="pick-main">
                        <span className="list-title">{d.name}</span>
                        <span className="pick-sub">{sourceStatusLabel(d.status) ?? 'источник глюкозы'}</span>
                      </span>
                      {d.primary && <span className="meth-now">сейчас</span>}
                    </button>
                  ))}
                  <button className="list-row" onClick={() => sendIntent({ type: 'setPrimarySource', sourceId: null })}>
                    <span className="pick-main">
                      <span className="list-title">Автоматически</span>
                      <span className="pick-sub">приложение выберет само и переключится, когда датчик кончится</span>
                    </span>
                    {!источникиГлюкозы.some((d) => d.primary) && <span className="meth-now">сейчас</span>}
                  </button>
                </div>
                <div className="sheet-note">
                  Отсюда берётся сахар в круге наверху. Выбор переживает перезапуск; если
                  выбранный датчик пропадёт, приложение вернётся к автоматическому.
                </div>
              </>
            )}

            {/* Каналы (SugarLifeCore#23). Одна карточка, каналы списком — потому что
                это одно устройство, до которого мы дотягиваемся двумя дорогами.
                Верхние поля описывают активный канал, и без этого списка непонятно,
                откуда взялось «на связи»: помпа рядом или облако помнит её последний
                документ. Разные факты, и человеку важно, какой из них.

                Рисуем только когда каналов больше одного: у одноканального устройства
                строка «напрямую» ничего не добавляет к тому, что уже сказано выше. */}
            {(ble?.channels?.length ?? 0) > 1 && (
              <>
                <div className="section-label sec">Каналы</div>
                <div className="list">
                  {ble!.channels!.map((c) => {
                    const с = связь(c as unknown as DeviceView);
                    return (
                      <div key={c.id} className="list-row" style={{ cursor: 'default' }}>
                        <IonIcon icon={c.kind === 'cloud' ? cloudOutline : bluetoothOutline} className="list-ico" />
                        <span className="pick-main">
                          <span className="list-title">{сЗаглавной(СЛОВО_КАНАЛА[c.kind])}</span>
                          <span className="pick-sub">
                            {c.label ? c.label + ' · ' : ''}
                            {меткаСвязи[с] ?? 'состояние неизвестно'}
                            {c.latestAtMs != null ? ' · ' + agoText(c.latestAtMs) : ''}
                          </span>
                        </span>
                        {c.id === ble!.activeChannel && <span className="meth-now">сейчас</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="sheet-note">
                  Приложение само берёт тот канал, где данные свежее. Прямая связь
                  предпочтительнее облака, но молчащая прямая уступает живому облаку.
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
                        <b className={sourceStatusWarn(ble.status) ? 'val-warn' : undefined}>
                          {bleStatus}{bleКанал ? ' · ' + bleКанал : ''}
                        </b>
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
                  к помпе за ним{заМостом ? ` (${заМостом})` : ''}.
                  {!bleМост?.firmware && !bleМост?.rssi
                    ? ' Прошивку и уровень сигнала покажем, когда приложение начнёт читать мост напрямую.'
                    : ''}
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
            {/* Отказ движка показываем здесь же, а не всплывающим окном: человек
                остался на карточке, и объяснение должно быть там, где он смотрит. */}
            {неЗабылось && (
              <div className="sheet-note warn">
                Движок не принял удаление ({неЗабылось}). Модель оставили на месте — иначе
                она пропала бы из настроек, а карточка вернулась бы при следующем запуске.
                Попробуйте ещё раз; если повторится, это уже не про настройки.
              </div>
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
    </Section>
  );
}
