import { IonIcon } from '@ionic/react';
import { bluetoothOutline, checkmarkCircleOutline, alertCircleOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useBleActivity, фразаСобытия, type BlePhase } from '@/sources/bleActivity';
import { agoText } from '@/domain/units';

/* Лента подключения на «Сегодня».

   При запуске непонятно, что подключается и подключилось ли: экран выглядит одинаково
   и когда сенсор ищется, и когда он молчит. Лента отвечает ровно на это — «сейчас идёт
   вот что» (SugarLifeCore#18).

   Живёт недолго намеренно. Подключение — событие, а не состояние: через пять минут
   «Sibionics на связи» уже не новость, а строка, которую перестают читать. Постоянное
   состояние показывают другие места — круг наверху и карточка устройства.

   Потерю связи держим дольше успеха: успех можно не заметить и ничего не потерять,
   а потерю — нужно. */
const ЖИЗНЬ: Record<BlePhase, number> = {
  capturing: 30e3,
  captured: 90e3,
  released: 10 * 60e3,
};

export default function ConnectFeed() {
  const события = useBleActivity();
  const [, тик] = useState(0);

  /* Перерисовываем раз в десять секунд: события истекают по времени, и без тика
     строка висела бы, пока не придёт следующий снимок. */
  useEffect(() => {
    const id = window.setInterval(() => тик((n) => n + 1), 10e3);
    return () => window.clearInterval(id);
  }, []);

  const свежие = события.filter((e) => Date.now() - e.at < ЖИЗНЬ[e.phase]);
  if (!свежие.length) return null;

  return (
    <div className="connect-feed">
      {свежие.map((e) => (
        <div key={e.id + e.at} className={'connect-line is-' + e.phase}>
          <IonIcon icon={e.phase === 'captured' ? checkmarkCircleOutline
            : e.phase === 'released' ? alertCircleOutline : bluetoothOutline} />
          <span>{фразаСобытия(e)}</span>
          <i>{agoText(e.at).replace(' назад', '')}</i>
        </div>
      ))}
    </div>
  );
}
