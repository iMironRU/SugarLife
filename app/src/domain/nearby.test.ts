import { describe, it, expect } from 'vitest';
import {
  рядомЛи, записьВЭфире, новоеВЭфире, наширядом, железоДиспетчера, РЯДОМ_СВЕЖЕСТЬ,
  потерянаСвязь, имяЖелезки,
} from './nearby';
import type { Discovered, DeviceView, UiSnapshot, HardwareView, RoleView } from '@/sources/bridge';

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


/* Тревога о связи (SugarLife#247).

   Экран противоречил сам себе: лента писала «Medtronic 722 на связи» и «Sibionics GS1 на
   связи», а карточка прямо под ней — «Связь с устройством потеряна». Оба утверждения
   были по-своему верны, потому что отвечали про разные слои: железка про радио, слот про
   данные. Человеку нужен ответ про последствие. */
const ж = (p: Partial<HardwareView>): HardwareView => ({
  id: 'h', name: 'H', kind: 'sensor', connection: 'Connected', ...p,
});

const снимокЖ = (
  hardware: HardwareView[], roles?: RoleView[], devices: DeviceView[] = [],
): UiSnapshot => ({
  bridgeRevision: '1.9', hardware, roles, devices,
  insights: null, pendingWrites: [], alerts: [],
  monitor: {} as UiSnapshot['monitor'],
});

const живойИсточник = (id: string, kind: DeviceView['kind'] = 'sensor'): DeviceView =>
  зап({ id, name: id, kind, connection: 'Streaming', status: 'Live' });

describe('когда считаем связь потерянной', () => {
  it('всё на связи — тревоги нет', () => {
    const s = снимокЖ(
      [ж({ id: 's', status: 'Live', inSlot: 'cgm' }), ж({ id: 'p', kind: 'pump', status: 'Live', inSlot: 'insulin' })],
      [{ role: 'cgm', activeSourceId: 's' }, { role: 'insulin', activeSourceId: 'p' }],
      [живойИсточник('s'), живойИсточник('p', 'pump')],
    );
    expect(потерянаСвязь(s)).toEqual([]);
  });

  /* Тот самый случай со скриншота: радио отвалилось, а слот наполняется. Тревожить
     нечем — данные идут, и человеку незачем бежать чинить связь. */
  it('радио молчит, но слот наполняется — не тревога', () => {
    const s = снимокЖ(
      [ж({ id: 's', status: 'Disconnected', connection: 'Disconnected', inSlot: 'cgm' })],
      [{ role: 'cgm', activeSourceId: 's' }],
      [живойИсточник('s')],
    );
    expect(потерянаСвязь(s)).toEqual([]);
  });

  it('слот не наполняется — тревога, и в ней есть имя', () => {
    const мёртвый = зап({ id: 's', kind: 'sensor', connection: 'Disconnected', status: 'Disconnected' });
    const s = снимокЖ(
      [ж({ id: 's', name: 'GS1-2E4F', model: 'Sibionics GS1', status: 'Disconnected', connection: 'Disconnected', inSlot: 'cgm' })],
      [{ role: 'cgm', activeSourceId: 's' }],
      [мёртвый],
    );
    expect(потерянаСвязь(s).map(имяЖелезки)).toEqual(['Sibionics GS1']);
  });

  /* Мост сам по себе не повод для тревоги: если он был нужен, замолчит и то, что за ним,
     и назовём мы именно его — «помпа не на связи» понятнее, чем «отвалился OrangeLink». */
  it('мост отвалился, а данные идут — молчим', () => {
    const s = снимокЖ(
      [ж({ id: 'o', kind: 'bridge', name: 'OrangeLink', status: 'Disconnected', connection: 'Disconnected', inSlot: null }),
        ж({ id: 'p', kind: 'pump', status: 'Live', inSlot: 'insulin' })],
      [{ role: 'insulin', activeSourceId: 'p' }],
      [живойИсточник('p', 'pump')],
    );
    expect(потерянаСвязь(s)).toEqual([]);
  });

  /* Железка заведена, но ни в каком слоте не стоит — лежит в ящике. Её молчание не
     событие: она и не должна ничего отдавать. */
  it('железка вне слотов молчит законно', () => {
    const s = снимокЖ([ж({ id: 'x', status: 'Disconnected', connection: 'Disconnected', inSlot: null })]);
    expect(потерянаСвязь(s)).toEqual([]);
  });

  /* Старый мост слотов не отдаёт. Проверить нечем, и лучше лишняя тревога, чем
     пропущенная: связь — это то, ради чего человек и открывает экран. */
  it('движок про слоты молчит — тревожимся, как раньше', () => {
    const s = снимокЖ([ж({ id: 's', status: 'Disconnected', connection: 'Disconnected' })]);
    expect(потерянаСвязь(s).map((h) => h.id)).toEqual(['s']);
  });
});

describe('как называем железку', () => {
  it('модель понятнее имени в эфире', () => {
    expect(имяЖелезки(ж({ name: 'GS1-2E4F', model: 'Sibionics GS1' }))).toBe('Sibionics GS1');
  });
  it('модели нет — остаётся имя, а не пустота', () => {
    expect(имяЖелезки(ж({ name: 'GS1-2E4F' }))).toBe('GS1-2E4F');
  });
});
