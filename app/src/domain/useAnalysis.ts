import { useMemo } from 'react';
import { useStore } from '@/sources/store';
import { useHistory, useTreatments } from '@/sources/db';
import { useChanges } from '@/settings/changes';
import { analyzeCached } from './analysisCache';
import { insulinDaily } from './treatmentStats';
import type { Analysis } from './analysis';

/* Разбор данных — один расчёт на два экрана.

   Раньше он жил внутри раздела «Аналитика». Теперь счётчик важных находок нужен и на
   «Сегодня» (SugarLife#148), а копировать сборку входных данных — верный способ
   однажды получить на плитке одно число, а внутри раздела другое: разъезжаются не
   формулы, разъезжаются аргументы.

   Дорогого здесь ничего не происходит, несмотря на две недели истории:
   • чтение базы отдаёт срез из памяти, если он уже прочитан (sources/db.ts);
   • сам разбор берётся из общей памяти и пересчитывается раз в час
     (domain/analysisCache.ts).

   То есть второй вызывающий не добавляет ни чтения, ни счёта — он попадает в те же
   кэши. Именно поэтому расчёт можно поднять на главный экран, а не только в раздел,
   куда заходят раз в день. */
export function useAnalysis(days: number): { analysis: Analysis; loading: boolean } {
  const { data } = useStore();
  /* История из локальной БД, а не из data.entries: стор держит короткое окно для
     главного экрана, и разбор за две недели по нему показывал «пропусков 98 %» — не
     потому что данных нет, а потому что ему дали не тот срез. */
  const { entries: история, loading } = useHistory(days * 86400e3, { minRefreshMs: 3600e3 });
  const лечение = useTreatments(days * 86400e3, { minRefreshMs: 3600e3 });
  const батарея = data?.device?.uploaderBattery ?? null;
  const changes = useChanges();

  /* Пересчёт привязан к минуте последнего показания, а не к массиву: массив новый на
     каждый опрос, а выводы за две недели от одной точки не меняются. */
  const тик = Math.floor((история[история.length - 1]?.t ?? 0) / 60000);

  const analysis = useMemo(() => {
    const tb = лечение.filter((e) => e.type === 'Temp Basal');
    const bo = лечение.filter((e) => e.type !== 'Temp Basal' && (e.insulin ?? 0) > 0);
    const ins = insulinDaily(tb, bo);
    return analyzeCached(история, лечение, days, {
      basalCoverage: { covered: ins.coveredDays, total: ins.totalDays },
      uploaderBattery: батарея,
      changes,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [тик, days, батарея, changes]);

  return { analysis, loading };
}

/* Сколько важных находок человек ещё не видел.

   Важные — это warn и bad: то, что требует действия. info и good в счётчик не идут
   намеренно. Разбор возвращает десяток наблюдений, и если считать все, на кнопке
   будет постоянная «12», которая через неделю значит ноль. */
export function непрочитанныеВажные(analysis: Analysis | null, видели: string[]): number {
  if (!analysis) return 0;
  const было = new Set(видели);
  return analysis.insights.filter(
    (i) => (i.severity === 'warn' || i.severity === 'bad') && !было.has(i.id),
  ).length;
}
