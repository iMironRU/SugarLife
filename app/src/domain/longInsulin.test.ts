import { describe, it, expect } from 'vitest';
import { фонИнсулина, БЕЗ_СРОКА_МС } from './longInsulin';
import type { UiSnapshot } from '@/sources/bridge';

/* Длинный инсулин (SugarLife#287). Проверяем не вёрстку, а два обещания:
   он НИКОГДА не смешивается с активным, и срок его действия мы не выдумываем. */

const час = 3600e3;
const т = new Date(2026, 7, 18, 12, 0, 0).getTime();
const сн = (m: Record<string, unknown>): UiSnapshot => ({ monitor: m } as unknown as UiSnapshot);

describe('есть ли что показывать', () => {
  it('дозы нет — молчим', () => {
    expect(фонИнсулина(сн({}), т)).toBe(null);
    expect(фонИнсулина(сн({ longActingUnits: 0, longActingAtMs: т }), т)).toBe(null);
    expect(фонИнсулина(null, т)).toBe(null);
  });

  it('доза есть — отдаём как есть, не пересчитывая', () => {
    const ф = фонИнсулина(сн({ longActingUnits: 24, longActingAtMs: т - 2 * час }), т);
    expect(ф?.ед).toBe(24);
  });

  /* Срок приходит, только если человек задал длительность своего инсулина: у Тресибы
     42 часа, у Лантуса 24. Подставить «типичное» — сказать за него то, чего он не
     говорил. */
  it('срока нет — не выдумываем', () => {
    const ф = фонИнсулина(сн({ longActingUnits: 24, longActingAtMs: т - час }), т);
    expect(ф?.доМс).toBe(null);
    expect(ф?.действует).toBe(null);
  });

  it('срок есть — говорим, действует ли ещё', () => {
    const идёт = фонИнсулина(сн({ longActingUnits: 24, longActingAtMs: т - час, longActingUntilMs: т + час }), т);
    expect(идёт?.действует).toBe(true);
    const всё = фонИнсулина(сн({ longActingUnits: 24, longActingAtMs: т - 30 * час, longActingUntilMs: т - час }), т);
    expect(всё?.действует).toBe(false);
  });

  /* Без срока укол не может висеть вечно: «вчерашний длинный» через двое суток перестаёт
     быть ответом на вопрос «что у меня сейчас». */
  it('без срока — держим сутки с лишним и убираем', () => {
    const s = сн({ longActingUnits: 24, longActingAtMs: т - БЕЗ_СРОКА_МС + час });
    expect(фонИнсулина(s, т)).not.toBe(null);
    expect(фонИнсулина(сн({ longActingUnits: 24, longActingAtMs: т - БЕЗ_СРОКА_МС - час }), т)).toBe(null);
  });

  /* Закончившийся со ЗНАКОМЫМ сроком не прячем: человек на ручках приходит с вопросом
     «я вообще колол?», и молчание — не ответ. */
  it('срок вышел — всё равно показываем', () => {
    const ф = фонИнсулина(сн({ longActingUnits: 24, longActingAtMs: т - 40 * час, longActingUntilMs: т - 2 * час }), т);
    expect(ф).not.toBe(null);
    expect(ф?.действует).toBe(false);
  });
});

/* Слова подписи уехали в `слова/длинный.test.ts` (#324): срок это часть фразы, а не часть
   правила — правило знает только, задан он или нет. */
