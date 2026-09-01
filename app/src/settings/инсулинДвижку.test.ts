import { describe, it, expect, vi, beforeEach } from 'vitest';

/* Выбранный инсулин уходит движку (#674).

   Сторожим три вещи, и все три — про молчание: настройка, которая никуда не уходит; выбор,
   отправленный дважды подряд; и снятый выбор, о котором движку не сказали. Первое мы уже
   прожили: `fastInsulinId` лежал только у нас, а активный инсулин считался по умолчаниям. */

const посланное: Array<Record<string, string | null>> = [];
vi.mock('@/sources/bridge', () => ({
  sendIntent: async (i: { patch: Record<string, string | null> }) => { посланное.push(i.patch); return { accepted: true }; },
}));

const { setDeviceConfig } = await import('./deviceConfig');
const { следитьЗаИнсулином, отдатьИнсулинДвижку, забытьОтправленное } = await import('./инсулинДвижку');

beforeEach(() => {
  посланное.length = 0;
  забытьОтправленное();
  setDeviceConfig({ fastInsulinId: null });
  посланное.length = 0;
});

describe('инсулин движку', () => {
  it('при старте отправляем то, что выбрано', () => {
    setDeviceConfig({ fastInsulinId: 'fiasp' });
    забытьОтправленное();
    посланное.length = 0;
    const стоп = следитьЗаИнсулином();
    expect(посланное).toEqual([{ 'insulin.type': 'fiasp' }]);
    стоп();
  });

  it('смена выбора доезжает сама', () => {
    const стоп = следитьЗаИнсулином();
    посланное.length = 0;
    setDeviceConfig({ fastInsulinId: 'humalog' });
    expect(посланное).toEqual([{ 'insulin.type': 'humalog' }]);
    стоп();
  });

  /* Снимок и настройки шевелятся часто, а инсулин человек меняет раз в год: слать одно и то же
     каждую минуту значит топить настоящую правку в шуме. */
  it('одно и то же дважды не шлём', () => {
    const стоп = следитьЗаИнсулином();
    setDeviceConfig({ fastInsulinId: 'humalog' });
    посланное.length = 0;
    setDeviceConfig({ pumpBatteryKind: null });   // изменилось другое
    отдатьИнсулинДвижку();
    expect(посланное).toEqual([]);
    стоп();
  });

  /* Убрал выбор — движок обязан забыть прежний инсулин. Расчёт по позавчерашнему выбору хуже
     расчёта по умолчанию: он выглядит настроенным. */
  it('снятый выбор отправляем пустым, а не молчим', () => {
    const стоп = следитьЗаИнсулином();
    setDeviceConfig({ fastInsulinId: 'humalog' });
    посланное.length = 0;
    setDeviceConfig({ fastInsulinId: null });
    expect(посланное).toEqual([{ 'insulin.type': null }]);
    стоп();
  });

  it('отписались — больше не шлём', () => {
    const стоп = следитьЗаИнсулином();
    стоп();
    посланное.length = 0;
    setDeviceConfig({ fastInsulinId: 'apidra' });
    expect(посланное).toEqual([]);
  });
});
