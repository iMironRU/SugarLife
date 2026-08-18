import { describe, it, expect } from 'vitest';
import { значенияПараметров, устройствоДляПараметров, спроситьЛи, нехватает } from './deviceParams';
import type { DeviceView, UiSnapshot, Param, DriverDescriptor, Discovered } from '@/sources/bridge';

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

/* Что спрашивать до заведения прибора (SugarLife#349).

   Проверяем не «работает», а что прибор НЕ МОЖЕТ завестись без обязательного поля.
   Ошибка здесь не падает: сенсор без кода показывает «на связи» и молчит навсегда — то
   есть приложение утверждает, что работает, а проверить это человеку нечем. */
describe('обязательные параметры прибора', () => {
  const пар = (p: Partial<Param>): Param => ({
    key: 'k', title: 'Поле', type: 'Text', required: false, default: null, options: [], ...p,
  } as Param);
  const драйвер = (parameters: Param[], id = 'sib'): DriverDescriptor => ({
    id, displayName: 'Д', kind: 'sensor', roles: [], available: true, settings: { parameters },
  } as DriverDescriptor);
  const снимок = (d: DriverDescriptor[]): UiSnapshot => ({ availableDrivers: d } as UiSnapshot);
  const вЭфире = (p: Partial<Discovered> = {}): Discovered => ({
    bleId: 'AA', name: 'GS1', displayName: 'GS1', driverId: 'sib', rssi: -50,
    needsMoreParams: false, isTransport: false, transportFor: [], knownDeviceId: null, ...p,
  } as Discovered);

  it('обязательное поле без ответа — спрашиваем, даже когда движок молчит', () => {
    const s = снимок([драйвер([пар({ key: 'sensorCode', required: true })])]);
    expect(спроситьЛи(s, вЭфире())).toBe(true);
  });

  /* Поле с ответом по умолчанию обязательным не считаем: «подтвердите авто» — это
     задержка ради нашей строгости, а не вопрос. */
  it('обязательное, но со значением по умолчанию — не спрашиваем', () => {
    const s = снимок([драйвер([пар({ key: 'region', required: true, default: 'auto' })])]);
    expect(спроситьЛи(s, вЭфире())).toBe(false);
  });

  it('спрашивать нечего — заводим сразу', () => {
    expect(спроситьЛи(снимок([драйвер([])]), вЭфире())).toBe(false);
  });

  /* Драйвера в снимке может не быть вовсе (старый мост, незнакомый прибор). Молчим и
     полагаемся на признак движка — выдумывать обязательные поля нам не из чего. */
  it('драйвер незнаком — решает признак движка', () => {
    expect(спроситьЛи(снимок([]), вЭфире({ driverId: 'нет' }))).toBe(false);
    expect(спроситьЛи(снимок([]), вЭфире({ driverId: 'нет', needsMoreParams: true }))).toBe(true);
  });

  it('мост спрашиваем всегда: через него подключают не его', () => {
    expect(спроситьЛи(снимок([драйвер([])]), вЭфире({ isTransport: true }))).toBe(true);
  });

  it('нехватает считает только незаполненное', () => {
    const d = драйвер([пар({ key: 'code', required: true }), пар({ key: 'note' })]);
    expect(нехватает(d, {}).map((p) => p.key)).toEqual(['code']);
    expect(нехватает(d, { code: '  ' }).map((p) => p.key)).toEqual(['code']);
    expect(нехватает(d, { code: 'A1' })).toEqual([]);
  });
});
