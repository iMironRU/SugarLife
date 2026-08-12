import { describe, it, expect, beforeEach } from 'vitest';
import { checkBridgeBattery, getBridgeAlert, setBridgeAlert } from './bridgeAlerts';

/* Проверяем правило «когда предупреждать», а не само уведомление: платформенный вызов
   в тестах не подержать, а вот «дёргает двадцать раз подряд» и «промолчал на второй
   разряд» — это здесь. */

const уведомлено = () => getBridgeAlert().firedAt;

describe('предупреждение о разряде моста', () => {
  beforeEach(() => { setBridgeAlert({ on: true, threshold: 20, firedAt: null }); });

  it('выше порога молчим', () => {
    checkBridgeBattery(35);
    expect(уведомлено()).toBeNull();
  });

  it('упало ниже порога — предупреждаем один раз', () => {
    checkBridgeBattery(18);
    expect(уведомлено()).toBe(18);
    // дальше сыплются те же снимки — второй раз дёргать нельзя
    checkBridgeBattery(17);
    checkBridgeBattery(15);
    expect(уведомлено()).toBe(18);
  });

  it('батарейку поменяли — снова готовы предупредить', () => {
    checkBridgeBattery(18);
    checkBridgeBattery(95);              // заряд вырос — это замена
    expect(уведомлено()).toBeNull();
    checkBridgeBattery(12);
    expect(уведомлено()).toBe(12);       // следующий разряд не пройдёт молча
  });

  it('дрожание шкалы заменой не считается', () => {
    checkBridgeBattery(18);
    checkBridgeBattery(30);              // +12 — это шкала, а не новая батарейка
    expect(уведомлено()).toBe(18);
  });

  it('выключено — молчим даже на нуле', () => {
    setBridgeAlert({ on: false });
    checkBridgeBattery(1);
    expect(уведомлено()).toBeNull();
  });

  it('нет данных о заряде — ничего не выдумываем', () => {
    checkBridgeBattery(null);
    checkBridgeBattery(undefined);
    checkBridgeBattery(NaN);
    expect(уведомлено()).toBeNull();
  });
});
