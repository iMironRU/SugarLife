import { useState, type CSSProperties } from 'react';
import { IonIcon } from '@ionic/react';
import {
  checkmarkCircle, informationCircle, warning, alertCircle,
  helpCircleOutline, chevronForward,
} from 'ionicons/icons';
import type { Analysis, Insight, Severity } from '@/domain/analysis';
import { словаНаходки } from '@/показ/находки';

const SEV_COLOR: Record<Severity, string> = {
  good: 'var(--c-glu)',
  info: 'var(--color-accent)',
  warn: 'var(--c-carb)',
  bad: 'var(--c-danger)',
};
const SEV_ICON: Record<Severity, string> = {
  good: checkmarkCircle, info: informationCircle, warn: warning, bad: alertCircle,
};

/* Слова находки берём в слое показа: разбор возвращает вид и числа, а как это назвать —
   решается там (#324). Карточка остаётся про раскрытие и цвет. */
function Card({ it, open, onToggle }: { it: Insight; open: boolean; onToggle: () => void }) {
  const слова = словаНаходки(it);
  return (
    <div className="insight" style={{ borderLeftColor: SEV_COLOR[it.severity] }}>
      <button className="insight-top" onClick={onToggle}>
        <IonIcon icon={SEV_ICON[it.severity]} style={{ color: SEV_COLOR[it.severity] }} className="insight-sev" />
        <span className="insight-title">{слова.title}</span>
        <IonIcon icon={chevronForward} className={'insight-chev' + (open ? ' open' : '')} />
      </button>
      {open && (
        <div className="insight-body">
          <div className="insight-msg">{слова.message}</div>
          {слова.question && (
            <div className="insight-q"><IonIcon icon={helpCircleOutline} /><span>{слова.question}</span></div>
          )}
        </div>
      )}
    </div>
  );
}

/* Находки — вкладками по важности (SugarLife#199).

   ЧТО ИМЕННО МЫ СНИМАЛИ В #149. Ряд фильтров по ВИДУ находки — «глюкоза / железо /
   привычки / данные». Он не влезал в ширину, «Привычки» уезжали за край, и фильтровать
   девять пунктов по виду было незачем: вид виден по тексту. Вместе с ним тогда ушли и
   вкладки по важности, хотя претензия была не к ним.

   Разделы, которые их заменили, честно показывали всё сразу — и оказались длинными:
   девять карточек в полную ширину это три экрана прокрутки, где до «В норме» никто не
   доходит, а «Внимание» приходится искать заново после каждого возврата.

   Вкладок ровно три, и они по ВАЖНОСТИ, а не по виду: важность — это то, зачем сюда
   приходят («что-то не так?»), и трёх слов хватает на любой ширине.

   ДВА ПРАВИЛА, ЧТОБЫ ВКЛАДКИ НЕ ПРЯТАЛИ.

   Пустая вкладка остаётся на месте, с нулём. Убирать её значит менять раскладку под
   человеком: вчера «В норме» было третьим, сегодня второе — и палец жмёт не туда.

   Открывается самая важная НЕПУСТАЯ. Открывать всегда первую значит показывать пустоту
   тому, у кого всё хорошо, а открывать всегда последнюю — прятать срочное. */

export default function Insights({ analysis }: { analysis: Analysis | null }) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [вкладка, setВкладка] = useState<'attention' | 'notes' | 'ok' | null>(null);
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

  const разделы = [
    { key: 'attention' as const, label: 'Внимание', items: attention, color: attention.some((i) => i.severity === 'bad') ? 'var(--c-danger)' : 'var(--c-carb)' },
    { key: 'notes' as const, label: 'Заметки', items: notes, color: 'var(--color-accent)' },
    { key: 'ok' as const, label: 'В норме', items: ok, color: 'var(--c-glu)' },
  ];

  /* Выбор вкладки — производная от данных, а не отдельная память. Период меняют прямо
     на экране, и вкладка, ставшая пустой, показывала бы пустоту вместо находок. */
  const перваяНепустая = разделы.find((р) => р.items.length)?.key ?? 'attention';
  const выбрана = вкладка && разделы.find((р) => р.key === вкладка)?.items.length
    ? вкладка : перваяНепустая;
  const текущий = разделы.find((р) => р.key === выбрана)!;

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

      <div className="period ins-tabs">
        {разделы.map((р) => (
          /* Цвет вкладки — тот же, что у полосы слева у карточек внутри неё: жёлтый
             для внимания (красный, если есть срочное), фиолетовый для заметок, зелёный
             для нормы. Светофор здесь не украшение: он отвечает на вопрос «всё ли
             плохо» до того, как человек прочтёт хоть одно слово.

             Цвет отдаём стилю переменной, а не классом: у «Внимания» он зависит от
             содержимого — при срочной находке жёлтый становится красным. */
          <button key={р.key} className={'period-seg' + (р.key === выбрана ? ' on' : '')}
            style={{ '--сев': р.color } as CSSProperties}
            disabled={!р.items.length} onClick={() => setВкладка(р.key)}>
            {р.label}
            <span className="chip-n">{р.items.length}</span>
          </button>
        ))}
      </div>

      <div className="insights">
        {текущий.items.length
          ? текущий.items.map((it) => (
            <Card key={it.id} it={it} open={openIds.has(it.id)} onToggle={() => toggle(it.id)} />
          ))
          /* Все три пустые — такое бывает в первые дни. Молчать нельзя: человек решит,
             что не посчиталось. */
          : <div className="metric-note">Находок пока нет — данных слишком мало.</div>}
      </div>
    </>
  );
}
