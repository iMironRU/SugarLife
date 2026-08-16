import { describe, it, expect } from 'vitest';
import { источникиСлота, причинаСлота, наполненЛи } from './sources';
import type { DeviceView, RoleView, UiSnapshot } from '@/sources/bridge';

/* Слоты «откуда берутся данные» (SugarLife#277). Ошибка здесь не падает: она молча
   показывает не тот источник или молчит о том, что данные идут обходным путём. */

const dev = (p: Partial<DeviceView>): DeviceView => ({
  id: 'd', name: 'D', kind: 'sensor', roles: [], connection: 'Streaming', status: 'Live',
  capabilities: {}, settings: { parameters: [] },
  admittedInput: true, admittedOutput: false, testable: false, ...p,
});

const snap = (devices: DeviceView[], roles?: RoleView[]): UiSnapshot => ({
  bridgeRevision: '1.13', devices, roles,
  insights: null, pendingWrites: [], alerts: [],
  monitor: {} as UiSnapshot['monitor'],
});

describe('источники слота сахара', () => {
  /* Глюкометр не заводит своего слота: он даёт то же число, только дискретно. В
     контракте он приезжает обычным источником глюкозы, поэтому ловим по роли, а не по
     виду устройства — проверка вида молча пропустила бы его. */
  it('глюкометр — источник сахара, а не отдельная строка', () => {
    const s = snap([dev({ id: 'm', name: 'Contour', kind: 'service', roles: ['GlucoseSource'] })]);
    expect(источникиСлота(s, 'сахар').map((и) => и.имя)).toContain('Contour');
  });

  /* Ручной ввод доступен всегда — единственный источник, который не может отвалиться.
     И никогда не «сейчас»: он не поток, он дополняет. */
  it('ручной ввод есть всегда и не бывает активным', () => {
    const руками = источникиСлота(snap([]), 'сахар').find((и) => и.id === 'руками');
    expect(руками?.активен).toBe(false);
    expect(руками?.живой).toBe(true);
  });

  it('у инсулина ручного ввода нет: инсулин вносят событием, а не источником', () => {
    expect(источникиСлота(snap([]), 'инсулин').some((и) => и.id === 'руками')).toBe(false);
  });
});

describe('когда объясняем обходной путь', () => {
  /* driverId обязателен: без него устройство считается облачным по построению
     (domain/deviceState.ts), и «прямого пути нет вовсе» — объяснять было бы нечего. */
  const сенсор = dev({ id: 's', name: 'Sibionics GS1', kind: 'sensor', roles: ['GlucoseSource'],
    driverId: 'sibionics', connection: 'Disconnected', status: 'Disconnected' });
  const облако = dev({ id: 'ns', name: 'Nightscout', kind: 'service', roles: ['GlucoseSource'],
    channels: [{ id: 'c', kind: 'cloud', priority: 10, connection: 'Streaming', status: 'Delayed', live: false, latestAtMs: null }],
    activeChannel: 'c' });

  it('данные идут облаком, а прибор молчит — говорим почему', () => {
    const s = snap([сенсор, облако], [{ role: 'cgm', activeSourceId: 'ns', via: 'cloud' }]);
    expect(причинаСлота(s, 'сахар')).toMatch(/Sibionics GS1/);
  });

  /* Слово движка сильнее нашего: он знает, ЧТО именно молчит (rev 1.13). */
  it('движок объяснил сам — берём его фразу как есть', () => {
    const s = snap([сенсор, облако], [{ role: 'cgm', activeSourceId: 'ns', via: 'cloud',
      fallbackReason: 'Medtronic 722 не на связи' }]);
    expect(причинаСлота(s, 'сахар')).toBe('Medtronic 722 не на связи');
  });

  it('путь прямой — объяснять нечего', () => {
    const живой = dev({ id: 's', kind: 'sensor', roles: ['GlucoseSource'], driverId: 'sibionics' });
    const s = snap([живой], [{ role: 'cgm', activeSourceId: 's', via: 'direct' }]);
    expect(причинаСлота(s, 'сахар')).toBe(null);
  });
});

describe('наполнен ли слот', () => {
  /* Пустой слот — не «всё хорошо»: зелёная точка там была бы обещанием, которого никто
     не давал. Но и не поломка: ядро отдельно просило не показывать пустоту как беду,
     иначе научим человека игнорировать предупреждения. */
  it('источника нет — слот не наполнен', () => {
    expect(наполненЛи(snap([]), 'сахар')).toBe(false);
  });

  it('углеводы наполнены всегда: их вносит человек', () => {
    expect(наполненЛи(snap([]), 'углеводы')).toBe(true);
  });
});

/* Два источника из одного Nightscout (замечание с телефона: «почему тут два одинаковых»).

   Дубля нет: сервер один, а потоки разные — состояние помпы и записи о подачах. Пока
   оба подписаны просто «облако», выбор между ними выглядит выбором между одинаковым. */
describe('что приносит облачный источник', () => {
  const облако = (id: string, name: string, роль: string) =>
    dev({ id, name, kind: 'pump', roles: [роль], connection: 'Disconnected', status: 'Live' });

  it('в слоте инсулина потоки одного сервера различимы', () => {
    const s = snap([
      облако('ns-pump', 'Внешняя помпа', 'PumpStateSource'),
      облако('ns-tr', 'Лечение', 'DeliveryHistorySource'),
    ]);
    const п = источникиСлота(s, 'инсулин');
    expect(п.map((и) => и.подпись)).toEqual([
      'облако · остаток, заряд, базал',
      'облако · записи о болюсах',
    ]);
  });

  /* У сахара облачный источник один, и уточнение читалось бы как намёк на второй,
     которого нет. Молчать здесь — не лень, а отсутствие лишнего слова. */
  it('в слоте сахара уточнения нет', () => {
    const s = snap([dev({ id: 'ns', name: 'Внешний CGM', kind: 'sensor', roles: ['GlucoseSource'], connection: 'Disconnected' })]);
    expect(источникиСлота(s, 'сахар')[0].подпись).toBe('облако');
  });

  /* Роль незнакомая — не выдумываем, чем этот источник полезен. */
  it('роль неизвестна — просто «облако»', () => {
    const s = snap([облако('x', 'Что-то', 'НечтоНовое')]);
    expect(источникиСлота(s, 'инсулин')[0].подпись).toBe('облако');
  });
});
