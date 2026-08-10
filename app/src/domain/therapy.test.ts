import { describe, it, expect } from 'vitest';
import { detectTherapy, therapyLabel } from './therapy';
import type { Device, Treatment } from './types';

/* Определение режима терапии решает, как выглядит всё приложение: у ручки нет
   базала и резервуара, у помпы есть, у петли ещё и статус цикла. Ошибка здесь —
   не косметика, а показ чужого интерфейса. */

const л = (t: string, extra: Partial<Treatment> = {}): Treatment =>
  ({ t: Date.now(), type: t, carbs: null, insulin: null, rate: null, duration: null, ...extra }) as Treatment;

describe('режим терапии', () => {
  it('нет данных — считаем ручкой: самый скромный интерфейс, ничего не обещаем', () => {
    expect(detectTherapy(null)).toBe('pen');
    expect(detectTherapy({})).toBe('pen');
  });

  it('петля важнее помпы: замкнутый цикл — это тоже помпа, но интерфейс другой', () => {
    expect(detectTherapy({ device: { loop: true, pump: true } as unknown as Device })).toBe('loop');
  });

  it('резервуар выдаёт помпу, даже если поля pump нет', () => {
    expect(detectTherapy({ device: { reservoir: 120 } as unknown as Device })).toBe('pump');
  });

  it('перевес временных базалов над болюсами — тоже помпа', () => {
    const ts = [л('Temp Basal'), л('Temp Basal'), л('Bolus', { insulin: 2 })];
    expect(detectTherapy({ treatments: ts })).toBe('pump');
  });

  it('одни болюсы без базала — ручка', () => {
    expect(detectTherapy({ treatments: [л('Bolus', { insulin: 6 }), л('Bolus', { insulin: 4 })] })).toBe('pen');
  });

  it('подписи не перепутаны', () => {
    expect(therapyLabel('loop')).toBe('Замкнутый цикл');
    expect(therapyLabel('pump')).toBe('Помпа');
    expect(therapyLabel('pen')).toBe('Шприц-ручка');
  });
});
