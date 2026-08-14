import { describe, it, expect } from 'vitest';
import { слотПоСнимку, каналСлота, ПОДПИСЬ_СЛОТА } from './slotStatus';
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
