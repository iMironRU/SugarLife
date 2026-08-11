import { useMemo, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { checkmarkCircle, warning, alertCircle } from 'ionicons/icons';
import PageHead from '@/ui/PageHead';
import PageLoading from '@/ui/PageLoading';
import Insights from '@/ui/Insights';
import { type InsightKind } from '@/domain/analysis';
import { analyzeCached } from '@/domain/analysisCache';
import { insulinDaily } from '@/domain/treatmentStats';
import { useStore } from '@/sources/store';
import { useHistory, useTreatments } from '@/sources/db';

/* Разбор данных — отдельный раздел, а не врезка на главном экране.

   На «Сегодня» человек решает, что делать сейчас; разбор отвечает на другой вопрос —
   что происходило и почему. Это разные режимы, и смешивать их концепция запрещает.
   Поэтому с «Сегодня» ведёт плитка, а вся разборка живёт здесь.

   Период выбирается явно: находки от него зависят напрямую. «Ночные гипо: 3 за
   14 дней» и «3 за 3 дня» — это разные новости, и человек должен видеть, за что
   считалось. */

const ПЕРИОДЫ = [3, 7, 14, 30];

const ГРУППЫ: { key: InsightKind | 'all'; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'glucose', label: 'Сахар' },
  { key: 'device', label: 'Расходники' },
  { key: 'data', label: 'Данные' },
  { key: 'habit', label: 'Привычки' },
];

export default function AnalyticsSection({ onClose }: { onClose: () => void }) {
  const { data } = useStore();
  const [days, setDays] = useState(14);
  /* История берётся из локальной БД, а не из data.entries: стор держит короткое окно
     для главного экрана, и разбор за две недели по нему показывал «пропусков 98 %» —
     не потому что данных нет, а потому что я дал ему не тот срез. Ошибка вредная
     вдвойне: человек пошёл бы чинить выгрузку, с которой всё в порядке. */
  /* Разбор пересчитывается раз в час (см. domain/analysisCache), и перечитывать
     историю чаще нечему помогать — только рывки на ровном месте. */
  const { entries: история, loading: читаю } = useHistory(days * 86400e3, { minRefreshMs: 3600e3 });
  const лечение = useTreatments(days * 86400e3, { minRefreshMs: 3600e3 });
  const [kind, setKind] = useState<InsightKind | 'all'>('all');
  const батарея = data?.device?.uploaderBattery ?? null;

  /* Результат разбора берём из общей памяти (domain/analysisCache): она переживает
     закрытие экрана, поэтому возврат и переключение периода туда-обратно уже не
     стоят ста миллисекунд счёта. Здешний useMemo остаётся ради фильтров — они на
     сам расчёт не влияют и не должны его дёргать. */
  const тик = Math.floor((история[история.length - 1]?.t ?? 0) / 60000);

  const analysis = useMemo(() => {
    const entries = история;
    const events = лечение;
    const tb = events.filter((e) => e.type === 'Temp Basal');
    const bo = events.filter((e) => e.type !== 'Temp Basal' && (e.insulin ?? 0) > 0);
    const ins = insulinDaily(tb, bo);
    return analyzeCached(entries, events, days, {
      basalCoverage: { covered: ins.coveredDays, total: ins.totalDays },
      uploaderBattery: батарея,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [тик, days, батарея]);

  const отфильтровано = useMemo(
    () => (kind === 'all' ? analysis : { ...analysis, insights: analysis.insights.filter((i) => i.kind === kind) }),
    [analysis, kind],
  );

  const счёт = (k: InsightKind | 'all') =>
    k === 'all' ? analysis.insights.length : analysis.insights.filter((i) => i.kind === k).length;

  const r = analysis.readiness;
  const вид = r.level === 'ready'
    ? { icon: checkmarkCircle, color: 'var(--c-glu)', title: 'Данных достаточно для разбора' }
    : r.level === 'partial'
      ? { icon: warning, color: 'var(--c-carb)', title: 'Разбор возможен, но с оговорками' }
      : { icon: alertCircle, color: 'var(--c-danger)', title: 'Данных пока мало' };

  /* Пока история читается — показываем ожидание, а не поспешный вердикт. Разбор по
     ещё не приехавшим данным сказал бы «данных пока мало», и это прочли бы как ответ. */
  if (читаю) return <PageLoading title="Аналитика" />;

  return (
    <div className="sheet stack-body">
      <PageHead title="Аналитика" subtitle={`Разбор за ${days} дн.`} onBack={onClose} />

      <div className="period">
        {ПЕРИОДЫ.map((d) => (
          <button key={d} className={'period-seg' + (days === d ? ' on' : '')} onClick={() => setDays(d)}>
            {d} дн.
          </button>
        ))}
      </div>

      {/* Готовность — сверху и всегда: она говорит, насколько вообще стоит верить
          тому, что ниже. Выводы по дырявым данным хуже отсутствия выводов. */}
      <div className="rd" style={{ borderLeftColor: вид.color }}>
        <div className="rd-top">
          <IonIcon icon={вид.icon} style={{ color: вид.color }} />
          <span>{вид.title}</span>
        </div>
        {r.reasons.length > 0 && <div className="rd-why">{r.reasons.join(' · ')}</div>}
      </div>

      <div className="metric-chips chips-scroll">
        {ГРУППЫ.map((g) => (
          <button key={g.key} className={'metric-chip' + (kind === g.key ? ' on' : '')} onClick={() => setKind(g.key)}>
            <span>{g.label}</span>
            <span className="chip-n">{счёт(g.key)}</span>
          </button>
        ))}
      </div>

      <Insights analysis={отфильтровано} />

      <div className="sheet-note">
        Всё посчитано из ваших же данных — истории CGM и событий Nightscout. Ничего не
        додумано: чего в данных нет, того здесь не будет. Это не назначения, а наблюдения,
        по которым удобно готовить вопросы врачу.
      </div>
    </div>
  );
}
