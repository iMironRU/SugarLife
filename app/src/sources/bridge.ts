/* Контракт интеграции PWA ↔ система. PWA — представление: читает UiSnapshot через мост
   и шлёт Intent. Мост — либо нативный (window.SugarLifeBridge, ставит оболочка/релей),
   либо наш Nightscout-шим (bridgeNightscout) в браузере.
   ВАЖНО: sendIntent подтверждает только ПРИЁМ действия, не выполнение.

   Ревизия 1.7. Это не наш черновик, а слепок канонического контракта ядра
   (SugarLifeCore, docs/bridge-contract-1.7.d.ts) — источник правды там, здесь копия.
   Расхождение обходится дорого, поэтому правило: сначала согласовать в
   docs/CONTRACT-REQUESTS.md, потом менять здесь. Наши три запроса (время расчёта IOB,
   реестр записей, вендор-аккаунты) приняты и войдут в 1.8 аддитивно.

   Имена: каноническое имя проекции устройства — DeviceView; DeviceInfo оставлен
   алиасом, потому что так её звал веб и так она названа в половине наших экранов.
   На проводе имени типа нет, важна структура. */
import { useEffect, useState } from 'react';
import { nightscoutBridge } from './bridgeNightscout';

// ---- UiSnapshot ----
export interface Monitor {
  glucose: string; glucoseMmol: number | null; trend: Trend; link: Link;
  reservoir: string; battery: string;
  confirmedIOB: number; assumedIOB: number; conservativeIOB: number;
  /* rev ≥ 1.7. Единая картина основного источника глюкозы: отдаёт ли он свежее,
     на какой стадии жизненного цикла находится, когда пришло новейшее показание и
     кто он вообще. До этого возраст показания каждый экран считал сам. */
  live?: boolean;
  status?: SourceStatus;
  latestAtMs?: number | null;
  source?: string | null;
  /* rev ≥ 1.8 (принято, SugarLifeCore#1). Когда цикл в последний раз считал IOB.
     Без него три числа выше не умеют сказать «неизвестно», и ноль читается как
     «инсулина нет» — см. domain/loopValue.ts. */
  iobAtMs?: number | null;
}
export type Trend =
  | 'RisingRapidly' | 'Rising' | 'RisingSlowly' | 'Stable'
  | 'FallingSlowly' | 'Falling' | 'FallingRapidly' | 'Unknown' | '—';
export type Link = 'Disconnected' | 'Connecting' | 'Connected' | 'Streaming' | 'Error';
/* rev ≥ 1.7: единый статус ЛЮБОГО источника глюкозы — это жизненный цикл получения
   данных, а не состояние BLE-линка (Link). Сенсор может быть Connected и при этом
   Acquiring: связь есть, показаний ещё нет. */
export type SourceStatus = 'Disconnected' | 'Connecting' | 'Acquiring' | 'Live' | 'Delayed';

export type ParamType = 'Text' | 'Secret' | 'Number' | 'Bool' | 'Enum';
export interface Param {
  key: string; title: string; type: ParamType; required: boolean; default: string | null; options: string[];
  scan?: 'qr' | null; // rev ≥ 1.5+: поле сканируется камерой (кнопка «Сканировать QR»)
  /* Короткая подсказка под полем: «где взять токен с правом записи», «где искать
     серийник на помпе». Текст пишет тот, кто знает железку, — ядро; у нас ноль
     хардкода под конкретный коннектор (SugarLifeCore#16). */
  hint?: string | null;
}
export interface SettingsSpec { parameters: Param[]; }

export type SessionState = 'WarmingUp' | 'Active' | 'Expiring' | 'Expired' | 'Stopped' | 'Failed' | 'Unknown';

/* Проекция устройства — read-only. Каноническое имя DeviceView (так зовётся в движке),
   DeviceInfo — исторический алиас веба, та же сущность. */
export interface DeviceView {
  /* 'bridge' — rev ≥ 1.8 (SugarLifeCore#8): мост стал отдельным устройством, а не
     свойством помпы. Так и есть на самом деле: у OrangeLink свой линк, свой заряд и
     своя прошивка, и когда садится он — молчит помпа. Пока мост был строкой в
     карточке помпы, это выглядело как поломка помпы. */
  id: string; name: string; kind: 'sensor' | 'pump' | 'service' | 'bridge';
  roles: string[];
  /* ТОЛЬКО живой линк. Жизненный цикл записи в реестре (записано / настроено / забыто)
     сюда не помещается и придёт в 1.8 как registryState + driverId (SugarLifeCore#2);
     до тех пор он живёт у нас в settings/deviceConfig.ts. */
  connection: Link | string;
  capabilities: Record<string, string>;
  /* Самоописание параметров драйвера. У мостов (OrangeLink, MiaoMiao) он ПУСТОЙ, и это
     нормальное состояние: транспорту нечего настраивать, серийник и частота помпы
     принадлежат драйверу помпы за мостом (SugarLifeCore#4). Рисуется ui/ParamsForm. */
  settings: SettingsSpec;
  admittedInput: boolean; admittedOutput: boolean; testable: boolean;
  // rev ≥ 1.3: мультисенсор — сессия, тайминги, «основной» источник монитора
  sessionState?: SessionState | null;
  warmupEndsAtMs?: number | null;
  expiresAtMs?: number | null;   // реальный конец (у части сенсоров дольше официального)
  officialEndMs?: number | null; // официальный срок — для «день N из 14»
  primary?: boolean;
  // rev ≥ 1.7
  live?: boolean;
  status?: SourceStatus;
  latestAtMs?: number | null;
  autoConnect?: boolean;
  note?: string | null;          // подсказка, напр. «возможно, занят другим телефоном»
  /* rev ≥ 1.8 (в движке уже есть, SugarLifeCore#2). Жизненный цикл записи в инвентаре —
     ортогонален connection: «записано, но ни разу не подключалось» и «настроено, но мост
     не выбран» в живой линк не помещаются. driverId = null означает «запись есть, модель
     неизвестна» — законное состояние, а не дырка в данных: пока модель не названа,
     единственный честный способ до железки — облако.
     Пока поле не приедет в снимок, это же состояние живёт у нас в settings/deviceConfig.ts. */
  registryState?: 'Recorded' | 'Configured' | 'Linked' | 'Paused';
  driverId?: string | null;
  /* rev ≥ 1.8 (SugarLifeCore#23). Одно ЛОГИЧЕСКОЕ устройство достижимо несколькими
     каналами: помпа — напрямую по BLE и одновременно через Nightscout. Пусто или
     отсутствует — устройство одноканальное, и верхние поля описывают его целиком.
     activeChannel — тот канал, чьи connection/status/live/latestAtMs подняты наверх. */
  channels?: ChannelView[];
  activeChannel?: string | null;
  /* За каким мостом стоит это устройство (rev ≥ 1.8, SugarLifeCore#8). У помпы за
     OrangeLink здесь id моста-устройства. Связь именно такая, а не наоборот: мост
     может обслуживать несколько железок, и «мост знает свою помпу» было бы неправдой. */
  behindBridgeId?: string | null;
  /* Телеметрия, которую устройство рассказывает о себе само (rev ≥ 1.8): заряд,
     прошивка, уровень сигнала. Display-only — решений по ним не принимаем.
     Отсутствие поля — нормальное состояние, а не дырка: драйвер мог не уметь читать
     батарею. Пустую строку вместо значения не рисуем, она выглядит как поломка. */
  batteryPct?: number | null;
  firmware?: string | null;
  rssi?: number | null;
  /* Когда железку последний раз видели в эфире (rev ≥ 1.8, SugarLifeCore#34).

     Ставит движок, когда объявление совпало с записью реестра. Нужно, чтобы показать
     «рядом — переподключить», не сводя самим discovered[] с devices[]: такое сведение
     даёт гонку «увидели/потеряли», и кнопка мигает.

     Отсутствие поля — не «далеко», а «не знаем»: старый мост признака не шлёт. */
  nearbyAtMs?: number | null;
  /* Как источник называет себя сам (rev ≥ 1.8, SugarLifeCore#23). Для облака это
     devicestatus.device из Nightscout — «AndroidAPS-DASH», «Loop». Нужно ровно там,
     где мы собираемся спросить человека «это твоя помпа?»: показать надо реальную
     строку, а не наш пересказ, иначе он подтверждает не то, что видит движок. */
  sourceLabel?: string | null;
}
/* Канал доставки состояния (rev ≥ 1.8, SugarLifeCore#23).

   Нужен ровно затем, чтобы «на связи» не значило разного. Помпа, о которой мы знаем
   через облако, и помпа, с которой мы говорим напрямую, — это два разных факта, и
   единственный способ не путать их в интерфейсе — спросить у движка, каким каналом
   пришло состояние, а не угадывать по виду устройства.

   С шага 3 (#23) статус НЕ-глюкозного канала считается по возрасту данных, а не по
   сокету: молчащая час облачная помпа приезжает Delayed, а не Live. */
export interface ChannelView {
  id: string;                    // источник-инстанс: bleId или «ns-pump»
  kind: 'direct' | 'bridged' | 'cloud';
  priority: number;              // меньше — предпочтительнее (прямой 0 < облако 10)
  connection: Link;
  status: SourceStatus;
  live: boolean;
  latestAtMs: number | null;
  label?: string | null;         // как называет себя источник этого канала
}
/** Историческое имя той же сущности — оставлено, чтобы не переписывать экраны. */
export type DeviceInfo = DeviceView;
/* Базальный профиль, прочитанный движком (rev ≥ 1.8, SugarLifeCore#7).

   Не голый список сегментов, а контейнер — и оба дополнительных поля появились по
   нашей просьбе, потому что каждое закрывает свой класс ошибок.

   origin — чьё это. На помпе лежит то, что реально работает сейчас; в Nightscout то,
   что туда однажды выгрузили. Это разные степени доверия, и расхождение между ними —
   полезная находка, но только если известно, что с чем сравниваем.

   timezone — на какое время размечены интервалы. У помпы это null, и null здесь НЕ
   «нет данных», а смысл: у 722 нет понятия зоны, времена — её собственные настенные
   часы. Считать их локальными для телефона нельзя: у путешественника телефон в одной
   зоне, помпа в другой, и он правил бы не тот интервал. */
export interface BasalSegmentView { startMinutes: number; rateUPerHour: number }
export interface BasalProfileView {
  segments: BasalSegmentView[];
  origin: 'Pump' | 'Nightscout';
  timezone: string | null;
}

export interface Insights { mode: 'Observe' | 'Advisory' | 'ClosedLoop'; messages: string[]; }
export interface PendingWrite { id: string; description: string; state: string; needsAttention: boolean; }

// rev ≥ 1.4: структурная ошибка (RFC 9457) — окно, не баннер
export interface Problem {
  code: string; title: string; remediation: string;
  severity: 'Info' | 'Warn' | 'Error' | 'Critical'; category: 'Ble' | 'Parser' | 'Device' | 'Network' | 'Domain' | 'Internal';
  retryable: boolean; detail?: string | null; errorId?: string | null;
}
export interface Alert { level: 'info' | 'warn' | 'critical'; text: string; problem?: Problem | null }

// rev ≥ 1.4: состояние логирования (раздел «Настройки логирования»)
export interface LoggingState { level: 'Trace' | 'Debug' | 'Info' | 'Warn' | 'Error'; capturingFile: boolean; capturingRaw: boolean; retentionHours: number }

// rev ≥ 1.5: plug-and-play — опознанное при скане устройство
export interface Discovered {
  bleId: string; name: string | null; driverId: string; displayName: string; rssi: number | null;
  needsMoreParams: boolean; isTransport: boolean; transportFor: string[];
  /* Уже заведённая запись, к которой относится это объявление (rev ≥ 1.8,
     SugarLifeCore#34). Равно ТОМУ ЖЕ id, что мы рисуем и шлём в connect —
     проекционному, а не внутреннему (их #35).

     Отличает «известное железо рядом» от «нового, которое можно добавить». Без него
     заведённый OrangeLink торчал в списке кандидатов на добавление, и человек заводил
     второй такой же. */
  knownDeviceId?: string | null;
}
// rev ≥ 1.2/1.5: каталог типов драйверов, которые умеет ядро
export interface DriverDescriptor {
  id: string; displayName: string; kind: 'sensor' | 'pump' | 'service'; roles: string[];
  settings: SettingsSpec; available: boolean; canActivate?: boolean; providesTransportFor?: string[];
}

/* Роль — то, к чему привязаны экран и алгоритм (rev ≥ 1.8, SugarLifeCore#34).

   До неё интерфейс сводил роль сам: искал среди devices[] сенсор, помпу, «кто
   основной». Это работало, пока источник был один. С каналами и облаком правило
   перестало быть очевидным, а алгоритм в движке нуждается в той же привязке — два
   канона расходятся всегда, и роль переехала в движок ПО НАШЕМУ правилу
   (domain/deviceState.ts, оно же эталон в их реализации).

   ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Расходки и чисел: резервуар, заряд, оба срока сенсора и
   сама глюкоза читаются с активного источника. Один срок на роли слил бы «день 12 из
   14» (паспортный) и предупреждение (реальный, у части сенсоров дольше) — а это
   разные вещи: одно пугает раньше времени, другое обещает больше, чем есть.

   Роль отвечает ровно на «кто сейчас за это отвечает и как мы до него дотягиваемся». */
export interface RoleView {
  /** 'cgm' | 'insulin' | 'meter'. Ввод инсулина — ОДНА роль: помпа и ручка это два
      способа делать одно, и переход МДИ↔помпа не должен терять историю роли. */
  role: string;
  /** Активный источник — правило (а): «откуда сейчас берутся цифры», облако тоже
      законный источник. На вопрос «на связи ли сама железка» отвечает via. */
  activeSourceId?: string | null;
  sourceIds?: string[];
  /** Текущий способ подачи — вид активного источника, только у роли insulin. */
  method?: 'pump' | 'pen' | null;
  /** Канал активного источника — из него строится «через что» человеку. */
  via?: 'direct' | 'bridged' | 'cloud' | null;
  /** С прямого/локального источника, даже когда активен облачный канал. */
  serial?: string | null;
}

export interface UiSnapshot {
  bridgeRevision: string;
  coreCommit?: string; // штамп коммита ядра — сверка идентичности сборок Android/iOS
  monitor: Monitor;
  devices: DeviceView[];
  insights: Insights | null;
  pendingWrites: PendingWrite[];
  alerts: Alert[];
  // rev ≥ 1.5 (опционально — старые мосты/шимы могут не отдавать)
  scanning?: boolean;
  discovered?: Discovered[];
  availableDrivers?: DriverDescriptor[];
  logging?: LoggingState | null;
  // rev ≥ 1.8: базальный профиль с провенансом. Отсутствует — ещё не прочитан.
  pumpBasal?: BasalProfileView | null;
  /* rev ≥ 1.8 (SugarLifeCore#34). Пусто или отсутствует — движок ролей ещё не отдаёт,
     и мы сводим роль сами по тому же правилу (domain/deviceState.ts). */
  roles?: RoleView[];
}

// ---- История (rev ≥ 1.1): query(HistoryQuery) → HistoryResult ----
export interface HistoryQuery { kind: 'Glucose' | 'Treatments' | 'Both'; fromMs: number; toMs: number; maxPoints?: number | null; }
export interface GlucosePoint { atMs: number; mmol: number | null; source: string; trend?: string | null; }
export interface TreatmentPoint { atMs: number; kind: string; amount: number; evidence: string; source: string; }
export interface HistoryResult { glucose: GlucosePoint[]; treatments: TreatmentPoint[]; }

// ---- Intent (веб → натив) ----
export type Intent =
  | { type: 'addDevice'; driverType: string; params: Record<string, string>; mode?: 'attach' | 'activate' }
  | { type: 'connect'; deviceId: string }
  | { type: 'disconnect'; deviceId: string }
  | { type: 'setAutoConnect'; deviceId: string; autoConnect: boolean }   // rev ≥ 1.7
  /* Забыть устройство. Идемпотентен: повторный вызов на уже забытой записи — accepted,
     а не ошибка (двойной тап безопасен). Движок ставит tombstone, поэтому запись не
     воскресает из входящего потока — иначе кнопка «Забыть» не работала бы вовсе.
     recordDevice (запись без драйвера) ядро ещё не выпустило — добавим, когда выйдет. */
  | { type: 'removeDevice'; deviceId: string }                          // rev ≥ 1.8
  /* rev ≥ 1.8: какой сенсор считать основным источником глюкозы. sourceId — это
     DeviceView.id; null снимает ручной выбор и возвращает авто. Явный выбор сильнее
     авто, пока выбранный источник жив; не стало его — движок сам падает обратно. */
  | { type: 'setPrimarySource'; sourceId: string | null }               // rev ≥ 1.8
  | { type: 'testDevice'; deviceId: string }
  | { type: 'setParams'; deviceId: string; params: Record<string, string> }
  | { type: 'setWiring'; deviceId: string; asInput: boolean; asOutput: boolean }
  | { type: 'startSensor'; deviceId: string }
  | { type: 'readNow'; deviceId: string }
  | { type: 'reconcile'; writeId: string }
  | { type: 'acknowledgeUnknown'; writeId: string; observation: string }
  | { type: 'enableAlgorithm'; enabled: boolean }
  | { type: 'setAlgorithmParams'; params: Record<string, string> }
  // rev ≥ 1.5: plug-and-play скан эфира
  | { type: 'startScan' }
  | { type: 'stopScan' }
  | { type: 'addDiscovered'; bleId: string; driverType: string; params: Record<string, string>; mode?: 'attach' | 'activate'; targetDriver?: string }
  // rev ≥ 1.4: логирование и отправка отчёта об ошибке
  | { type: 'setLogLevel'; level: 'Trace' | 'Debug' | 'Info' | 'Warn' | 'Error' }
  | { type: 'setLogCapture'; file: boolean | null; raw: boolean | null }
  | { type: 'exportLog' }
  | { type: 'sendReport'; errorId: string }
  /* rev ≥ 1.6: облачный хаб САМОГО пользователя (Nightscout) — читаем и пишем.
     Это НЕ вендор-аккаунт: у чужого облака производителя своя сущность Account
     (1.8, SugarLifeCore#3), и мешать их в один список нельзя. */
  | { type: 'addCloudSource'; url: string; token?: string | null; streams?: Array<'glucose' | 'pump' | 'treatments'> }
  // rev ≥ 1.7: бэкап конфига и истории в облако пользователя (пережить переустановку)
  | { type: 'configureBackup'; provider: 's3' | 'webdav'; params: Record<string, string> }
  | { type: 'backup' }
  | { type: 'restore' }
  /* Привязать канал к логическому устройству (rev ≥ 1.8, SugarLifeCore#23): «эта
     помпа в облаке — та же, что моя по BLE». deviceId = null снимает привязку.
     Движок с шага 2 сливает их сам, когда Nightscout несёт серийник настроенной
     помпы; ручная привязка сильнее автоматической и нужна там, где серийника нет. */
  | { type: 'mapChannel'; channelId: string; deviceId: string | null }    // rev ≥ 1.8
  /* Приём пищи в единую историю движка (rev ≥ 1.8, SugarLifeCore#25). Отсюда еда
     уезжает туда же, куда болюсы, — в Nightscout аплоадером, дальше в Apple Health и
     Health Connect коннектором. Второго писателя не появляется: пишет движок.

     id — наш ключ идемпотентности (domain/meals.ts), ложится в externalId записи.
     Повторная отправка после обрыва обязана распознаваться как повтор: задвоенные
     углеводы — задвоенная доза.

     atMs — время ЕДЫ, не внесения. insulin как есть: есть — записываем факт, нет —
     значит не вводили, а не «посчитайте сами». */
  | { type: 'logMeal'; id: string; atMs: number; carbs: number;
      insulin?: number | null; kind?: string | null; note?: string | null }  // rev ≥ 1.8
  | { type: 'releaseBle' };                                              // rev ≥ 1.7

export interface SugarLifeBridge {
  bridgeRevision: string;
  subscribe(cb: (s: UiSnapshot) => void): () => void;
  requestSnapshot(): Promise<UiSnapshot>;
  sendIntent(i: Intent): Promise<{ accepted: boolean; error?: string }>;
  // rev ≥ 1.1: окно истории для графиков. В 1.7 обязателен — Nightscout-шим отдаёт
  // историю из локальной IndexedDB, так что необязательным его держать больше незачем.
  query(q: HistoryQuery): Promise<HistoryResult>;
}

// Запрос истории через активный мост (undefined, если мост не поддерживает).
export function queryHistory(q: HistoryQuery): Promise<HistoryResult> {
  return getBridge().query(q);
}

declare global {
  interface Window { SugarLifeBridge?: SugarLifeBridge }
}

const BRIDGE_MAJOR = '1';

/* Движок первым, шим — браузерный запасной путь.

   До 11.08.2026 здесь стоял обратный приоритет: при настроенном Nightscout мы ВСЕГДА
   брали шим. Гейт был поставлен осознанно и был правильным — движок тогда отдавал
   данные симулятора-скелета, и показывать вымышленный сахар вместо настоящего нельзя.

   Он же оказался и причиной того, что BLE не включался вовсе: шим отдаёт свой короткий
   список драйверов и пустой discovered, поэтому «прямое чтение» оставалось серым, а
   скан недоступен. Данные при этом шли, и снаружи выглядело как «вроде работает» —
   худший вид поломки (SugarLifeCore#13).

   Теперь у движка реальные драйверы, и он же сам тянет Nightscout внутри через
   addCloudSource — то есть он источник правды, а не альтернатива ему. Шим остаётся там,
   где движка нет по построению: в браузере.

   Проверка мажорной версии остаётся: несовместимый мост лучше не брать вовсе. */
export function getBridge(): SugarLifeBridge {
  const native = typeof window !== 'undefined' ? window.SugarLifeBridge : undefined;
  if (native && String(native.bridgeRevision).split('.')[0] === BRIDGE_MAJOR) return native;
  return nightscoutBridge;
}

// Хук: текущий снимок (null до первого).
export function useSnapshot(): UiSnapshot | null {
  const [snap, setSnap] = useState<UiSnapshot | null>(null);
  useEffect(() => getBridge().subscribe(setSnap), []);
  return snap;
}

// Отправить действие пользователя. Возвращает лишь факт ПРИЁМА (не выполнения).
export function sendIntent(i: Intent): Promise<{ accepted: boolean; error?: string }> {
  return getBridge().sendIntent(i);
}
