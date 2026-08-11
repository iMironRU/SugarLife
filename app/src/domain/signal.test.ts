import { describe, it, expect } from 'vitest';
import { близость } from './signal';

describe('уровень сигнала словами', () => {
  it('вытянутая рука — «рядом»', () => {
    expect(близость(-45)).toBe('рядом');
    expect(близость(-60)).toBe('рядом');
  });
  it('соседняя комната — «недалеко», дальше — «далеко»', () => {
    expect(близость(-61)).toBe('недалеко');
    expect(близость(-80)).toBe('недалеко');
    expect(близость(-81)).toBe('далеко');
  });
  it('нет значения — ничего не пишем, а не «далеко»', () => {
    expect(близость(null)).toBeUndefined();
    expect(близость(undefined)).toBeUndefined();
    expect(близость(NaN)).toBeUndefined();
  });
});
