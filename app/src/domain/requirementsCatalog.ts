/* Каталог требований (docs/CONNECT-UX.md §7a): «назови устройство → скажем, поддерживаем ли
   и что нужно». Отдельно от каталогов SENSORS/PUMPS (те — для учёта выбранной модели);
   этот — компактный, курируемый, только про совместимость и требования к подключению.
   Данные — из docs/DEVICE-BLE-CATALOG.md (провенанс: Juggluco/rileylink_ios/xDrip+ и т.п.). */
export type Support = 'direct' | 'bridge' | 'vendorCloud' | 'blocked';

/* Облако производителя — отдельная сущность, а не свойство модели.

   Одна учётка обслуживает несколько сенсоров марки, у неё своё состояние (вошли /
   вход истёк) и свои поля входа. Поэтому здесь только справка «такое облако есть и
   вот что оно спросит»; сам вход и его состояние приедут из контракта
   (UiSnapshot.accounts, см. docs/bridge-accounts-proposal.md).

   Пароль от чужого облака в браузере не хранится вовсе — только в приложении, в
   Keychain/Keystore на нативной стороне. Это согласовано с ядром (SugarLifeCore#3). */
export interface VendorCloud {
  id: string;
  name: string;
  asks: string; // что спросит при входе (человекочитаемо)
}
export const VENDOR_CLOUDS: Record<string, VendorCloud> = {
  ottai: { id: 'ottai', name: 'OttAI / OhCare', asks: 'почта или телефон, пароль, регион' },
  librelinkup: { id: 'librelinkup', name: 'LibreLinkUp', asks: 'логин Abbott, пароль, регион' },
  dexcomshare: { id: 'dexcomshare', name: 'Dexcom Share', asks: 'логин, пароль, сервер (US/вне US)' },
};

export interface RequirementEntry {
  id: string;
  name: string;
  brand: string;
  category: 'sensor' | 'pump' | 'meter' | 'pen';
  support: Support;
  requirement: string; // что нужно (человекочитаемо)
  /* Облако производителя, если у модели оно есть. Это ВТОРОЙ путь, а не замена
     основному: у Libre 2 и прямое чтение, и LibreLinkUp. Поэтому отдельным полем,
     а не значением support — иначе пришлось бы выбирать, что из двух правда. */
  vendorCloud?: keyof typeof VENDOR_CLOUDS;
}

export const REQUIREMENTS: RequirementEntry[] = [
  { id: 'medtronic-paradigm-5xx-7xx', name: 'Paradigm 5xx/7xx', brand: 'Medtronic', category: 'pump', support: 'bridge', requirement: 'радиомост OrangeLink/RileyLink' },
  { id: 'libre-1', name: 'FreeStyle Libre 1', brand: 'Abbott', category: 'sensor', support: 'bridge', requirement: 'трансмиттер MiaoMiao/Bubble (клеится)' },
  { id: 'ottai-c1', name: 'OttAI C1 / OhCare', brand: 'OttAI', category: 'sensor', support: 'vendorCloud', requirement: 'аккаунт производителя (работает только в приложении)', vendorCloud: 'ottai' },
  { id: 'libre-2', name: 'FreeStyle Libre 2', brand: 'Abbott', category: 'sensor', support: 'direct', requirement: 'ничего', vendorCloud: 'librelinkup' },
  { id: 'libre-3', name: 'FreeStyle Libre 3', brand: 'Abbott', category: 'sensor', support: 'direct', requirement: 'ничего', vendorCloud: 'librelinkup' },
  { id: 'dexcom-g6', name: 'Dexcom G6', brand: 'Dexcom', category: 'sensor', support: 'direct', requirement: 'ничего', vendorCloud: 'dexcomshare' },
  { id: 'dexcom-one', name: 'Dexcom ONE+', brand: 'Dexcom', category: 'sensor', support: 'direct', requirement: 'ничего', vendorCloud: 'dexcomshare' },
  { id: 'sibionics-gs1', name: 'Sibionics GS1', brand: 'Sibionics', category: 'sensor', support: 'direct', requirement: 'QR-активация', vendorCloud: 'ottai' },
  { id: 'meter-standard', name: 'Contour Next / Accu-Chek / OneTouch', brand: 'разные', category: 'meter', support: 'direct', requirement: 'ничего (стандартный BLE-профиль глюкометра)' },
  { id: 'novopen', name: 'NovoPen 6 / Echo Plus', brand: 'Novo Nordisk', category: 'pen', support: 'direct', requirement: 'NFC-тап после укола' },
  { id: 'inpen', name: 'InPen', brand: 'Medtronic', category: 'pen', support: 'direct', requirement: 'ничего (BLE)' },
  { id: 'omnipod', name: 'Omnipod', brand: 'Insulet', category: 'pump', support: 'blocked', requirement: 'режим управления (мониторинг невозможен)' },
];

export const supportLabel = (s: Support): string =>
  s === 'direct' ? '✓ поддерживаем'
  : s === 'bridge' ? '✓ через мост'
  : s === 'vendorCloud' ? '✓ через облако производителя'
  : '⛔ пока не мониторится';

/** Короткая пометка для списка. */
export const supportMark = (s: Support): string =>
  s === 'direct' ? '✓' : s === 'bridge' ? '✓ мост' : s === 'vendorCloud' ? '✓ облако' : '⛔';

export const categoryLabel = (c: RequirementEntry['category']): string =>
  c === 'sensor' ? 'Сенсор (НМГ)' : c === 'pump' ? 'Ввод инсулина' : c === 'meter' ? 'Глюкометр' : 'Умная ручка';
