import { useState } from 'react';
import { IonIcon } from '@ionic/react';
import {
  checkmarkCircle, informationCircle, warning, alertCircle,
  helpCircleOutline, chevronForward,
} from 'ionicons/icons';
import type { Analysis, Insight, Severity } from '@/domain/analysis';

const SEV_COLOR: Record<Severity, string> = {
  good: 'var(--c-glu)',
  info: 'var(--color-accent)',
  warn: 'var(--c-carb)',
  bad: 'var(--c-danger)',
};
const SEV_ICON: Record<Severity, string> = {
  good: checkmarkCircle, info: informationCircle, warn: warning, bad: alertCircle,
};

function Card({ it, open, onToggle }: { it: Insight; open: boolean; onToggle: () => void }) {
  return (
    <div className="insight" style={{ borderLeftColor: SEV_COLOR[it.severity] }}>
      <button className="insight-top" onClick={onToggle}>
        <IonIcon icon={SEV_ICON[it.severity]} style={{ color: SEV_COLOR[it.severity] }} className="insight-sev" />
        <span className="insight-title">{it.title}</span>
        <IonIcon icon={chevronForward} className={'insight-chev' + (open ? ' open' : '')} />
      </button>
      {open && (
        <div className="insight-body">
          <div className="insight-msg">{it.message}</div>
          {it.question && (
            <div className="insight-q"><IonIcon icon={helpCircleOutline} /><span>{it.question}</span></div>
          )}
        </div>
      )}
    </div>
  );
}

/* Находки показываем ВСЕ и сразу, разделами (SugarLife#149).

   Было три вкладки: «Внимание / Заметки / В норме», и в каждый момент видна одна.
   Сверху к ним прибавлялся ряд фильтров по виду находки, который не влезал в
   ширину — «Привычки» уезжали за край. Два фильтра над списком из девяти пунктов.

   Фильтры нужны, когда список не окинуть взглядом. Девять окидываются. А вкладки к
   тому же прячут: человек видел «Внимание» и не знал, что во второй вкладке лежит
   объяснение, ради которого он и зашёл.

   Разделы решают обе задачи разом: ничего не спрятано, счётчик стоит там же, где
   заголовок, и прокрутка исчезла вместе с чипами. */

export default function Insights({ analysis }: { analysis: Analysis | null }) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  if (!analysis) {
    return (
      <div className="ins-loading">
        <span className="ins-spin" />
        <div>
          <b>Считаю аналитику…</b>
          <span>Смотрю глюкозу, базал и расходники за последние дни.</span>
        </div>
      </div>
    );
  }
  const toggle = (id: string) => setOpenIds((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const attention = analysis.insights.filter((i) => i.severity === 'bad' || i.severity === 'warn');
  const notes = analysis.insights.filter((i) => i.severity === 'info');
  const ok = analysis.insights.filter((i) => i.severity === 'good');

  const разделы: { label: string; items: Insight[]; color: string }[] = [
    { label: 'Внимание', items: attention, color: attention.some((i) => i.severity === 'bad') ? 'var(--c-danger)' : 'var(--c-carb)' },
    { label: 'Заметки', items: notes, color: 'var(--color-accent)' },
    { label: 'В норме', items: ok, color: 'var(--c-glu)' },
  ];

  return (
    <>
      {/* «Внимание» пустое — говорим об этом словами. Отсутствие срочного это ответ,
          а не отсутствие ответа: человек пришёл узнать, всё ли в порядке, и молчание
          он прочитает как «не посчиталось». Остальные разделы при пустоте просто не
          рисуем — «заметок нет» ничего никому не сообщает. */}
      {!attention.length && (
        <div className="ins-calm">
          <IonIcon icon={checkmarkCircle} style={{ color: 'var(--c-glu)' }} />
          <span>Ничего срочного не нашлось.</span>
        </div>
      )}

      {разделы.filter((р) => р.items.length).map((р) => (
        <div key={р.label}>
          <div className="ins-head">
            <span className="ins-head-l" style={{ color: р.color }}>{р.label}</span>
            <span className="ins-head-n">{р.items.length}</span>
          </div>
          <div className="insights">
            {р.items.map((it) => <Card key={it.id} it={it} open={openIds.has(it.id)} onToggle={() => toggle(it.id)} />)}
          </div>
        </div>
      ))}
    </>
  );
}
