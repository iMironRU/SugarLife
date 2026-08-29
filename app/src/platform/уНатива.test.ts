import { describe, it, expect, beforeEach, vi } from 'vitest';
import { уНатива, отказовНатива, забытьОтказы } from './уНатива';

vi.mock('@/sources/bridge', () => ({ вЖурналДвижка: vi.fn() }));
const { вЖурналДвижка } = await import('@/sources/bridge');

describe('уНатива — отказ не проходит бесследно', () => {
  beforeEach(() => { забытьОтказы(); vi.clearAllMocks(); });

  it('получилось — отдаёт ответ и молчит', async () => {
    expect(await уНатива('testAlarm', async () => 'ок', 'нет')).toBe('ок');
    expect(вЖурналДвижка).not.toHaveBeenCalled();
  });

  it('отказ — отдаёт запасное и оставляет след', async () => {
    const ответ = await уНатива('testAlarm', async () => { throw new Error('метода нет'); }, false);
    expect(ответ).toBe(false);
    expect(вЖурналДвижка).toHaveBeenCalledTimes(1);
    expect(vi.mocked(вЖурналДвижка).mock.calls[0][2]).toContain('метода нет');
  });

  it('повторы считает, но журнал не заливает', async () => {
    /* `фонГотовность` спрашивают на каждом заходе в раздел. На старом телефоне наивный след дал бы
       сотни одинаковых строк — тот самый мусор, в котором тонет настоящая причина. */
    for (let i = 0; i < 50; i++) {
      await уНатива('фон', async () => { throw new Error('нет'); }, null);
    }
    expect(вЖурналДвижка).toHaveBeenCalledTimes(1);
    expect(отказовНатива('фон')).toBe(50);
  });

  it('разные имена считаются порознь', async () => {
    await уНатива('первый', async () => { throw new Error('а'); }, null);
    await уНатива('второй', async () => { throw new Error('б'); }, null);
    expect(вЖурналДвижка).toHaveBeenCalledTimes(2);
  });

  it('отказ без сообщения тоже оставляет след', async () => {
    await уНатива('пусто', async () => { throw undefined; }, null);
    expect(vi.mocked(вЖурналДвижка).mock.calls[0][2]).toContain('отказ без причины');
  });
});
