import { describe, it, expect } from 'vitest';
import { canStartBack, shouldGoBack, КРАЙ_PX } from './backGesture';

const ЭКРАН = 390;

describe('жест «назад»: откуда начинается', () => {
  it('начинается только от левой кромки', () => {
    expect(canStartBack(0)).toBe(true);
    expect(canStartBack(КРАЙ_PX)).toBe(true);
    expect(canStartBack(КРАЙ_PX + 1)).toBe(false);
  });

  it('из середины не начинается — там живут горизонтальные списки', () => {
    expect(canStartBack(ЭКРАН / 2)).toBe(false);
  });
});

describe('жест «назад»: закрывать или вернуть', () => {
  it('дотянул далеко — закрываем, даже медленно', () => {
    expect(shouldGoBack(ЭКРАН * 0.4, ЭКРАН, 0)).toBe(true);
  });

  it('короткий, но быстрый флик — тоже закрываем', () => {
    expect(shouldGoBack(40, ЭКРАН, 0.8)).toBe(true);
  });

  it('короткий и медленный — возвращаем на место', () => {
    // случайное касание кромки при прокрутке не должно закрывать страницу
    expect(shouldGoBack(20, ЭКРАН, 0.05)).toBe(false);
  });

  it('движение влево ничего не закрывает', () => {
    expect(shouldGoBack(-200, ЭКРАН, 0)).toBe(false);
    expect(shouldGoBack(-10, ЭКРАН, 5)).toBe(false); // даже быстрое
  });

  it('нулевая ширина не делит на ноль и не закрывает всё подряд', () => {
    expect(shouldGoBack(0, 0, 0)).toBe(false);
  });
});
