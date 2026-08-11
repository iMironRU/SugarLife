import { useEffect, useState } from 'react';
import { getMeals, putMeal, removeMeal, onDbChange } from './db';
import { makeMeal, type Meal, type NewMeal } from '@/domain/meals';

/* Доступ к журналу приёмов из интерфейса.

   Отдельным модулем, а не хуком внутри шторки: приёмы нужны и на «Сегодня», и в
   истории, и когда-нибудь отправителю — а он не компонент. Здесь только чтение и
   запись; всё, что можно решить без базы, решается в domain/meals.ts и покрыто
   тестами там. */

export async function addMeal(m: NewMeal): Promise<Meal> {
  const запись = makeMeal(m);
  await putMeal(запись);
  return запись;
}

export const deleteMeal = removeMeal;

export function useMeals(): Meal[] {
  const [meals, setMeals] = useState<Meal[]>([]);
  useEffect(() => {
    let жив = true;
    const читать = () => { void getMeals().then((x) => { if (жив) setMeals(x); }); };
    читать();
    const off = onDbChange(читать);
    return () => { жив = false; off(); };
  }, []);
  return meals;
}
