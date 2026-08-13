import { describe, it, expect } from 'vitest';
import { рядомЛи, записьВЭфире, новоеВЭфире, наширядом, железоДиспетчера, РЯДОМ_СВЕЖЕСТЬ } from './nearby';
import type { Discovered, DeviceView, UiSnapshot } from '@/sources/bridge';

/* Граница «наше/новое» под тестами, потому что ошибка в ней не выглядит ошибкой.
   В одну сторону получается лишняя запись о железке, которая уже заведена, — человек
   подключает второй OrangeLink и не понимает, почему их два. В другую — предложение
   переподключить чужой сенсор, а у сенсора один хозяин за раз. */

const эфир = (p: Partial<Discovered>): Discovered => ({
  bleId: 'AA:BB', name: 'OrangeLink', driverId: 'orange', displayName: 'OrangeLink',
  rssi: -60, needsMoreParams: false, isTransport: true, transportFor: [], ...p,
});
const зап = (p: Partial<DeviceView>): DeviceView => ({
  id: 'dev-AA:BB', name: 'OrangeLink', kind: 'bridge', roles: [], connection: 'Disconnected',
  capabilities: {}, settings: { parameters: [] },
  admittedInput: true, admittedOutput: false, testable: false, ...p,
});

describe('кто в эфире наш', () => {
  it('движок назвал запись — она наша, и в кандидаты не идёт', () => {
    const d = эфир({ knownDeviceId: 'dev-1' });
    expect(записьВЭфире(d, [])).toBe('dev-1');
    expect(новоеВЭфире([d], [])).toEqual([]);
  });

  it('движок сказал «не знаю такого» — это кандидат, даже если id похож', () => {
    const d = эфир({ knownDeviceId: null });
    expect(новоеВЭфире([d], [зап({ id: 'dev-AA:BB' })])).toHaveLength(1);
  });

  /* Старый мост поля не шлёт вовсе — тогда работает прежняя догадка по bleId. */
  it('поля нет — сопоставляем по bleId внутри id записи', () => {
    const d = эфир({});
    expect(записьВЭфире(d, [зап({ id: 'ble-AA:BB-1' })])).toBe('ble-AA:BB-1');
    expect(новоеВЭфире([d], [зап({ id: 'ble-CC:DD-1' })])).toHaveLength(1);
  });
});

describe('рядом ли железка', () => {
  const сейчас = 1_000_000;

  it('только что видели — рядом', () => {
    expect(рядомЛи(сейчас - 1_000, сейчас)).toBe(true);
  });

  it('видели давно — уже не рядом', () => {
    expect(рядомЛи(сейчас - РЯДОМ_СВЕЖЕСТЬ - 1, сейчас)).toBe(false);
  });

  /* Молчание — «не знаем», а не «далеко»: старый мост отметки не ставит, и объявлять
     по его молчанию, что железки рядом нет, значит утверждать неизвестное. */
  it('отметки нет — про «рядом» молчим', () => {
    expect(рядомЛи(null, сейчас)).toBe(false);
    expect(рядомЛи(undefined, сейчас)).toBe(false);
  });

  it('живой эфир добавляет к отметке движка, а не заменяет её', () => {
    const давно = зап({ id: 'a', nearbyAtMs: сейчас - 10 * 60_000 });
    const свежий = зап({ id: 'b', nearbyAtMs: сейчас - 5_000 });
    const слышно = эфир({ knownDeviceId: 'a' });
    expect([...наширядом([давно, свежий], [слышно], сейчас)].sort()).toEqual(['a', 'b']);
  });
});

/* Диспетчер: движок отдаёт готовый список железа, и слушать надо его. Наш фильтр по
   виду — догадка, которая не знает, например, что «pump» в devices[] может оказаться
   облачной записью (SugarLifeCore#44). */
describe('что показывать в диспетчере', () => {
  const снимок = (p: Partial<UiSnapshot>): UiSnapshot => ({
    bridgeRevision: '1.8', devices: [], insights: null, pendingWrites: [], alerts: [],
    monitor: {} as UiSnapshot['monitor'], ...p,
  });

  it('есть hardware[] — берём его целиком, ничего не фильтруя', () => {
    const s = снимок({
      hardware: [{ id: 'h1', name: 'OrangeLink', kind: 'bridge', connection: 'Connected' }],
      devices: [зап({ id: 'd1' }), зап({ id: 'ns', kind: 'service' })],
    });
    expect(железоДиспетчера(s).map((h) => h.id)).toEqual(['h1']);
  });

  /* Пустой hardware[] — это ответ «железа нет», а не повод посчитать самим: движок
     видит инвентарь целиком, и наш фильтр показал бы то, что он уже исключил. */
  it('hardware[] пуст — диспетчер пуст, а не собран догадкой', () => {
    expect(железоДиспетчера(снимок({ hardware: [], devices: [зап({ id: 'd1' })] }))).toEqual([]);
  });

  it('поля нет вовсе — старый мост, работает прежний фильтр по виду', () => {
    const s = снимок({ devices: [зап({ id: 'd1' }), зап({ id: 'ns', kind: 'service' })] });
    expect(железоДиспетчера(s).map((h) => h.id)).toEqual(['d1']);
  });
});

