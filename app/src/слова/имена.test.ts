import { describe, it, expect } from 'vitest';
import { вопрос } from './имена';

describe('как спросить про имя приёма', () => {
  it('называем то, что человек делал, без лишних требований', () => {
    const т = вопрос({ id: 'Обед|55', kind: 'Обед', carbs: 55, count: 5 });
    expect(т).toMatch(/обед/);
    expect(т).toMatch(/55 г/);
    expect(т).toMatch(/5 раз/);
    /* Ни категории, ни состава, ни граммов по ингредиентам: вопрос, выглядящий анкетой, человек
       закроет и больше не откроет. */
    expect(т).not.toMatch(/категор|состав|ингредиент/i);
  });

  it('окончание числительного не режет глаз', () => {
    const в = (n: number) => вопрос({ id: 'a', kind: 'Обед', carbs: 55, count: n });
    expect(в(3)).toMatch(/3 раза/);
    expect(в(5)).toMatch(/5 раз /);
    expect(в(11)).toMatch(/11 раз /);
    expect(в(21)).toMatch(/21 раз /);
  });
});
