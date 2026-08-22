import { describe, it, expect } from 'vitest';
import { слотПоСнимку, каналСлота, мостСлота, путьСлота, модельСлота } from './slotStatus';
import { ПОДПИСЬ_СЛОТА } from '@/слова/слоты';
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

  /* Мост — железка, и в проекции железа он есть всегда; в devices[] его кладёт не всякая
     сборка. Пока смотрели только в devices, карточка писала «мост не выбран» рядом со
     списком, где этот мост стоял строкой выше. */
  it('моста нет в devices — берём из проекции железа', () => {
    const железо = [{ id: 'orange', name: 'OrangeLink', kind: 'bridge', connection: 'Disconnected',
      batteryPct: 60, firmware: '2.4' }] as unknown as HardwareView[];
    const s = snap([dev({ id: 'p', kind: 'pump', behindBridgeId: 'orange' })],
      [{ role: 'insulin', activeSourceId: 'p' }], железо);
    expect(мостСлота(s, 'pump')?.name).toBe('OrangeLink');
    expect(мостСлота(s, 'pump')?.batteryPct).toBe(60);
  });
});

/* Откуда идут цифры — вопрос не тот же, что «работает ли связь». Помпа может молчать по
   радио, а данные идти из Nightscout, и в списке это должно быть видно без открытия
   карточки. */
describe('откуда идут данные слота', () => {
  it('канал известен — называем его', () => {
    const s = snap([dev({ id: 'p', kind: 'pump' })], [{ role: 'insulin', activeSourceId: 'p', via: 'bridged' }]);
    expect(путьСлота(s, 'pump')).toBe('через мост');
  });

  /* В браузере движка нет вовсе, и единственный источник — Nightscout. Это утверждение
     по построению, а не заглушка. */
  it('движка нет — всё пришло облаком', () => {
    expect(путьСлота(snap([]), 'pump')).toBe('через облако');
    expect(путьСлота(null, 'sensor')).toBe('через облако');
  });

  /* А вот когда движок есть и молчит про канал — молчим и мы: выдумывать «облако» там,
     где движок просто не ответил, значит утверждать за него. */
  it('движок есть, но про канал молчит — не выдумываем', () => {
    const s: UiSnapshot = {
      ...snap([dev({ id: 'p', kind: 'pump' })], [{ role: 'insulin', activeSourceId: 'p' }]),
      availableDrivers: [{ id: 'x', displayName: 'x', kind: 'pump', roles: [], settings: { parameters: [] }, available: true }],
    };
    expect(путьСлота(s, 'pump')).toBe(null);
  });
});

/* Модель по нашему справочнику — из снимка (#224, шаг 4). Здесь проверяем только «у
   какого прибора спрашивать»; годится ли ответ, решает domain/реестр.ts. */
describe('модель прибора из снимка', () => {
  const роли: RoleView[] = [{ role: 'insulin', activeSourceId: 'p2' }];

  /* Приборов одного вида бывает несколько: запасная помпа, снятая с учёта старая. Взять
     первую попавшуюся значит показать спецификации не той железки. */
  it('спрашиваем прибор слота, а не первый в списке', () => {
    const s = snap([
      dev({ id: 'p1', kind: 'pump', deviceModel: 'старая' }),
      dev({ id: 'p2', kind: 'pump', deviceModel: 'нужная' }),
    ], роли);
    expect(модельСлота(s, 'pump')).toBe('нужная');
  });

  /* Прибор записан, но данные ещё не пошли и слот пуст. Один прибор своего вида —
     двусмысленности нет, про него и речь. */
  it('слот пуст, прибор один — отвечаем за него', () => {
    expect(модельСлота(snap([dev({ id: 'p', kind: 'pump', deviceModel: 'она' })]), 'pump'))
      .toBe('она');
  });

  /* А вот двух молчим: выбрать за человека нечем, и ошибиться тут дороже, чем промолчать
     — по модели считается резервуар. */
  it('слот пуст, приборов два — молчим', () => {
    const s = snap([
      dev({ id: 'a', kind: 'pump', deviceModel: 'одна' }),
      dev({ id: 'b', kind: 'pump', deviceModel: 'другая' }),
    ]);
    expect(модельСлота(s, 'pump')).toBe(null);
  });

  it('движок модели не знает — null, дальше отвечает локальный выбор', () => {
    expect(модельСлота(snap([dev({ id: 'p', kind: 'pump' })]), 'pump')).toBe(null);
    expect(модельСлота(null, 'pump')).toBe(null);
  });
});

/* Помпа на теле, радио молчит, цифры идут из Nightscout: слот наполняет облачный
   источник, а модель записана железке. Устройство при этом одно — роль перечисляет оба
   пути в sourceIds. */
describe('модель, когда слот наполняет облако', () => {
  it('берём её у второго пути того же устройства', () => {
    const s = snap([
      dev({ id: 'ble', kind: 'pump', deviceModel: 'наша' }),
      dev({ id: 'cloud', kind: 'pump' }),
    ], [{ role: 'insulin', activeSourceId: 'cloud', sourceIds: ['ble', 'cloud'] }]);
    expect(модельСлота(s, 'pump')).toBe('наша');
  });

  /* Чужого прибора это не касается: за пределы своей роли не выходим. */
  it('прибор не из этой роли не считается', () => {
    const s = snap([
      dev({ id: 'чужая', kind: 'pump', deviceModel: 'не наша' }),
      dev({ id: 'cloud', kind: 'pump' }),
    ], [{ role: 'insulin', activeSourceId: 'cloud', sourceIds: ['cloud'] }]);
    expect(модельСлота(s, 'pump')).toBe(null);
  });
});
