import { IonIcon } from '@ionic/react';
import { часы, имяДня } from '@/слова/время';
import { restaurantOutline, bluetoothOutline, warningOutline, timeOutline, trendingUpOutline, refreshOutline } from 'ionicons/icons';
import Section from '@/ui/Section';
import { useMeals } from '@/sources/mealStore';
import { useMealNames } from '@/settings/mealNames';
import { useДневник } from '@/sources/дневникStore';
import { useEntries, useTreatments } from '@/sources/db';
import { onlyLocal } from '@/domain/meals';
import { необъяснённыеПодъёмы } from '@/domain/mealMoment';
import { изДневника, изПодъёмов, изПриёмов, лентаИстории, поДням, свернутьПовторы, type ВидСобытия } from '@/domain/история';

/* «История» — что ушло с экрана, но осталось в данных (SugarLife#384).

   «Сегодня» живёт настоящим: обращения гаснут, лента подключения исчезает через минуты,
   приём уезжает вверх. Это правильно — экран действия не должен превращаться в архив. Но
   потом человек спрашивает «во сколько я ел» и «когда сенсор отвалился», и ответить
   нечем, хотя данные лежат.

   ЛЕНТА — ИЗ ТОГО, ЧТО ЧЕЛОВЕК ВИДЕЛ, а не из журнала движка (#396). Журнал — переписка
   с прибором, он про технику и живёт в «Что происходит» у прибора. Здесь три источника,
   и все про человека: дневник экрана (связь, обновления), приёмы и подъёмы без записи.

   Дневник ведём сами и с момента установки этой сборки — прошлое не восстановить, и об
   этом сказано прямо, а не показано пустотой. */

const ЗНАЧОК: Record<ВидСобытия, string> = {
  еда: restaurantOutline, прибор: bluetoothOutline, подъём: trendingUpOutline,
  сборка: refreshOutline, тревога: warningOutline,
};

const ОКНО_МС = 48 * 3600e3;

export default function HistorySection({ onClose }: { onClose: () => void }) {
  const meals = useMeals();
  const имена = useMealNames();
  const записи = useДневник();
  const entries = useEntries(ОКНО_МС);
  const лечение = useTreatments(ОКНО_МС);

  const от = Date.now() - ОКНО_МС;
  const свои = meals.filter((m) => m.t >= от);
  /* Времена ВСЕХ известных углеводов, а не только своих: еда из AAPS приходит через
     Nightscout, и без неё мы объявили бы объяснённый подъём необъяснённым. */
  const всяЕда = [
    ...onlyLocal(meals, лечение).map((m) => m.t),
    ...лечение.filter((t) => (t.carbs ?? 0) > 0).map((t) => t.t),
  ];

  const события = свернутьПовторы(лентаИстории([
    изДневника(записи.filter((з) => з.когдаМс >= от)),
    изПриёмов(свои, имена.names),
    изПодъёмов(необъяснённыеПодъёмы(entries, всяЕда)),
  ]));
  const дни = поДням(события);
  const пусто = дни.length === 0;

  return (
    <Section title="История" onBack={onClose}
      описание="Что уже произошло: еда, подключения и обрывы связи, подъёмы без записи. Экран «Сегодня» показывает настоящее и стирает прошедшее — здесь оно остаётся.">

      {дни.length === 0 ? (
        <div className="loop-empty">
          <IonIcon icon={timeOutline} />
          <div className="loop-empty-t">Пока нечего вспоминать</div>
          <div className="loop-empty-s">
            За двое суток ничего не записано. Дневник ведётся с момента установки этой
            сборки — то, что было раньше, в него не попало.
          </div>
        </div>
      ) : (
        дни.map(({ день, события: сег }) => (
          <div key={день}>
            <div className="section-label sec">{имяДня(день, { заглавно: true })}</div>
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

      {/* Скажем прямо, откуда лента и с какого момента. Без этого молчание читается как
          «больше ничего и не было», а это неправда: до установки сборки дневника просто
          не существовало. */}
      {!пусто && (
        <div className="metric-note">
          Здесь то, что показывалось на «Сегодня»: связь с приборами, еда, подъёмы без
          записи. Переписка с прибором — в карточке прибора, «Что происходит».
        </div>
      )}
    </Section>
  );
}


