import { describe, it, expect, vi, beforeEach } from 'vitest';

/* Выбранный инсулин уходит движку (#674).

   Сторожим три вещи, и все три — про молчание: настройка, которая никуда не уходит; выбор,
   отправленный дважды подряд; и снятый выбор, о котором движку не сказали. Первое мы уже
   прожили: `fastInsulinId` лежал только у нас, а активный инсулин считался по умолчаниям.

   Четвёртое добавилось с классом действия (ядро #789): имя без класса ядро связать с кривой не
   может, а класс от прежнего инсулина рядом с новым именем — расчёт по чужой кривой. Поэтому оба
   поля обязаны ехать вместе, одним патчем. */

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
    expect(посланное).toEqual([{ 'insulin.type': 'fiasp', 'insulin.actionClass': 'ультрабыстрый' }]);
    стоп();
  });

  it('смена выбора доезжает сама', () => {
    const стоп = следитьЗаИнсулином();
    посланное.length = 0;
    setDeviceConfig({ fastInsulinId: 'humalog' });
    expect(посланное).toEqual([{ 'insulin.type': 'humalog', 'insulin.actionClass': 'УКД' }]);
    стоп();
  });

  /* РАЗНЫЕ КЛАССЫ У ОДНОГО ВЕЩЕСТВА — ЭТО И ЕСТЬ СМЫСЛ ПОЛЯ (ядро #789).

     Fiasp и NovoRapid оба «аспарт», Lyumjev и Humalog оба «лизпро». Ключ по веществу склеил бы их
     попарно и стёр разницу, за которую человек платит: у ультрабыстрых пик заметно раньше. */
  it('одно вещество, разные классы — не путаем', () => {
    const стоп = следитьЗаИнсулином();
    for (const [id, класс] of [['fiasp', 'ультрабыстрый'], ['novorapid', 'УКД'],
      ['lyumjev', 'ультрабыстрый'], ['humalog', 'УКД']] as const) {
      посланное.length = 0;
      setDeviceConfig({ fastInsulinId: id });
      expect(посланное, id).toEqual([{ 'insulin.type': id, 'insulin.actionClass': класс }]);
    }
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
    expect(посланное).toEqual([{ 'insulin.type': null, 'insulin.actionClass': null }]);
    стоп();
  });

  /* Инсулина нет в справочнике — класс не выдумываем: незнакомый ядро возьмёт по умолчанию и
     скажет об этом, а выдуманный тихо посчитает по чужой кривой. */
  it('незнакомый инсулин — класс пустой, а не угаданный', () => {
    const стоп = следитьЗаИнсулином();
    посланное.length = 0;
    setDeviceConfig({ fastInsulinId: 'такого-нет' });
    expect(посланное).toEqual([{ 'insulin.type': 'такого-нет', 'insulin.actionClass': null }]);
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
