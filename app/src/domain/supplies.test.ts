import { describe, it, expect } from 'vitest';
import { расходка, устарелаЛи, подписьРасходки, УСТАРЕЛО_МС } from './supplies';
import type { DeviceView, RoleView, UiSnapshot } from '@/sources/bridge';

/* Остаток инсулина — число, на котором стоит решение «менять ли картридж на ночь»
   (#280). Ошибка здесь не выглядит ошибкой: показывается правильное значение, просто
   вчерашнее. */

const помпа = (p: Partial<DeviceView>): DeviceView => ({
  id: 'p', name: 'Medtronic 722', kind: 'pump', roles: ['PumpStateSource'],
  connection: 'Streaming', status: 'Live', capabilities: {}, settings: { parameters: [] },
  admittedInput: true, admittedOutput: false, testable: false, ...p,
});

const snap = (d: DeviceView[], roles?: RoleView[]): UiSnapshot => ({
  bridgeRevision: '1.14', devices: d, roles,
  insights: null, pendingWrites: [], alerts: [], monitor: {} as UiSnapshot['monitor'],
});

const роли: RoleView[] = [{ role: 'insulin', activeSourceId: 'p' }];
const сейчас = 1_800_000_000_000;

describe('откуда берём остаток', () => {
  it('прибор сказал — верим прибору, а не облаку', () => {
    const s = snap([помпа({ reservoirU: 37, batteryPct: 62, reservoirAtMs: сейчас - 60_000 })], роли);
    const р = расходка(s, { reservoir: 99, pumpBattery: 10 });
    expect([р.остаток, р.откуда]).toEqual([37, 'прибор']);
  });

  /* Устройство в снимке есть, а расходку драйвер ещё не прочитал: пустое поле означает
     «не знаю». Молчать вместо облачного ответа было бы хуже — цифра у человека есть,
     просто из другого места. */
  it('прибор молчит про остаток — берём облако и помечаем', () => {
    const s = snap([помпа({})], роли);
    const р = расходка(s, { reservoir: 42, pumpBattery: 55, at: сейчас });
    expect([р.остаток, р.откуда]).toEqual([42, 'облако']);
  });

  it('не знает никто — молчим, а не показываем ноль', () => {
    expect(расходка(snap([]), null).остаток).toBe(null);
    expect(расходка(null, null).откуда).toBe(null);
  });
});

describe('возраст числа', () => {
  /* Остаток врёт не значением, а давностью: связь потеряна, а число осталось на экране. */
  it('прочитано полчаса назад — уже устарело', () => {
    const р = расходка(snap([помпа({ reservoirU: 30, reservoirAtMs: сейчас - УСТАРЕЛО_МС - 1 })], роли), null);
    expect(устарелаЛи(р, сейчас)).toBe(true);
  });

  it('только что — не устарело', () => {
    const р = расходка(snap([помпа({ reservoirU: 30, reservoirAtMs: сейчас - 60_000 })], роли), null);
    expect(устарелаЛи(р, сейчас)).toBe(false);
  });

  /* Времени чтения нет — это «не знаем», а не «свежее». Утверждать свежесть по молчанию
     значит успокаивать без оснований. */
  it('времени нет — про устаревание молчим', () => {
    const р = расходка(snap([помпа({ reservoirU: 30 })], роли), null);
    expect(устарелаЛи(р, сейчас)).toBe(false);
  });
});

describe('что пишем под числом', () => {
  const возраст = () => '2 ч назад';

  it('свежее и с прибора — подписывать нечего', () => {
    const р = расходка(snap([помпа({ reservoirU: 30, reservoirAtMs: сейчас })], роли), null);
    expect(подписьРасходки(р, сейчас, возраст)).toBe(null);
  });

  it('облачное — говорим, что через облако', () => {
    const р = расходка(snap([]), { reservoir: 20 });
    expect(подписьРасходки(р, сейчас, возраст)).toBe('через облако');
  });

  it('устаревшее — говорим, насколько', () => {
    const р = расходка(snap([помпа({ reservoirU: 30, reservoirAtMs: сейчас - УСТАРЕЛО_МС - 1 })], роли), null);
    expect(подписьРасходки(р, сейчас, возраст)).toBe('2 ч назад');
  });

  it('числа нет вовсе — подписи тоже', () => {
    expect(подписьРасходки(расходка(null, null), сейчас, возраст)).toBe(null);
  });
});
