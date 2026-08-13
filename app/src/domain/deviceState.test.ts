import { describe, it, expect } from 'vitest';
import { связь, источникГлюкозы, источникПомпы, связьГлюкозы, предложениеСлияния, серийникИз, своиЖелезки, видКруга, черезЧто, активныйКанал, черезЧтоСпорное, устройствоРоли, рольСнимка, лучшийИсточник } from './deviceState';
import type { DeviceView, RoleView, UiSnapshot } from '@/sources/bridge';

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

/* «Через что» — половина ответа на вопрос «почему помпа на связи, а мост нет»
   (SugarLifeCore#34). Ошибка здесь не видна глазами: строка есть, читается складно и
   врёт — человек идёт менять батарейку в мосте, который ни при чём. */
describe('через какой канал пришло состояние', () => {
  const кан = (p: Partial<NonNullable<DeviceView['channels']>[number]>) => ({
    id: 'c', kind: 'direct' as const, priority: 0, connection: 'Streaming' as const,
    status: 'Live' as const, live: true, latestAtMs: null, ...p,
  });

  it('облачный активный канал называем облаком, даже если рядом есть прямой', () => {
    const d = dev({ status: 'Live', activeChannel: 'ns', channels: [
      кан({ id: 'ble', kind: 'direct', status: 'Disconnected', live: false, connection: 'Disconnected' }),
      кан({ id: 'ns', kind: 'cloud' }),
    ] });
    expect(черезЧто(d)).toBe('через Nightscout');
    expect(активныйКанал(d)?.id).toBe('ns');
  });

  it('прямой канал — «по радио», мост — «через мост»', () => {
    expect(черезЧто(dev({ status: 'Live', activeChannel: 'ble', channels: [кан({ id: 'ble' })] }))).toBe('по радио');
    expect(черезЧто(dev({ status: 'Live', activeChannel: 'br', channels: [кан({ id: 'br', kind: 'bridged' })] })))
      .toBe('через мост');
  });

  /* Связи нет — путь называть незачем: «нет связи по радио» звучит как «попробуйте
     другой путь», а другого нет, движок взял бы его сам. */
  it('нет связи — про канал молчим', () => {
    expect(черезЧто(dev({ status: 'Disconnected', activeChannel: 'ble', channels: [кан({ id: 'ble' })] }))).toBe(null);
  });

  it('каналов нет — не выдумываем', () => {
    expect(черезЧто(dev({ status: 'Live' }))).toBe(null);
    expect(черезЧто(null)).toBe(null);
  });

  /* Движок может не проставить activeChannel — берём первый, а не молчим: канал
     всё равно один из перечисленных, и это ближе к правде, чем пустота. */
  it('активный не назван — берём первый', () => {
    expect(черезЧто(dev({ status: 'Live', channels: [кан({ id: 'ns', kind: 'cloud' })] }))).toBe('через Nightscout');
  });

  /* На панели слово стоит места, и платить им за «радио» у одноканального сенсора
     нечем: выбора там нет, объяснять нечего. */
  it('канал один — на панели про него молчим', () => {
    expect(черезЧтоСпорное(dev({ status: 'Live', activeChannel: 'ble', channels: [кан({ id: 'ble' })] }))).toBe(null);
  });

  it('каналов два — панель называет активный коротко', () => {
    const d = dev({ status: 'Live', activeChannel: 'ns', channels: [кан({ id: 'ble' }), кан({ id: 'ns', kind: 'cloud' })] });
    expect(черезЧтоСпорное(d)).toBe('облако');
  });

  /* Ровно тот случай, ради которого всё это затевалось: помпу видно только через
     облако. Точка связи о ней молчит (и правильно — прямой связи нет), но сказать,
     откуда взялись резервуар и заряд, обязаны. */
  it('облачную помпу для «через что» берём, хотя для точки связи её нет', () => {
    const p = dev({ id: 'p', kind: 'pump', status: 'Live', activeChannel: 'ns',
      channels: [кан({ id: 'ns', kind: 'cloud' })] });
    const s = snap([p]);
    expect(источникПомпы(s)).toBe(null);
    expect(черезЧто(устройствоРоли(s, 'pump'))).toBe('через Nightscout');
  });

  it('сенсор роли — тот же, что источник глюкозы', () => {
    const a = dev({ id: 'a', kind: 'sensor' });
    const b = dev({ id: 'b', kind: 'sensor', primary: true });
    expect(устройствоРоли(snap([a, b]), 'sensor')?.id).toBe('b');
  });
});

/* Роли из снимка (SugarLifeCore#34). Правило у нас с движком одно, но реализаций две —
   наша на время, пока роли не приехали, и их постоянная. Тесты держат границу: чей
   ответ главнее и что считать ответом «источника нет». */
describe('роль из снимка движка', () => {
  const сСнимком = (roles: RoleView[], devices: DeviceView[]): UiSnapshot =>
    ({ ...snap(devices), roles });

  it('движок назвал источник — берём его, а не считаем сами', () => {
    const свой = dev({ id: 'ble', kind: 'sensor', primary: true });
    const чужой = dev({ id: 'ns', kind: 'sensor' });
    const s = сСнимком([{ role: 'cgm', activeSourceId: 'ns' }], [свой, чужой]);
    expect(устройствоРоли(s, 'sensor')?.id).toBe('ns');
  });

  /* «Роль есть, источника нет» — это ответ движка, а не дырка в данных. Свалиться
     обратно на свой расчёт значило бы показать источник там, где движок его не видит. */
  it('роль без источника — источника нет, а не «посчитаем сами»', () => {
    const s = сСнимком([{ role: 'insulin', activeSourceId: null }], [dev({ id: 'p', kind: 'pump' })]);
    expect(устройствоРоли(s, 'pump')).toBe(null);
  });

  it('ролей в снимке нет — работает прежнее правило', () => {
    const s = snap([dev({ id: 'p', kind: 'pump' })]);
    expect(устройствоРоли(s, 'pump')?.id).toBe('p');
  });

  /* Подача — одна роль: помпа и ручка два способа одного дела. Способ читаем с роли,
     чтобы не гадать по виду устройства. */
  it('способ подачи берём с роли', () => {
    const s = сСнимком([{ role: 'insulin', activeSourceId: 'p', method: 'pen' }], [dev({ id: 'p', kind: 'pump' })]);
    expect(рольСнимка(s, 'pump')?.method).toBe('pen');
  });

  it('via с роли главнее собственного разбора каналов', () => {
    const d = dev({ status: 'Live' });
    expect(черезЧто(d, 'bridged')).toBe('через мост');
    expect(черезЧто(dev({ status: 'Disconnected' }), 'bridged')).toBe(null);
  });
});

/* Кто наполняет слот. У ядра это был живой баг (SugarLifeCore#43): облако поднимается
   раньше BLE, и в слоте подачи навсегда оказывалось облако — даже когда железная помпа
   рядом и на связи. Экран честно повторял за ним «через Nightscout». */
describe('источник, который реально даёт данные', () => {
  const облако = dev({ id: 'ns', kind: 'pump', driverId: null, status: 'Live' });
  const железо = (status: DeviceView['status']) =>
    dev({ id: 'ble', kind: 'pump', driverId: 'medtronic', status });

  it('порядок регистрации больше не решает', () => {
    expect(лучшийИсточник([облако, железо('Live')])?.id).toBe('ble');
    expect(лучшийИсточник([железо('Live'), облако])?.id).toBe('ble');
  });

  /* Качество важнее происхождения: молчащая помпа хуже живого облака, и делать вид,
     что данные идут от железа, значит врать о свежести. */
  it('живое облако побеждает отставшее железо', () => {
    expect(лучшийИсточник([железо('Delayed'), облако])?.id).toBe('ns');
  });

  it('при равном качестве предпочитаем железо — с ним человек может что-то сделать', () => {
    const оба = [dev({ id: 'ns', kind: 'pump', driverId: null, status: 'Delayed' }), железо('Delayed')];
    expect(лучшийИсточник(оба)?.id).toBe('ble');
  });

  it('пусто — null, а не падение', () => {
    expect(лучшийИсточник([])).toBe(null);
  });

  /* Явный выбор человека сильнее любого качества: он для того и явный. */
  it('primary у сенсора перебивает правило качества', () => {
    const слабый = dev({ id: 'a', kind: 'sensor', status: 'Delayed', primary: true });
    const живой = dev({ id: 'b', kind: 'sensor', status: 'Live' });
    expect(источникГлюкозы(snap([живой, слабый]))?.id).toBe('a');
  });
});

