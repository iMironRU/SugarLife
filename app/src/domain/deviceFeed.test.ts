import { describe, it, expect } from 'vitest';
import { лента } from './deviceFeed';
import type { UiSnapshot, HardwareView, Discovered } from '@/sources/bridge';

/* Одна лента приборов (SugarLife#337). Проверяем два правила, ради которых её и свели:
   у работающего прибора нет кнопки «Подключить», а неслышный не исчезает из списка.

   Оба про доверие: кнопка у работающего приглашает сломать работающее, а исчезновение
   отвалившегося прибора не даёт отличить «сломался» от «приложение забыло». */

const т = new Date(2026, 7, 17, 12, 0, 0).getTime();

const ж = (p: Partial<HardwareView>): HardwareView => ({
  id: 'h', name: 'Прибор', kind: 'sensor', connection: 'Disconnected', ...p,
} as HardwareView);

const эфир = (p: Partial<Discovered>): Discovered => ({
  bleId: 'AA:BB', name: 'Новый', driverId: 'x', displayName: 'Новый', rssi: -60,
  needsMoreParams: false, isTransport: false, transportFor: [], knownDeviceId: null, ...p,
} as Discovered);

const снимок = (hardware: HardwareView[], discovered: Discovered[] = []): UiSnapshot => ({
  bridgeRevision: '1.21', devices: [], hardware, discovered,
  insights: null, pendingWrites: [], alerts: [], monitor: {} as UiSnapshot['monitor'],
});

describe('вид строки', () => {
  it('на связи и данные идут — работает, кнопки нет', () => {
    const [с] = лента(снимок([ж({ connection: 'Streaming', status: 'Live' })]), т);
    expect(с.вид).toBe('работает');
    expect(с.действие).toBe(null);
  });

  /* Молчащий, но живой прибор чинят не переподключением, а разбором: кнопка здесь
     предложила бы сломать соединение, которое как раз работает. */
  it('на связи, но данных нет — молчит, и кнопки тоже нет', () => {
    const [с] = лента(снимок([ж({ connection: 'Streaming', status: 'Delayed' })]), т);
    expect(с.вид).toBe('молчит');
    expect(с.действие).toBe(null);
  });

  /* Кнопка «Подключить» у прибора, который уже подключается, предлагает начать
     начатое — и попытка рвётся на середине. Видно на первом заведении: движок идёт на
     связь сам. */
  it('связь устанавливается — кнопки нет', () => {
    const [с] = лента(снимок([ж({ connection: 'Connecting', status: 'Connecting', nearbyAtMs: т - 1000 })]), т);
    expect(с.вид).toBe('подключаюсь');
    expect(с.действие).toBe(null);
  });

  it('свой, слышен в эфире — можно подключить', () => {
    const [с] = лента(снимок([ж({ nearbyAtMs: т - 3000 })]), т);
    expect(с.вид).toBe('рядом');
    expect(с.действие).toBe('подключить');
  });

  /* Главное правило ленты: прибор, которого не слышно, ОСТАЁТСЯ. Исчезновение — это
     утверждение «его нет», которого мы не делали. */
  it('свой, но не слышен — остаётся в списке и без кнопки', () => {
    const л = лента(снимок([ж({ nearbyAtMs: null })]), т);
    expect(л).toHaveLength(1);
    expect(л[0].вид).toBe('неслышно');
    expect(л[0].действие).toBe(null);
  });

  it('незнакомый в эфире — новый, его можно добавить', () => {
    const [с] = лента(снимок([], [эфир({})]), т);
    expect(с.вид).toBe('новый');
    expect(с.действие).toBe('добавить');
  });

  /* Сопоставляет движок через knownDeviceId, а не мы по имени: имена железок
     повторяются, и перепутать чужой сенсор со своим — худший исход. */
  it('своё объявление не превращается во второй прибор', () => {
    const л = лента(снимок([ж({ id: 'h1' })], [эфир({ knownDeviceId: 'h1' })]), т);
    expect(л).toHaveLength(1);
    expect(л[0].вид).not.toBe('новый');
  });
});

describe('порядок', () => {
  /* Чтобы найти отвалившийся сенсор, не должно приходиться прокручивать мимо
     работающих: сюда приходят чаще с бедой, чем с любопытством. */
  it('сначала то, с чем что-то не так', () => {
    const л = лента(снимок([
      ж({ id: 'ok', connection: 'Streaming', status: 'Live' }),
      ж({ id: 'тихо', connection: 'Streaming', status: 'Delayed' }),
      ж({ id: 'нет' }),
    ], [эфир({})]), т);
    expect(л.map((с) => с.вид)).toEqual(['молчит', 'неслышно', 'работает', 'новый']);
  });

  it('новые всегда после своих', () => {
    const л = лента(снимок([ж({ id: 'ok', connection: 'Streaming', status: 'Live' })], [эфир({})]), т);
    expect(л[л.length - 1].вид).toBe('новый');
  });
});
