import { describe, it, expect } from 'vitest';
import { значенияПараметров, устройствоДляПараметров } from './deviceParams';
import type { DeviceView, UiSnapshot } from '@/sources/bridge';

/* Серийник помпы — параметр ДРАЙВЕРА. Введённый в приложении и осевший в localStorage,
   он для чтения по радио бесполезен: драйвер его не увидит. Человек при этом уверен,
   что ввёл — поле заполнено. Поэтому проверяем не форму, а адресата. */

const dev = (p: Partial<DeviceView>): DeviceView => ({
  id: 'p', name: 'Помпа', kind: 'pump', roles: [], connection: 'Streaming',
  capabilities: {}, settings: { parameters: [] },
  admittedInput: true, admittedOutput: false, testable: false, ...p,
});

const snap = (devices: DeviceView[], roles?: UiSnapshot['roles']): UiSnapshot => ({
  bridgeRevision: '1.8', devices, roles, insights: null, pendingWrites: [], alerts: [],
  monitor: {} as UiSnapshot['monitor'],
});

describe('кому адресованы параметры', () => {
  it('движок знает устройство слота — параметры ему', () => {
    const s = snap([dev({ id: 'p', driverId: 'medtronic' })], [{ role: 'insulin', activeSourceId: 'p' }]);
    expect(устройствоДляПараметров(s, 'pump')?.id).toBe('p');
  });

  it('движка нет — адресата нет, пишем себе', () => {
    expect(устройствоДляПараметров(null, 'pump')).toBe(null);
  });

  /* У глюкометра и петли драйверных параметров нет вовсе — и спрашивать движок про них
     незачем. */
  it('категория без драйвера — молчим', () => {
    expect(устройствоДляПараметров(snap([]), 'meter')).toBe(null);
  });
});

describe('какие значения показывать', () => {
  it('движок ответил — берём его, даже если у нас записано другое', () => {
    const d = dev({ params: { serial: '123456' } });
    expect(значенияПараметров(d, { serial: '999999' })).toEqual({ serial: '123456' });
  });

  /* Полупустая форма честнее, чем поле, заполненное из нашего кэша: иначе человек не
     отличит «драйвер это знает» от «мы это помним». */
  it('движок знает про параметры, но их нет — форма пустая, а не из кэша', () => {
    expect(значенияПараметров(dev({ params: {} }), { serial: '999999' })).toEqual({});
  });

  it('движок про параметры молчит — показываем локальные', () => {
    expect(значенияПараметров(dev({}), { serial: '999999' })).toEqual({ serial: '999999' });
    expect(значенияПараметров(null, { serial: '999999' })).toEqual({ serial: '999999' });
  });
});
