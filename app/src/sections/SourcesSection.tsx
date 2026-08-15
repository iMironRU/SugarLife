import { IonIcon } from '@ionic/react';
import { checkmarkCircle, ellipseOutline, chevronForward } from 'ionicons/icons';
import { useState } from 'react';
import Section from '@/ui/Section';
import { useSnapshot, sendIntent } from '@/sources/bridge';
import { связь } from '@/domain/deviceState';
import { имяЖелезки, железоДиспетчера, звеноЦепочки, словоЦепочки, мостЖелезки } from '@/domain/nearby';
import {
  источникиСлота, причинаСлота, откудаСейчас, наполненЛи, ИМЯ_СЛОТА, type Слот,
} from '@/domain/sources';

/* «Откуда берутся данные» — слоты вместо двух плоских списков (SugarLife#277).

   Экран отвечает на вопрос, с которым сюда приходят: почему цифры такие. Раньше первым
   стоял инвентарь приборов, то есть ответ на «что у меня есть» — вопрос, который человек
   задаёт раз в жизни, при заведении.

   Приборы не исчезли, а сменили роль: ниже, отдельным списком, как хозяйство — заряд,
   прошивка, «отпустить». Соединять их со слотами в один список нельзя: «работает ли
   прибор» и «откуда цифры» — разные вопросы, и мы дважды получали неправду, отвечая на
   оба одним местом (#230, #247). */
const СЛОТЫ: Слот[] = ['сахар', 'инсулин', 'углеводы'];

/* Раздел живёт вкладкой внутри «Устройств и данных» (SugarLife#279): своя шапка там не
   нужна — она стала бы второй под настоящей. */
export default function SourcesSection({ onClose, встроенный }: {
  onClose?: () => void; встроенный?: boolean;
}) {
  const snap = useSnapshot();
  const [раскрыт, setРаскрыт] = useState<Слот | null>('сахар');

  const тело = (
    <>
      <div className="sheet-note">
        По этим источникам считается всё: активный инсулин, активные углеводы, прогноз и
        разбор.
      </div>

      {СЛОТЫ.map((слот) => {
        const источники = источникиСлота(snap, слот);
        const причина = причинаСлота(snap, слот);
        const открыт = раскрыт === слот;
        return (
          <div key={слот} className="slot-card">
            <button className="slot-top" onClick={() => setРаскрыт(открыт ? null : слот)}>
              {/* Точка отвечает на «наполняется ли»: пусто — серая, идёт обходным
                  путём — акцентная, всё хорошо — зелёная. Зелёная при пустом слоте была
                  бы обещанием, которого никто не давал. */}
              <span className={'slot-dot' + (!наполненЛи(snap, слот) ? ' off' : причина ? ' cloud' : ' ok')} />
              <span className="pick-main">
                <span className="list-title">{ИМЯ_СЛОТА[слот]}</span>
                <span className="pick-sub">{откудаСейчас(snap, слот)}</span>
              </span>
              <IonIcon icon={chevronForward} className={'slot-chev' + (открыт ? ' on' : '')} />
            </button>

            {/* Причина стоит под ответом, а не мелким шрифтом внизу: она и есть ответ на
                «почему из облака, а не с прибора». */}
            {причина && <div className="slot-why">{причина}</div>}

            {открыт && (
              <div className="slot-src">
                {источники.map((и) => (
                  <button key={и.id} className={'list-row pick-row' + (и.активен ? ' on' : '')}
                    /* «Предпочесть» — просьба движку, а не переключатель у нас: своего
                       состояния не заводим, и разъезжаться нечему. Замолчит выбранный —
                       данные придут прежним путём, человек не останется ни с чем. */
                    onClick={() => { if (!и.активен && и.id !== 'руками') void sendIntent({ type: 'setPrimarySource', sourceId: и.id }); }}>
                    <IonIcon icon={и.активен ? checkmarkCircle : ellipseOutline} className="list-ico" />
                    <span className="pick-main">
                      <span className="list-title">{и.имя}</span>
                      <span className="pick-sub">{и.подпись}</span>
                    </span>
                    {и.активен ? <span className="src-tag now">сейчас</span>
                      : и.живой ? <span className="src-tag">предпочесть</span> : null}
                  </button>
                ))}
                {!источники.length && (
                  <div className="metric-note">Источников нет — подключите прибор или облако.</div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="metric-note">
        Приложение выбирает источник само: живое прежде отставшего, прибор прежде облака.
        «Предпочесть» — просьба, а не переключатель: если выбранный источник замолчит,
        данные придут прежним путём.
      </div>

      {/* Хозяйство. Здесь прибор отвечает за себя: на связи ли он и что с ним делать. */}
      <div className="section-label sec">Что у меня есть</div>
      <div className="list">
        {железоДиспетчера(snap).map((h) => {
          const звено = звеноЦепочки(h, snap);
          const мост = мостЖелезки(h, snap);
          return (
            <div key={h.id} className="list-row">
              <span className={'slot-dot' + (связь(h) === 'live' ? ' ok' : ' off')} />
              <span className="pick-main">
                <span className="list-title">{имяЖелезки(h)}</span>
                <span className="pick-sub">
                  {звено ? словоЦепочки(звено, мост ? имяЖелезки(мост) : null)
                    : связь(h) === 'live' ? 'на связи' : 'нет связи'}
                </span>
              </span>
            </div>
          );
        })}
        {!железоДиспетчера(snap).length && (
          <div className="metric-note">Приборы не заведены — только облако.</div>
        )}
      </div>
      <div className="metric-note">
        Здесь заряд, прошивка и «отпустить». Отвечает на «работает ли прибор», а не на
        «откуда цифры»: это разные вопросы.
      </div>
    </>
  );

  if (встроенный) return тело;
  return (
    <Section title="Откуда берутся данные" subtitle="Профиль · Источники" onBack={onClose ?? (() => {})}>
      {тело}
    </Section>
  );
}
