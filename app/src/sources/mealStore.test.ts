import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Meal } from '@/domain/meals';

/*
 * «ОТПРАВЛЕНО» ОБЯЗАНО БЫТЬ ПРАВДОЙ (#657).
 *
 * Владелец сказал прямо: «мне нужно, чтобы введённые углеводы улетали в Nightscout». Пометка
 * `sent` — единственное, по чему он это узнаёт: в списке приёмов она означает «ушло». Поставить её
 * на записи, которую движок не принял, хуже, чем не поставить вовсе: молчаливая неправда закрывает
 * вопрос, который надо было задать.
 *
 * Здесь сторожим ровно это — и обратное: запись, которую не приняли, обязана остаться местной,
 * чтобы досыл забрал её при следующем запуске. Первая попытка бывает в самолёте, в лифте и до
 * подъёма движка.
 */

const база = new Map<string, Meal>();
const принято = { ответ: { accepted: true } as { accepted: boolean } | null, брошено: false, звали: [] as unknown[] };

vi.mock('./db', () => ({
  getMeals: async () => [...база.values()].sort((a, b) => b.t - a.t),
  putMeal: async (m: Meal) => { база.set(m.id, m); },
  removeMeal: async (id: string) => { база.delete(id); },
  onDbChange: () => () => {},
}));

vi.mock('./bridge', () => ({
  sendIntent: async (i: unknown) => {
    принято.звали.push(i);
    if (принято.брошено) throw new Error('моста нет');
    return принято.ответ;
  },
}));

const { addMeal, досылНеотправленных, updateMeal } = await import('./mealStore');

beforeEach(() => {
  база.clear();
  принято.ответ = { accepted: true };
  принято.брошено = false;
  принято.звали = [];
});

describe('отправка приёма', () => {
  it('движок принял — помечаем отправленным и в базе тоже', async () => {
    const m = await addMeal({ t: 1_700_000_000_000, carbs: 40, kind: 'meal' });
    expect(m.sync).toBe('sent');
    expect(база.get(m.id)?.sync).toBe('sent');
  });

  it('время еды, а не внесения, и наш id ключом', async () => {
    const когдаЕл = 1_700_000_000_000;
    const m = await addMeal({ t: когдаЕл, carbs: 40, kind: 'meal' });
    expect(принято.звали[0]).toMatchObject({ type: 'logMeal', id: m.id, atMs: когдаЕл, carbs: 40 });
  });

  it('движок не принял — запись остаётся местной', async () => {
    принято.ответ = { accepted: false };
    const m = await addMeal({ t: 1_700_000_000_000, carbs: 40, kind: 'meal' });
    expect(m.sync).toBe('local');
    expect(база.get(m.id)?.sync).toBe('local');
  });

  /* Браузер, самолёт, лифт, движок ещё не поднялся: отказ не должен ни ронять внесение, ни
     выдавать местную запись за ушедшую. Еда внесена — это главное, остальное доделает досыл. */
  it('моста нет — еда всё равно внесена, но не отправлена', async () => {
    принято.брошено = true;
    const m = await addMeal({ t: 1_700_000_000_000, carbs: 40, kind: 'meal' });
    expect(m.sync).toBe('local');
    expect(база.get(m.id)).toBeTruthy();
  });

  it('досыл забирает только неотправленное', async () => {
    принято.брошено = true;
    await addMeal({ t: 1_700_000_000_000, carbs: 40, kind: 'meal' });
    await addMeal({ t: 1_700_000_060_000, carbs: 10, kind: 'snack' });
    принято.брошено = false;
    принято.звали = [];

    expect(await досылНеотправленных()).toBe(2);
    expect(принято.звали).toHaveLength(2);
    expect([...база.values()].every((m) => m.sync === 'sent')).toBe(true);

    принято.звали = [];
    expect(await досылНеотправленных()).toBe(0);
    expect(принято.звали).toHaveLength(0);
  });

  /* Правка идёт ТЕМ ЖЕ id: движок увидит исправление одной записи, а не вторую еду рядом с первой.
     Задвоенные углеводы — задвоенная доза, и это не фигура речи. */
  it('правка уходит тем же ключом, а не новой записью', async () => {
    const m = await addMeal({ t: 1_700_000_000_000, carbs: 40, kind: 'meal' });
    принято.звали = [];
    const после = await updateMeal(m, { carbs: 55 });
    expect(после.id).toBe(m.id);
    expect(после.sync).toBe('sent');
    expect(принято.звали[0]).toMatchObject({ id: m.id, carbs: 55 });
    expect(база.size).toBe(1);
  });
});
