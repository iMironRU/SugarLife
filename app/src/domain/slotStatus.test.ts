import { describe, it, expect } from 'vitest';
import { слотПоСнимку, каналСлота, мостСлота, ПОДПИСЬ_СЛОТА } from './slotStatus';
import type { DeviceView, UiSnapshot, HardwareView, RoleView } from '@/sources/bridge';

/* Состояние слота человек читает как ответ на «работает ли у меня это». Ошибка здесь
   не падает и не мигает — она просто говорит неправду в самом видном месте раздела,
   и именно так мы получили строку «по радио · только через облако» про одно и то же
   устройство. */

const dev = (p: Partial<DeviceView>): DeviceView => ({
  id: 'd', name: 'D', kind: 'sensor', roles: [], connection: 'Disconnected',
  capabilities: {}, settings: { parameters: [] },
  admittedInput: true, admittedOutput: false, testable: false, ...p,
});

const snap = (
  devices: DeviceView[], roles?: RoleView[], hardware?: HardwareView[],
): UiSnapshot => ({
  bridgeRevision: '1.8', devices, roles, hardware,
  insights: null, pendingWrites: [], alerts: [],
  monitor: {} as UiSnapshot['monitor'],
});

describe('состояние слота по снимку', () => {
  /* Движок ролей не отдаёт — это не «пусто», а «спроси другого»: в браузере движка нет
     вовсе, и без null раздел устройств оказался бы пустым у всех, кто смотрит с
     компьютера. */
  it('движок молчит — null, а не выдуманное состояние', () => {
    expect(слотПоСнимку(snap([]), 'sensor')).toBe(null);
    expect(слотПоСнимку(null, 'pump')).toBe(null);
  });

  it('роль есть, источника нет — записи нет', () => {
    expect(слотПоСнимку(snap([], [{ role: 'cgm', activeSourceId: null }]), 'sensor')).toBe('нет записи');
  });

  it('данные идут — «на связи»', () => {
    const s = snap([dev({ id: 'a', status: 'Live', driverId: 'sibionics' })], [{ role: 'cgm', activeSourceId: 'a' }]);
    expect(слотПоСнимку(s, 'sensor')).toBe('на связи');
  });

  /* Модель не названа — законное состояние, а не поломка: данные идут облаком, просто
     напрямую читать нечем. */
  it('модели нет и канал облачный — «только через облако»', () => {
    const облако = dev({
      id: 'ns', kind: 'pump', driverId: null, status: 'Delayed', activeChannel: 'c',
      channels: [{ id: 'c', kind: 'cloud', priority: 10, connection: 'Streaming', status: 'Delayed', live: false, latestAtMs: null }],
    });
    const s = snap([облако], [{ role: 'insulin', activeSourceId: 'ns' }]);
    expect(слотПоСнимку(s, 'pump')).toBe('без модели');
    expect(ПОДПИСЬ_СЛОТА[слотПоСнимку(s, 'pump')!]).toBe('только через облако');
  });

  /* Отдельное состояние, потому что действие человека своё: не «настроить», а найти
     посредника. */
  it('канал через мост есть, а моста в железе нет — «нужен мост»', () => {
    const помпа = dev({
      id: 'p', kind: 'pump', driverId: 'medtronic', status: 'Disconnected', activeChannel: 'b',
      channels: [{ id: 'b', kind: 'bridged', priority: 0, connection: 'Disconnected', status: 'Disconnected', live: false, latestAtMs: null }],
    });
    const s = snap([помпа], [{ role: 'insulin', activeSourceId: 'p' }], []);
    expect(слотПоСнимку(s, 'pump')).toBe('нужен мост');
  });

  it('мост в железе есть — слот просто настроен, связи пока нет', () => {
    const помпа = dev({
      id: 'p', kind: 'pump', driverId: 'medtronic', status: 'Disconnected', activeChannel: 'b',
      channels: [{ id: 'b', kind: 'bridged', priority: 0, connection: 'Disconnected', status: 'Disconnected', live: false, latestAtMs: null }],
    });
    const мост: HardwareView = { id: 'o', name: 'OrangeLink', kind: 'bridge', connection: 'Connected' };
    const s = snap([помпа], [{ role: 'insulin', activeSourceId: 'p' }], [мост]);
    expect(слотПоСнимку(s, 'pump')).toBe('настроено');
  });
});

describe('через что идут данные слота', () => {
  it('слово роли главнее разбора каналов', () => {
    const s = snap([dev({ id: 'a' })], [{ role: 'cgm', activeSourceId: 'a', via: 'bridged' }]);
    expect(каналСлота(s, 'sensor')).toBe('bridged');
  });

  it('роль про канал молчит — читаем активный канал источника', () => {
    const d = dev({
      id: 'a', activeChannel: 'c',
      channels: [{ id: 'c', kind: 'cloud', priority: 10, connection: 'Streaming', status: 'Live', live: true, latestAtMs: null }],
    });
    expect(каналСлота(snap([d], [{ role: 'cgm', activeSourceId: 'a' }]), 'sensor')).toBe('cloud');
  });

  it('движка нет — null, и подписи не будет', () => {
    expect(каналСлота(snap([]), 'sensor')).toBe(null);
  });
});

/* Мост слота. Пока мост один, ошибка невидима — и именно поэтому проверяем случай с
   двумя: карточка сенсора, показывающая заряд помпиного моста, отправляет человека
   менять батарейку не в том приборе. */
describe('чей мост показывать', () => {
  const мостП = dev({ id: 'orange', name: 'OrangeLink', kind: 'bridge', batteryPct: 60 });
  const мостС = dev({ id: 'miao', name: 'MiaoMiao', kind: 'bridge', batteryPct: 20 });
  const помпа = dev({ id: 'p', kind: 'pump', behindBridgeId: 'orange' });
  const сенсор = dev({ id: 's', kind: 'sensor', behindBridgeId: 'miao' });
  const роли: RoleView[] = [{ role: 'insulin', activeSourceId: 'p' }, { role: 'cgm', activeSourceId: 's' }];

  it('берём тот, за которым стоит устройство слота', () => {
    const s = snap([мостП, мостС, помпа, сенсор], роли);
    expect(мостСлота(s, 'pump')?.id).toBe('orange');
    expect(мостСлота(s, 'sensor')?.id).toBe('miao');
  });

  /* Ссылка есть, а моста в снимке нет — молчим. Показать чужой значит соврать про
     заряд конкретного прибора. */
  it('ссылка ведёт в никуда — не подставляем соседний', () => {
    expect(мостСлота(snap([мостС, помпа], роли), 'pump')).toBe(null);
  });

  /* Старая сборка ссылок не даёт. Тогда работает догадка «первый мост» — она верна,
     пока мост один, и это записано как её граница. */
  it('ссылки нет — берём первый, и это осознанная догадка', () => {
    const безСсылки = dev({ id: 'p', kind: 'pump' });
    expect(мостСлота(snap([мостП, безСсылки], [{ role: 'insulin', activeSourceId: 'p' }]), 'pump')?.id).toBe('orange');
  });

  it('мостов нет вовсе — null', () => {
    expect(мостСлота(snap([помпа], роли), 'pump')).toBe(null);
  });
});

