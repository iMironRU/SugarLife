import { describe, it, expect } from 'vitest';
import { sourceStatusLabel, sourceStatusWarn } from './sourceStatus';

describe('статус источника данных', () => {
  it('«связь есть, показаний ещё нет» — отдельное состояние, а не «подключено»', () => {
    expect(sourceStatusLabel('Acquiring')).toBe('связь есть, показаний ещё нет');
    expect(sourceStatusWarn('Acquiring')).toBe(false); // это норма, а не беда
  });

  it('«отстаёт» и «нет связи» — тревожные, остальное нет', () => {
    expect(sourceStatusWarn('Delayed')).toBe(true);
    expect(sourceStatusWarn('Disconnected')).toBe(true);
    expect(sourceStatusWarn('Live')).toBe(false);
    expect(sourceStatusWarn('Connecting')).toBe(false);
  });

  it('поля нет — не выдумываем подпись', () => {
    expect(sourceStatusLabel(undefined)).toBeNull();
    expect(sourceStatusLabel(null)).toBeNull();
    expect(sourceStatusWarn(undefined)).toBe(false);
  });
});
