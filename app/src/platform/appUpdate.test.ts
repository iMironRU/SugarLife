import { describe, it, expect } from 'vitest';
import { новееЛи, checkNativeUpdate, ВЫПУСКАЕТСЯ_APK } from './appUpdate';

/* «Скачать APK» — единственная кнопка, которая просит человека переустановить
   приложение. Ошибка здесь не падает и не мигает: она просто предлагает поставить
   сборку старше установленной, и человек послушно откатывается на прошлую неделю
   (SugarLife#238). */
describe('новее ли релиз установленного', () => {
  it('релиз позже сборки — предлагаем', () => {
    expect(новееЛи('2026-08-14T12:00:00Z', '2026-08-14T11:00:00Z')).toBe(true);
  });

  /* Ровно тот случай, ради которого проверка и добавлена: релиз выложен руками и отстал
     от main. По одному SHA он выглядел бы «другим», то есть «новым». */
  it('релиз раньше сборки — молчим, это откат', () => {
    expect(новееЛи('2026-08-01T12:00:00Z', '2026-08-14T11:00:00Z')).toBe(false);
  });

  it('одно и то же время — не предлагаем', () => {
    expect(новееЛи('2026-08-14T12:00:00Z', '2026-08-14T12:00:00Z')).toBe(false);
  });

  /* API молчит или отдало мусор. Правильный ответ — «не предлагать»: неизвестность не
     повод звать человека переустанавливать приложение. */
  it('дат нет или они не читаются — не предлагаем', () => {
    expect(новееЛи(null, '2026-08-14T12:00:00Z')).toBe(false);
    expect(новееЛи('2026-08-14T12:00:00Z', undefined)).toBe(false);
    expect(новееЛи('позавчера', '2026-08-14T12:00:00Z')).toBe(false);
    expect(новееЛи('', '')).toBe(false);
  });
});

/* Издания (SugarLife#298). Релиз один и выпускает Lite; для Pro предложение обновиться —
   это установка ВТОРОГО приложения рядом, а не обновление: пакет другой, подпись та же,
   значит установщик не откажет. Проверяем, что до сети дело не доходит вовсе. */
describe('проверка APK знает про издания', () => {
  it('Pro не спрашивает релиз и не предлагает обновление', async () => {
    const было = globalThis.fetch;
    let звали = false;
    globalThis.fetch = (() => { звали = true; throw new Error('сети быть не должно'); }) as typeof fetch;
    try {
      const r = await checkNativeUpdate('pro');
      expect(r).not.toBe('error');
      expect((r as { hasUpdate: boolean }).hasUpdate).toBe(false);
      expect((r as { apkUrl: string | null }).apkUrl).toBe(null);
      expect(звали).toBe(false);
    } finally { globalThis.fetch = было; }
  });

  /* Издание не назвали — старый мост или веб. Ведём себя как Lite: молчаливо считать
     сборку чужой опаснее, чем предложить обновление тому, кому оно и адресовано.

     Пока ВЫПУСКАЕТСЯ_APK выключен, до этого решения дело не доходит вовсе — сборок
     наружу нет, и спрашивать не о чем. Тест держит обе ветки, чтобы флаг можно было
     вернуть одной строкой и не чинить тесты следом. */
  it('издание неизвестно — ведём себя как Lite', async () => {
    const было = globalThis.fetch;
    let звали = false;
    globalThis.fetch = (async () => { звали = true; return { ok: false } as Response; }) as typeof fetch;
    try {
      await checkNativeUpdate(null);
      expect(звали).toBe(ВЫПУСКАЕТСЯ_APK);
    } finally { globalThis.fetch = было; }
  });

  /* Сборки не раздаём (решение владельца, 22.08.2026): ни сети, ни предложения обновиться,
     ни ссылки на релиз, которого больше нет. */
  it('когда APK не выпускается — не спрашиваем сеть и не предлагаем ничего', async () => {
    if (ВЫПУСКАЕТСЯ_APK) return;
    const было = globalThis.fetch;
    let звали = false;
    globalThis.fetch = (() => { звали = true; throw new Error('сети быть не должно'); }) as typeof fetch;
    try {
      const r = await checkNativeUpdate('lite');
      expect(звали).toBe(false);
      expect((r as { hasUpdate: boolean }).hasUpdate).toBe(false);
      expect((r as { apkUrl: string | null }).apkUrl).toBe(null);
    } finally { globalThis.fetch = было; }
  });
});
