import { describe, it, expect } from 'vitest';
import { порогМолчанияМин } from './порогМолчания';
import type { AlarmRuleView } from '@/sources/bridge';

const правило = (settings: Record<string, string>): AlarmRuleView =>
  ({ id: 'silence', level: 'wake', kind: 'silence', settings });

describe('порогМолчанияМин', () => {
  const оба = [правило({ 'alarms.silence.dayMin': '20', 'alarms.silence.sleepMin': '15' })];

  it('день и сон — разные числа, и спрашивающий говорит какое', () => {
    expect(порогМолчанияМин(оба, 'день')).toBe(20);
    expect(порогМолчанияМин(оба, 'сон')).toBe(15);
  });

  it('порядок ключей ответа не меняет', () => {
    const наоборот = [правило({ 'alarms.silence.sleepMin': '15', 'alarms.silence.dayMin': '20' })];
    expect(порогМолчанияМин(наоборот, 'день')).toBe(20);
    expect(порогМолчанияМин(наоборот, 'сон')).toBe(15);
  });

  it('нужного ключа нет — null, а не соседнее число', () => {
    const толькоДень = [правило({ 'alarms.silence.dayMin': '20' })];
    expect(порогМолчанияМин(толькоДень, 'сон')).toBeNull();
  });

  it('правила про молчание нет вовсе', () => {
    expect(порогМолчанияМин([правило({})], 'сон')).toBeNull();
    expect(порогМолчанияМин([], 'день')).toBeNull();
    expect(порогМолчанияМин(null, 'день')).toBeNull();
  });

  it('не число — не ответ', () => {
    expect(порогМолчанияМин([правило({ 'alarms.silence.sleepMin': 'скоро' })], 'сон')).toBeNull();
  });
});
