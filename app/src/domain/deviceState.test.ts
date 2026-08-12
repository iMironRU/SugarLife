import { describe, it, expect } from 'vitest';
import { связь, источникГлюкозы, источникПомпы, связьГлюкозы } from './deviceState';
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

  /* Живое облако — не живая помпа. Помпа молчит час, Nightscout бодро отдаёт
     последний известный документ, и метка сказала бы «на связи» про железку, о
     которой ничего не слышно. */
  it('помпа — только помпа: сервис с ролью PumpStateSource за неё не отвечает', () => {
    const ns = dev({ id: 'nightscout', kind: 'service', roles: ['PumpStateSource'] });
    const pump = dev({ id: 'mm', kind: 'pump' });
    expect(источникПомпы(snap([ns, pump]))?.id).toBe('mm');
    expect(источникПомпы(snap([ns]))).toBeNull();
    expect(связь(источникПомпы(snap([ns])))).toBe('unknown');
  });
});

describe('связьГлюкозы', () => {
  it('состояние устройства точнее монитора, пока их считают порознь', () => {
    const s = snap([dev({ kind: 'sensor', status: 'Live' })], { status: 'Disconnected', live: false });
    expect(связьГлюкозы(s)).toBe('live');
  });

  it('устройство статуса не прислало — отвечает монитор', () => {
    const s = snap([dev({ kind: 'sensor', connection: 'ЧтоТоНовое' })], { status: 'Acquiring' });
    expect(связьГлюкозы(s)).toBe('wait');
  });

  /* Живой сокет ≠ идущие данные. Nightscout-шим отдаёт устройство с одним линком,
     и без этого правила молчащий источник получил бы зелёную точку. */
  it('у устройства только линк — монитор перебивает: он про данные, линк про соединение', () => {
    const s = snap([dev({ kind: 'sensor', connection: 'Streaming' })], { status: 'Delayed' });
    expect(связьГлюкозы(s)).toBe('wait');
  });

  it('монитор тоже молчит — остаётся линк, лучше него ничего нет', () => {
    const s = snap([dev({ kind: 'sensor', connection: 'Streaming' })]);
    expect(связьГлюкозы(s)).toBe('live');
  });

  it('снимка нет — молчим, а не рисуем обрыв', () => {
    expect(связьГлюкозы(null)).toBe('unknown');
  });
});
