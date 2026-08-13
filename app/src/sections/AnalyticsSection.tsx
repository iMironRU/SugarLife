import { useEffect, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { checkmarkCircle, warning, alertCircle } from 'ionicons/icons';
import Section from '@/ui/Section';
import PageLoading from '@/ui/PageLoading';
import Insights from '@/ui/Insights';
import { useAnalysis } from '@/domain/useAnalysis';
import { отметитьПрочитанными } from '@/settings/seenInsights';

/* Разбор данных — отдельный раздел, а не врезка на главном экране.

   На «Сегодня» человек решает, что делать сейчас; разбор отвечает на другой вопрос —
   что происходило и почему. Это разные режимы, и смешивать их концепция запрещает.
   Поэтому с «Сегодня» ведёт плитка, а вся разборка живёт здесь.

   Период выбирается явно: находки от него зависят напрямую. «Ночные гипо: 3 за
   14 дней» и «3 за 3 дня» — это разные новости, и человек должен видеть, за что
   считалось. */

const ПЕРИОДЫ = [3, 7, 14, 30];

export default function AnalyticsSection({ onClose }: { onClose: () => void }) {
  const [days, setDays] = useState(14);
  /* Расчёт общий с плиткой на «Сегодня» (domain/useAnalysis.ts): счётчик важных
     находок и содержимое этого экрана обязаны совпадать, а совпадают они надёжно
     только если считаются одним кодом из одних аргументов. */
  const { analysis, loading: читаю } = useAnalysis(days);

  /* Зашли — всё, что сейчас на экране, прочитано. Отсюда и берётся смысл счётчика на
     плитке: он показывает не «сколько всего важного», а «сколько появилось с прошлого
     раза» (SugarLife#148). */
  const ids = analysis.insights.map((i) => i.id).join(',');
  useEffect(() => {
    if (!читаю) отметитьПрочитанными(analysis.insights.map((i) => i.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, читаю]);



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
    <Section title="Аналитика" subtitle={`Разбор за ${days} дн.`} onBack={onClose}>

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

      {/* Ряда фильтров по виду находки здесь больше нет (#149). Он не влезал в
          ширину — «Привычки» уезжали за край, — и прятал варианты: чего не видно,
          того для человека не существует. А главное, фильтровать девять пунктов
          незачем: вид находки виден по её тексту, а разделы по важности показывают
          всё сразу. */}
      <Insights analysis={analysis} />

      <div className="sheet-note">
        Всё посчитано из ваших же данных — истории CGM и событий Nightscout. Ничего не
        додумано: чего в данных нет, того здесь не будет. Это не назначения, а наблюдения,
        по которым удобно готовить вопросы врачу.
      </div>
    </Section>
  );
}
