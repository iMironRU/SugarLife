import { useEffect, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { restaurantOutline, bluetoothOutline, warningOutline, timeOutline } from 'ionicons/icons';
import Section from '@/ui/Section';
import { useMeals } from '@/sources/mealStore';
import { useMealNames } from '@/settings/mealNames';
import { запросЖурнала, type LogRecord } from '@/sources/bridge';
import { изЖурнала, изПриёмов, лентаИстории, поДням, свернутьПовторы, type ВидСобытия } from '@/domain/история';
import { isNative } from '@/platform/appUpdate';

/* «История» — что ушло с экрана, но осталось в данных (SugarLife#384).

   «Сегодня» живёт настоящим: обращения гаснут, лента подключения исчезает через минуты,
   приём уезжает вверх. Это правильно — экран действия не должен превращаться в архив. Но
   потом человек спрашивает «во сколько я ел» и «когда сенсор отвалился», и ответить
   нечем, хотя данные лежат.

   ДВА ИСТОЧНИКА, И ОБА НАСТОЯЩИЕ: приёмы из нашей базы и события приборов из журнала
   движка. Ничего третьего не выдумываем: то, что живёт только в памяти экрана (вибро,
   мигнувшее обращение), до истории не доживает, и заводить ему хранилище ради ленты мы
   не станем. */

const ЗНАЧОК: Record<ВидСобытия, string> = {
  еда: restaurantOutline, прибор: bluetoothOutline, тревога: warningOutline,
};

const ОКНО_МС = 48 * 3600e3;

export default function HistorySection({ onClose }: { onClose: () => void }) {
  const meals = useMeals();
  const имена = useMealNames();
  const [журнал, setЖурнал] = useState<LogRecord[] | null>(null);
  const [естьЖурнал, setЕстьЖурнал] = useState(true);

  useEffect(() => {
    let жив = true;
    void запросЖурнала({ sinceMs: Date.now() - ОКНО_МС, minLevel: 'Info', limit: 300 }).then((r) => {
      if (!жив) return;
      if (!r) { setЕстьЖурнал(false); setЖурнал([]); return; }
      setЖурнал(r.records);
    });
    return () => { жив = false; };
  }, []);

  const от = Date.now() - ОКНО_МС;
  const события = свернутьПовторы(лентаИстории([
    изПриёмов(meals.filter((m) => m.t >= от), имена.names),
    изЖурнала(журнал ?? []),
  ]));
  const дни = поДням(события);

  return (
    <Section title="История" onBack={onClose}
      описание="Что уже произошло: еда, подключения, обрывы связи. Экран «Сегодня» показывает настоящее и стирает прошедшее — здесь оно остаётся.">

      {дни.length === 0 ? (
        <div className="loop-empty">
          <IonIcon icon={timeOutline} />
          <div className="loop-empty-t">Пока нечего вспоминать</div>
          <div className="loop-empty-s">
            За двое суток не записано ни приёмов, ни событий приборов.
          </div>
        </div>
      ) : (
        дни.map(({ день, события: сег }) => (
          <div key={день}>
            <div className="section-label sec">{имяДня(день)}</div>
            <div className="meal-log">
              {сег.map((с) => (
                <div key={с.ключ} className={'meal-row' + (с.вид === 'тревога' ? ' ист-тревога' : '')}>
                  <div className="meal-when">
                    <b>{часы(с.когдаМс)}</b>
                    {/* Диапазон, а не время последнего повтора: «с 23:35 по 23:38»
                        отвечает «шли ли данные», а одно время делало бы вид, что событие
                        случилось только что. */}
                    {с.доМс && <span>по {часы(с.доМс)}</span>}
                  </div>
                  <IonIcon icon={ЗНАЧОК[с.вид]} className="list-ico" />
                  <div className="meal-what">
                    <b>{с.главное}{с.повторов ? ` · ${с.повторов} раз` : ''}</b>
                    {с.подпись && <span>{с.подпись}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Про отсутствие журнала говорим прямо: в браузере движка нет, и события приборов
          там не появятся никогда — а человек будет ждать. */}
      {!естьЖурнал && (
        <div className="metric-note">
          Здесь только еда: события приборов ведёт движок приложения, а в браузере его нет.
          {!isNative && ' В приложении на телефоне лента будет полной.'}
        </div>
      )}
    </Section>
  );
}

function часы(t: number): string {
  return new Date(t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
}

function имяДня(t: number): string {
  const сегодня = new Date(); сегодня.setHours(0, 0, 0, 0);
  const разница = Math.round((сегодня.getTime() - t) / 86400e3);
  if (разница === 0) return 'Сегодня';
  if (разница === 1) return 'Вчера';
  return new Date(t).toLocaleDateString('ru', { day: 'numeric', month: 'long' });
}
