import Иконка from './Иконка';
import { сколькоНазад } from '@/слова/время';
import { bluetoothOutline, checkmarkCircleOutline, alertCircleOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useBleActivity, фразаСобытия, type BlePhase } from '@/sources/bleActivity';

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

  /* Про каждое устройство — только последнее, что с ним случилось (SugarLife#247).

     Потеря живёт десять минут, успех — полторы, и на переподключении лента показывала
     обе строки разом: «Sibionics GS1 на связи · только что» и тут же «Sibionics GS1
     отключился · 1 мин». Формально верно — это два события. Читается как неисправность:
     человек видит про одну железку два взаимоисключающих утверждения и не знает, какому
     верить.

     Разные сроки жизни при этом остаются: потерю по-прежнему держим дольше успеха.
     Просто отменённое событие исчезает сразу, не дожидаясь своего срока — его больше
     нет в реальности, а лента рассказывает о ней, а не о себе. */
  const последнее = new Map<string, typeof события[number]>();
  for (const e of события) if (!последнее.has(e.id)) последнее.set(e.id, e);
  const свежие = [...последнее.values()].filter((e) => Date.now() - e.at < ЖИЗНЬ[e.phase]);
  if (!свежие.length) return null;

  return (
    <div className="connect-feed">
      {свежие.map((e) => (
        <div key={e.id + e.at} className={'connect-line is-' + e.phase}>
          <Иконка icon={e.phase === 'captured' ? checkmarkCircleOutline
            : e.phase === 'released' ? alertCircleOutline : bluetoothOutline} />
          <span>{фразаСобытия(e)}</span>
          <i>{сколькоНазад(e.at).replace(' назад', '')}</i>
        </div>
      ))}
    </div>
  );
}
