import { describe, it, expect } from 'vitest';
import { однаПравда, словоОбрыва } from './однаПравда';
import type { UiSnapshot, HardwareView, DeviceView } from '@/sources/bridge';

/* Одна правда о приборе (SugarLifeCore#39).

   С живого теста: баннер «Связь с устройством потеряна», а строкой ниже два прибора «на
   связи». Формально права каждая строка, вместе — нечитаемо. Проверяем правило, а не
   разметку: «на связи» без «через что» не существует, и тревога называет канал. */

const т = new Date(2026, 7, 18, 12, 0, 0).getTime();

const ж = (p: Partial<HardwareView>): HardwareView =>
  ({ id: 'h', name: 'Прибор', kind: 'sensor', connection: 'Disconnected', ...p } as HardwareView);
const у = (p: Partial<DeviceView>): DeviceView =>
  ({ id: 'h', name: 'Прибор', kind: 'sensor', connection: 'Disconnected', ...p } as DeviceView);
const сн = (hardware: HardwareView[], devices: DeviceView[] = []): UiSnapshot =>
  ({ hardware, devices, roles: [] } as unknown as UiSnapshot);

describe('строка прибора', () => {
  it('подключён напрямую — говорим и состояние, и путь', () => {
    const [с] = однаПравда(сн(
      [ж({ connection: 'Streaming', status: 'Live', latestAtMs: т - 60_000 })],
      [у({ connection: 'Streaming', status: 'Live', channels: [{ id: 'c', kind: 'direct' }] as never })],
    ), т);
    expect(с.состояние).toBe('подключено');
    expect(с.откуда).toBe('по радио');
    expect(с.когдаМс).toBe(т - 60_000);
  });

  /* Тот самый случай из отчёта: помпа «на связи», потому что её видно через Nightscout,
     а радио молчит. Раньше это читалось как «всё хорошо». */
  it('радио молчит, а цифры идут облаком — состояние и путь расходятся, и оба видны', () => {
    const [с] = однаПравда(сн(
      [ж({ kind: 'pump', connection: 'Disconnected', status: 'Disconnected' })],
      [у({ kind: 'pump', connection: 'Disconnected', status: 'Live', channels: [{ id: 'c', kind: 'cloud' }] as never })],
    ), т);
    expect(с.состояние).toBe('нет связи');
    expect(с.откуда).toBe('через Nightscout');
  });

  it('данных нет ниоткуда — путь не выдумываем', () => {
    const [с] = однаПравда(сн([ж({ connection: 'Disconnected' })]), т);
    expect(с.откуда).toBe(null);
  });

  /* «Не настроен» и «чем занят» перебивают слова о связи — правило из moста 1.22/1.24
     остаётся в силе и здесь. */
  it('не настроен — это важнее любых слов о связи', () => {
    const [с] = однаПравда(сн([ж({ registryState: 'NotConfigured', note: 'Не хватает настроек: Код сенсора' })]), т);
    expect(с.вместоСостояния).toMatch(/Код сенсора/);
  });
});

describe('откуда идут цифры — про роль, а не про железку', () => {
  const рольные = (роли: unknown[], hardware: HardwareView[], devices: DeviceView[] = []): UiSnapshot =>
    ({ hardware, devices, roles: роли } as unknown as UiSnapshot);

  /* Первая попытка отвечала по каналам самой железки и врала дважды. У помпы, читаемой
     из Nightscout, выходило «через мост» — то есть назывался путь, который как раз не
     работает. */
  it('помпа читается облаком — называем облако, а не мёртвый мост', () => {
    const с = однаПравда(рольные(
      [{ role: 'insulin', activeSourceId: 'cloud-pump', via: 'cloud', sourceIds: ['h', 'cloud-pump'] }],
      [ж({ id: 'h', kind: 'pump', behindBridgeId: 'br' })],
      [
        у({ id: 'h', kind: 'pump' }),
        у({ id: 'cloud-pump', kind: 'pump', status: 'Live', channels: [{ id: 'c', kind: 'cloud' }] as never }),
      ],
    ), т)[0];
    expect(с.состояние).toBe('нет связи');
    expect(с.откуда).toBe('через Nightscout');
  });

  /* А у молчащего моста писалось «по радио», хотя по нему не идёт ничего и идти не
     может: мост не источник данных, он дорога. */
  it('мост — не источник, пути у него нет вовсе', () => {
    const [с] = однаПравда(сн([ж({ kind: 'bridge' })]), т);
    expect(с.откуда).toBe(null);
    expect(с.состояние).toBe('нет связи');
  });

  it('роль никем не обслуживается — молчим, а не выдумываем путь', () => {
    const [с] = однаПравда(сн([ж({ kind: 'sensor' })], [у({ kind: 'sensor' })]), т);
    expect(с.откуда).toBe(null);
  });
});

describe('тревога называет канал', () => {
  const строка = (p: Partial<Parameters<typeof словоОбрыва>[0][number]>) => ({
    id: 'a', имя: 'Прибор', состояние: 'нет связи' as const, откуда: null, когдаМс: null,
    вместоСостояния: null, дорога: false, ...p,
  });

  /* Оборванный мост виден по прибору за ним: тот скажет, что цифры идут облаком или не
     идут вовсе. Своя строка «нет данных от моста» добавляла бы к беде вторую, выдуманную. */
  it('мост в тревогу о данных не входит', () => {
    expect(словоОбрыва([строка({ имя: 'OrangeLink', дорога: true })])).toBe(null);
  });

  it('всё подключено — тревоги нет', () => {
    expect(словоОбрыва([строка({ состояние: 'подключено', откуда: 'по радио' })])).toBe(null);
  });

  /* Радио молчит, но цифры идут — это СОСТОЯНИЕ, а не тревога. «Связь потеряна» тут
     отправляло человека чинить то, что работает. */
  it('радио молчит, данные идут — говорим чем компенсировано', () => {
    const с = словоОбрыва([строка({ имя: 'Medtronic 722', откуда: 'через Nightscout' })]);
    expect(с).toMatch(/Радио/);
    expect(с).toMatch(/через Nightscout/);
    expect(с).not.toMatch(/^Связь потеряна/);
  });

  it('данных нет ниоткуда — вот это тревога, и с именем', () => {
    const с = словоОбрыва([строка({ имя: 'Sibionics GS1' })]);
    expect(с).toMatch(/Sibionics GS1/);
    expect(с).toMatch(/данных от него нет/);
  });

  /* Имя обязательно: безымянное «связь потеряна» человек не может ни проверить, ни
     опровергнуть — у него на экране два прибора. */
  it('молчат несколько — перечисляем поимённо', () => {
    const с = словоОбрыва([строка({ id: 'a', имя: 'A' }), строка({ id: 'b', имя: 'B' })]);
    expect(с).toMatch(/A, B/);
  });
});
