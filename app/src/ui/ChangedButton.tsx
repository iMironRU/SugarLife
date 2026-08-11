import { IonIcon } from '@ionic/react';
import { checkmarkCircle, refreshOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { markChanged, unmarkChanged, type Consumable } from '@/settings/changes';

/* Кнопка «Поменял» — один тап, без диалогов и подтверждений.

   Подтверждение здесь было бы вредным: замена случается посреди дела, руками в
   расходниках, и лишний экран «вы уверены?» ровно та причина, по которой человек
   перестаёт логировать замены вовсе. А именно это мы и чиним.

   Защита от случайного тапа — не вопрос заранее, а отмена после: пятнадцать секунд
   кнопка показывает «отменить». Ошибиться дешевле, чем каждый раз подтверждать. */

const ОТМЕНА_МС = 15000;

export default function ChangedButton({ what, label = 'Поменял' }: {
  what: Consumable; label?: string;
}) {
  const [отмечено, setОтмечено] = useState(false);

  useEffect(() => {
    if (!отмечено) return;
    const id = window.setTimeout(() => setОтмечено(false), ОТМЕНА_МС);
    return () => window.clearTimeout(id);
  }, [отмечено]);

  if (отмечено) {
    return (
      <button className="changed-btn is-undo" onClick={() => { unmarkChanged(what); setОтмечено(false); }}>
        <IonIcon icon={checkmarkCircle} />
        отменить
      </button>
    );
  }
  return (
    <button className="changed-btn" onClick={() => { markChanged(what); setОтмечено(true); }}>
      <IonIcon icon={refreshOutline} />
      {label}
    </button>
  );
}
