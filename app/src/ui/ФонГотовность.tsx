import { useEffect, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { warningOutline, checkmarkCircle } from 'ionicons/icons';
import { фонГотовность, попроситьИсключение, type ФонОтвет } from '@/platform/фон';

/* «Телефон усыпит приложение в фоне» — строкой, а не диалогом (#380, ядро SugarLife#382).

   Главный случай тут — НЕ отказ человека. Он обратный: системное исключение выдано, а
   прошивка всё равно душит фон своей защитой. Ровно на таких телефонах мониторинг умирает
   ночью при всех зелёных галочках, и молчать про это вреднее всего.

   Почему строкой на экране готовности, а не всплывающей просьбой: диалог закрывают не
   читая, и второй раз он уже не появится. Строка ждёт, пока человек придёт разбираться,
   и в этот момент отвечает на его вопрос.

   Кнопка — только когда нам есть куда вести. Системный экран исключений открыть можем,
   вендорский «Запуск приложений» — нет, никаким API. */
export default function ФонГотовность({ спокойно }: {
  /* «Спокойно» — режим диагностики: туда приходят за ответом, и «всё в порядке» там
     уместно. На рабочих экранах зелёная галочка — шум (тот же уговор, что в Готовность). */
  спокойно?: boolean;
}) {
  const [ответ, setОтвет] = useState<ФонОтвет | null | 'ждём'>('ждём');
  const [открыли, setОткрыли] = useState(false);

  useEffect(() => { void фонГотовность().then(setОтвет); }, []);

  if (ответ === 'ждём') return null;

  /* Спросить не у кого — браузер, iOS или сборка старше. В диагностике говорим об этом
     вслух: «не знаем» и «всё хорошо» — разные новости, и вторая тут была бы выдумкой. */
  if (!ответ) {
    if (!спокойно) return null;
    return <div className="sheet-note">Про фон сказать нечего: эту сборку не спросить — она старше этих методов, или это браузер.</div>;
  }

  if (!ответ.problem) {
    if (!спокойно) return null;
    return (
      <div className="sheet-note">
        <IonIcon icon={checkmarkCircle} style={{ marginRight: 6, verticalAlign: -2 }} />
        Фон: телефон приложение не усыпляет.
      </div>
    );
  }

  return (
    <div className="today-alert">
      <IonIcon icon={warningOutline} className="alert-ico" />
      <div>
        <span className="alert-title">{ответ.reason}</span>
        <span>{ответ.whatToDo}</span>
        {ответ.weCanOpenSettings && (
          <span className="alert-ask alert-ask-row">
            <button className="changed-btn is-undo" disabled={открыли}
              onClick={() => { setОткрыли(true); void попроситьИсключение().then((ок) => { if (!ок) setОткрыли(false); }); }}>
              {открыли ? 'Открываю…' : 'Открыть настройки'}
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
