import { IonIcon } from '@ionic/react';
import { chevronBack } from 'ionicons/icons';

/* Заголовок страницы стека — один на все разделы.

   Был разнобой: в «Сервисах» и «Устройствах» слева стрелка «назад», в карточках
   устройства, облака и базального профиля справа крестик. Одно и то же действие
   выглядело двумя разными, и по виду кнопки нельзя было понять, вернёшься ты на шаг
   назад или закроешь всё.

   Теперь везде стрелка слева: это шаг назад по стеку, а не закрытие поверх лежащего
   окна. Отдельным компонентом — чтобы разнобой не завёлся снова при следующем
   добавленном разделе. */
export default function PageHead({ title, subtitle, onBack }: {
  title: string; subtitle?: string; onBack: () => void;
}) {
  return (
    <div className="sheet-head">
      <button className="sheet-close" onClick={onBack} aria-label="Назад"><IonIcon icon={chevronBack} /></button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sheet-title">{title}</div>
        {subtitle && <div className="sheet-subtitle">{subtitle}</div>}
      </div>
    </div>
  );
}
