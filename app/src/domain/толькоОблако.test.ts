import { describe, it, expect } from 'vitest';
import { толькоОблако } from './толькоОблако';
import type { UiSnapshot, HardwareView } from '@/sources/bridge';

const сн = (hardware: HardwareView[]): UiSnapshot =>
  ({ hardware, devices: [], discovered: [] } as unknown as UiSnapshot);

const ж = (p: Partial<HardwareView>): HardwareView =>
  ({ id: 'ns-cgm', name: 'Внешний CGM', kind: 'sensor', connection: 'Streaming', ...p } as HardwareView);

/* Связка «только облако» решает, работает ли приложение на заблокированном телефоне (#578).
   Ошибиться здесь дорого в обе стороны: промолчать — оставить человека без охраны молча,
   предупредить лишний раз — приучить не читать предупреждения. */
describe('только облако', () => {
  it('облачный источник без адреса в эфире — да', () => {
    expect(толькоОблако(сн([ж({})]))).toBe(true);
  });

  it('сенсор с адресом в эфире — нет: от него нас разбудят', () => {
    expect(толькоОблако(сн([ж({ id: 'AA:BB:CC:DD:EE:FF', bleId: 'aa:bb:cc:dd:ee:ff' })]))).toBe(false);
  });

  /* Достаточно ОДНОГО прибора по эфиру: он будит приложение, и облачные источники
     дочитываются в то же пробуждение. */
  it('облако плюс один прибор по эфиру — нет', () => {
    expect(толькоОблако(сн([ж({}), ж({ id: 'p1', bleId: 'aa:bb:cc:dd:ee:ff', kind: 'pump' })]))).toBe(false);
  });

  it('серийник тоже считается адресом: прибор известен и достижим', () => {
    expect(толькоОблако(сн([ж({ id: 'x', serial: 'XDUD671K' } as Partial<HardwareView>)]))).toBe(false);
  });

  it('источников нет вовсе — не наш случай, молчим', () => {
    expect(толькоОблако(сн([]))).toBe(false);
    expect(толькоОблако(null)).toBe(false);
  });
});
