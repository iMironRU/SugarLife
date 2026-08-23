import Иконка from './Иконка';
import { notificationsOutline } from 'ionicons/icons';
import { useЖивыеТревоги, понял } from '@/показ/живыеТревоги';

/* «ПОНЯЛ» — ТАМ, ГДЕ ЧЕЛОВЕК ОКАЗЫВАЕТСЯ (SugarLife#482).

   Разбуженный сиреной открывает приложение — и первое, что он должен увидеть, это что случилось и
   кнопка, которая это выключает. Прятать ответ в системном уведомлении (потянуть баннер вниз, найти
   «Понял») — значит требовать точных движений от человека спросонья.

   Полоса стоит выше всего остального на «Сегодня» и исчезает сама, когда движок снимает тревогу. */
export default function ЖивыеТревоги() {
  const тревоги = useЖивыеТревоги();

  if (!тревоги.length) return null;

  return (
    <>
      {тревоги.map((т) => (
        <div key={т.id} className="today-alert warn">
          <Иконка icon={notificationsOutline} className="alert-ico" />
          <div>
            <span className="alert-title">{т.заголовок}</span>
            <span>{т.текст}</span>
            {т.нуженОтвет && (
              <span className="alert-ask alert-ask-row">
                {/* Полоса уходит сразу, не дожидаясь снимка: движок держит тревогу активной, пока
                    держится причина, и ждать его значило бы оставить нажатую кнопку висеть. */}
                <button className="changed-btn is-undo" onClick={() => понял(т.id)}>Понял</button>
              </span>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
