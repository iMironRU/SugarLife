import { describe, it, expect } from 'vitest';
import { бедаДляПоказа, показанияСвежие, проСеть } from './застойПоказывать';
import type { Problem, UiSnapshot } from '@/sources/bridge';

const б = (code: string): Problem =>
  ({ code, title: 'Связи нет', remediation: 'Данные пойдут сами' } as Problem);

describe('показывать ли рассказ про обрыв', () => {
  /* Главное правило: два наших высказывания о настоящем не имеют права противоречить друг другу.
     Владелец видел «Внешний CGM · 1 мин» и «Связи нет» на одном экране. */
  it('числа идут — «связи нет» молчит', () => {
    expect(бедаДляПоказа(б('cloud.offline'), true)).toBeNull();
  });

  it('числа не идут — рассказываем как есть', () => {
    expect(бедаДляПоказа(б('cloud.offline'), false)).not.toBeNull();
  });

  /* Беды про ОДИН канал при живых числах ничему не противоречат: данные идут другим путём, а этот
     канал и правда сломан, и чинить его человеку. Прятать их значило бы прятать настоящую беду. */
  it('беда про конкретное облако остаётся видна и при свежих числах', () => {
    for (const код of ['cloud.unreachable', 'cloud.unreachable.online', 'cloud.server.error',
      'cloud.tls.failed', 'nightscout.auth.failed']) {
      expect(бедаДляПоказа(б(код), true), код).not.toBeNull();
    }
  });

  it('незнакомый код не показываем вовсе — слов для него нет', () => {
    expect(бедаДляПоказа(б('какая-то.новая'), false)).toBeNull();
  });

  it('беды нет — и показывать нечего', () => {
    expect(бедаДляПоказа(null, false)).toBeNull();
    expect(бедаДляПоказа(undefined, true)).toBeNull();
  });
});

describe('свежесть берём там же, где шапка', () => {
  const сн = (status: string): UiSnapshot => ({ monitor: { status } } as unknown as UiSnapshot);
  it('Live — числа идут', () => expect(показанияСвежие(сн('Live'))).toBe(true));
  it('всё остальное — нет', () => {
    expect(показанияСвежие(сн('Delayed'))).toBe(false);
    expect(показанияСвежие(null)).toBe(false);
  });
});

describe('что считаем рассказом про сеть', () => {
  /* Про телефон целиком — только «связи нет». Остальное про один канал. */
  it('«связи нет» — про телефон', () => {
    expect(проСеть('cloud.offline')).toBe(true);
  });
  it('беды одного канала телефона не касаются', () => {
    for (const код of ['cloud.unreachable', 'cloud.unreachable.online', 'cloud.server.error',
      'cloud.tls.failed', 'nightscout.auth.failed']) {
      expect(проСеть(код), код).toBe(false);
    }
  });
});
