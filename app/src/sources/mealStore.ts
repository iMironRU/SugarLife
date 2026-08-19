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

/* Правка записи (SugarLife#381).

   Раньше единственным действием в строке была корзина: ошибся в граммах — стирай и вноси
   заново. При этом терялось время внесения и id, а вместе с ними — идемпотентность:
   отправитель, когда появится, увидел бы новую запись вместо исправленной и задвоил
   приём. Задвоенные углеводы — задвоенная доза.

   Поэтому правим НА МЕСТЕ, сохраняя id и createdAt, и сбрасываем состояние доставки:
   отправленное когда-то придётся отправить снова, уже исправленным. */
export async function updateMeal(m: Meal, правки: Partial<Pick<Meal, 't' | 'carbs' | 'kind' | 'note'>>): Promise<Meal> {
  const новая: Meal = { ...m, ...правки, sync: m.sync === 'sent' ? 'local' : m.sync };
  await putMeal(новая);
  return новая;
}

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
