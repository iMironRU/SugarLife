import { describe, it, expect } from 'vitest';
import { связь, источникГлюкозы, источникПомпы, связьГлюкозы, предложениеСлияния, серийникИз, своиЖелезки, видКруга } from './deviceState';
import type { DeviceView, UiSnapshot } from '@/sources/bridge';

/* Правило состояния связи проверяем тестами, потому что именно в нём живёт баг, с
   которого пришла задача: два экрана показывали разное. Разметку тесты не поймают,
   а вот «что считать живым» — ровно то место, где разошлись бы снова. */

const dev = (p: Partial<DeviceView>): DeviceView => ({
  id: 'd', name: 'D', kind: 'sensor', roles: [], connection: 'Disconnected',
  capabilities: {}, settings: { parameters: [] },
  admittedInput: true, admittedOutput: false, testable: false, ...p,
});

const snap = (devices: DeviceView[], monitor?: Partial<UiSnapshot['monitor']>): UiSnapshot => ({
  bridgeRevision: '1.7', devices, insights: null, pendingWrites: [], alerts: [],
  scanning: false, discovered: [], availableDrivers: [], logging: null,
  monitor: { glucose: '—', trend: '—', link: 'Disconnected', reservoir: '—', battery: '—',
    confirmedIOB: 0, assumedIOB: 0, conservativeIOB: 0, ...monitor } as UiSnapshot['monitor'],
});

describe('связь', () => {
  it('статус важнее линка: связь есть, показаний ещё нет — это ожидание, не жизнь', () => {
    expect(связь(dev({ connection: 'Connected', status: 'Acquiring' }))).toBe('wait');
  });

  it('отставший источник не выдаём за живой', () => {
    expect(связь(dev({ connection: 'Streaming', status: 'Delayed' }))).toBe('wait');
  });

  it('без статуса читаем линк — старый мост статуса не присылает', () => {
    expect(связь(dev({ connection: 'Streaming' }))).toBe('live');
    expect(связь(dev({ connection: 'Error' }))).toBe('off');
  });

  it('устройства нет — «не знаю», а не «нет связи»', () => {
    expect(связь(null)).toBe('unknown');
    expect(связь(dev({ connection: 'ЧтоТоНовое' }))).toBe('unknown');
  });
});

describe('кого считать источником', () => {
  it('глюкозу отдаёт и сервис: роль важнее вида', () => {
    const ns = dev({ id: 'nightscout', kind: 'service', roles: ['GlucoseSource'] });
    expect(источникГлюкозы(snap([ns]))?.id).toBe('nightscout');
  });

  it('при нескольких сенсорах берём основной — на него смотрит и монитор', () => {
    const a = dev({ id: 'a', kind: 'sensor' });
    const b = dev({ id: 'b', kind: 'sensor', primary: true });
    expect(источникГлюкозы(snap([a, b]))?.id).toBe('b');
  });

  /* Без пометки primary «первый попавшийся» зависел бы от порядка устройств в
     снимке — того, что нам никто не обещал. Железка вперёд сервиса. */
  it('без основного сенсор идёт вперёд облачного сервиса, даже если тот в списке первым', () => {
    const ns = dev({ id: 'nightscout', kind: 'service', roles: ['GlucoseSource'] });
    const s = dev({ id: 'sib', kind: 'sensor' });
    expect(источникГлюкозы(snap([ns, s]))?.id).toBe('sib');
  });

  /* Живое облако — не живая помпа. Помпа молчит час, Nightscout бодро отдаёт
     последний известный документ, и метка сказала бы «на связи» про железку, о
     которой ничего не слышно. */
  it('помпа — только помпа: сервис с ролью PumpStateSource за неё не отвечает', () => {
    const ns = dev({ id: 'nightscout', kind: 'service', roles: ['PumpStateSource'] });
    const pump = dev({ id: 'mm', kind: 'pump', driverId: 'medtronic-722' });
    expect(источникПомпы(snap([ns, pump]))?.id).toBe('mm');
    expect(источникПомпы(snap([ns]))).toBeNull();
    expect(связь(источникПомпы(snap([ns])))).toBe('unknown');
  });

  /* Так было до коммита ядра 08c8e94: kind метился по ролям, и облачный источник
     состояния помпы приезжал как kind:'pump'. Теперь он 'service', но проверку
     держим — старые сборки движка ещё в ходу, а цена ошибки прежняя. */
  it('облачная «помпа» с kind:pump за железку не отвечает — по driverId', () => {
    const облако = dev({ id: 'ns-pump', kind: 'pump', driverId: null, connection: 'Streaming' });
    expect(источникПомпы(snap([облако]))).toBeNull();
  });

  it('каналы точнее признака: активный cloud — не прямая связь с помпой', () => {
    const каналы = dev({
      id: 'mm', kind: 'pump', driverId: 'medtronic-722', connection: 'Connected',
      activeChannel: 'ns-pump',
      channels: [
        { id: 'ble-1', kind: 'direct', priority: 0, connection: 'Disconnected', status: 'Disconnected', live: false, latestAtMs: null },
        { id: 'ns-pump', kind: 'cloud', priority: 10, connection: 'Connected', status: 'Live', live: true, latestAtMs: 1 },
      ],
    });
    expect(источникПомпы(snap([каналы]))).toBeNull();
  });

  it('активен прямой канал — это она и есть', () => {
    const прямой = dev({
      id: 'mm', kind: 'pump', driverId: 'medtronic-722', status: 'Live',
      activeChannel: 'ble-1',
      channels: [
        { id: 'ble-1', kind: 'direct', priority: 0, connection: 'Streaming', status: 'Live', live: true, latestAtMs: 1 },
      ],
    });
    expect(источникПомпы(snap([прямой]))?.id).toBe('mm');
    expect(связь(источникПомпы(snap([прямой])))).toBe('live');
  });
});

describe('связьГлюкозы', () => {
  it('состояние устройства точнее монитора, пока их считают порознь', () => {
    const s = snap([dev({ kind: 'sensor', status: 'Live' })], { status: 'Disconnected', live: false });
    expect(связьГлюкозы(s)).toBe('live');
  });

  /* Ветку «монитор перебивает link-only устройство» убрали: движок считает статус
     один раз для обоих (SugarLifeCore#22), шим — тоже. Устройство отвечает само. */
  it('устройство отвечает само, монитор его не переспрашивает', () => {
    const s = snap([dev({ kind: 'sensor', connection: 'Streaming' })], { status: 'Delayed' });
    expect(связьГлюкозы(s)).toBe('live');
  });

  it('устройств нет вовсе — тогда монитор: у старого моста больше ничего нет', () => {
    expect(связьГлюкозы(snap([], { status: 'Acquiring' }))).toBe('wait');
  });

  it('снимка нет — молчим, а не рисуем обрыв', () => {
    expect(связьГлюкозы(null)).toBe('unknown');
  });
});

/* Предложение слияния — единственное место, где интерфейс делает утверждение о
   железке. Ошибка здесь сливает два РАЗНЫХ устройства в одно, и человек об этом не
   узнает: показания просто станут «одной помпой». Поэтому правило под тестами
   целиком, включая случаи, когда предлагать нельзя. */
describe('предложение слить облачную помпу с железкой', () => {
  const облако = (p = {}) => dev({ id: 'ns-pump', kind: 'pump', driverId: null, sourceLabel: 'AndroidAPS-DASH', ...p });
  const железка = (p = {}) => dev({ id: 'medtronic-722:123456', kind: 'pump', driverId: 'medtronic-722', ...p });

  it('обе есть по отдельности — предлагаем, с серийником для вопроса', () => {
    const s = предложениеСлияния(snap([облако(), железка()]));
    expect(s?.облако.sourceLabel).toBe('AndroidAPS-DASH');
    expect(s?.серийник).toBe('123456');
  });

  it('молчим, если показать нечего: без sourceLabel вопрос выродится в «подтвердите нашу догадку»', () => {
    expect(предложениеСлияния(snap([облако({ sourceLabel: null }), железка()]))).toBeNull();
  });

  it('уже слито — не предлагаем переделать сделанное', () => {
    const слитая = железка({
      activeChannel: 'ble-1',
      channels: [
        { id: 'ble-1', kind: 'direct', priority: 0, connection: 'Streaming', status: 'Live', live: true, latestAtMs: 1 },
        { id: 'ns-pump', kind: 'cloud', priority: 10, connection: 'Connected', status: 'Delayed', live: false, latestAtMs: 2 },
      ],
    });
    expect(предложениеСлияния(snap([слитая]))).toBeNull();
  });

  it('одна помпа — сливать не с чем', () => {
    expect(предложениеСлияния(snap([железка()]))).toBeNull();
    expect(предложениеСлияния(snap([облако()]))).toBeNull();
  });

  it('серийник берём из id, а нет — так нет', () => {
    expect(серийникИз('medtronic-722:123456')).toBe('123456');
    expect(серийникИз('medtronic-722')).toBeNull();
    expect(серийникИз('medtronic-722:')).toBeNull();
  });
});


/* Список для «забыть устройство». Ядро подтвердило (SugarLifeCore#26): removeDevice
   на облачный источник НЕ игнорируется — движок снимет его и положит в tombstone,
   и приём данных из Nightscout не вернётся даже после перезапуска. Ошибка здесь не
   портит вид, а тихо выключает человеку мониторинг по кнопке «забыть помпу». */
describe('своиЖелезки', () => {
  it('облачный поток в список на удаление не попадает — ни по kind, ни по каналу', () => {
    const облакоСервис = dev({ id: 'ns-pump', kind: 'service', roles: ['PumpStateSource'] });
    const облакоСтарое = dev({ id: 'ns-pump-old', kind: 'pump', driverId: null });
    const железка = dev({ id: 'mm', kind: 'pump', driverId: 'medtronic-722' });
    expect(своиЖелезки(snap([облакоСервис, облакоСтарое, железка]), 'pump').map((d) => d.id)).toEqual(['mm']);
  });

  it('два инстанса одного сенсора — оба: мёртвый bleId сам не сольётся', () => {
    const живой = dev({ id: 'sib-new', kind: 'sensor', driverId: 'sibionics' });
    const мёртвый = dev({ id: 'sib-old', kind: 'sensor', driverId: 'sibionics', connection: 'Disconnected' });
    expect(своиЖелезки(snap([живой, мёртвый]), 'sensor')).toHaveLength(2);
  });

  it('снимка нет — пусто, а не падение', () => {
    expect(своиЖелезки(null, 'pump')).toEqual([]);
  });
});


/* Круг — самая доверенная цифра в приложении: по ней решают, колоть ли. Состояния
   ожидания в браузере не воспроизводятся, поэтому правило проверяем здесь. */
describe('вид круга глюкозы', () => {
  it('пока догоняем историю — числа нет вовсе', () => {
    expect(видКруга(snap([], { status: 'Acquiring' }))).toBe('ждём');
    expect(видКруга(snap([], { status: 'Connecting' }))).toBe('ждём');
  });

  it('отстало — число остаётся, но приглушённым: важно, от чего человек ушёл', () => {
    expect(видКруга(snap([], { status: 'Delayed' }))).toBe('отстало');
  });

  it('живое — единственное состояние с полноценным числом', () => {
    expect(видКруга(snap([], { status: 'Live' }))).toBe('число');
  });

  it('нет связи — прочерк', () => {
    expect(видКруга(snap([], { status: 'Disconnected' }))).toBe('нет');
  });

  /* Спрятать число на догадке значило бы сломать работающий экран ради состояния,
     о котором нам ничего не сказали. */
  it('старый мост статуса не присылает — показываем как раньше', () => {
    expect(видКруга(snap([]))).toBe('число');
    expect(видКруга(null)).toBe('число');
  });
});
