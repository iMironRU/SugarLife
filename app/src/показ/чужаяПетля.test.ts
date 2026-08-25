import { describe, it, expect } from 'vitest';
import { выбрать, ктоСчитал } from './чужаяПетля';
import type { Monitor } from '@/sources/bridge';
import type { Device } from '@/domain/types';

const монитор = (p: Partial<Monitor>): Monitor => ({
  glucose: '7,2', glucoseMmol: 7.2, trend: 'Stable', link: 'ok' as never,
  reservoir: '', battery: '', confirmedIOB: 0, assumedIOB: 0, conservativeIOB: 0, ...p,
} as Monitor);

const прибор = (p: Partial<Device>): Device => ({ iob: null, cob: null, loopAt: null, ...p } as Device);

describe('откуда числа петли', () => {
  it('движок сказал — верим ему, а не веб-слою', () => {
    const р = выбрать(монитор({ loopIOB: 1.2, loopCOB: 14, loopAtMs: 1000, loopBy: 'AndroidAPS' }),
      прибор({ iob: 9, cob: 90, loopAt: 500 }));
    expect(р).toEqual({ iob: 1.2, cob: 14, loopAt: 1000, by: 'AndroidAPS' });
  });

  it('под числом стоит имя программы, а не модель телефона', () => {
    /* Владелец увидел «по расчёту openaps://Xiaomi 2410FPCC5G»: он спрашивал, чей это расчёт, а
       получил имя собственного телефона. */
    expect(ктоСчитал('openaps://Xiaomi 2410FPCC5G')).toBe('AndroidAPS');
    expect(ктоСчитал('loop://iPhone')).toBe('Loop');
  });

  it('незнакомого автора не выдумываем, только подрезаем', () => {
    expect(ктоСчитал('Trio')).toBe('Trio');
    expect(ктоСчитал('a'.repeat(40))).toHaveLength(24);
    expect(ктоСчитал('   ')).toBeNull();
    expect(ктоСчитал(null)).toBeNull();
  });

  it('движок молчит — прежний путь, чтобы экран не опустел', () => {
    /* Старое ядро и браузерный шим полей не знают. Отдать пусто значило бы сказать «инсулина нет»
       там, где он есть, — то самое враньё в сторону опасности. */
    const р = выбрать(монитор({}), прибор({ iob: 0.8, cob: 0, loopAt: 700 }));
    expect(р).toEqual({ iob: 0.8, cob: 0, loopAt: 700, by: null });
  });

  it('расчёт без углеводов не отправляет нас обратно к веб-слою', () => {
    /* Иначе инсулин был бы от движка, углеводы — от веба, и они разъехались бы во времени. */
    const р = выбрать(монитор({ loopIOB: 0.4, loopAtMs: 1000, loopBy: 'iAPS' }),
      прибор({ iob: 9, cob: 90, loopAt: 500 }));
    expect(р.cob).toBeNull();
    expect(р.loopAt).toBe(1000);
  });

  it('нет ни того, ни другого — пусто, а не нули', () => {
    /* Ноль читается как «инсулина нет», и по нему человек может уколоть лишнего. */
    expect(выбрать(null, null)).toEqual({ iob: null, cob: null, loopAt: null, by: null });
  });
});
