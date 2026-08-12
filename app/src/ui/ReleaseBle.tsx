import { IonIcon } from '@ionic/react';
import { bluetoothOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { useState } from 'react';
import { sendIntent, useSnapshot } from '@/sources/bridge';

/* «Отдать устройства» — разом отпустить все BLE-подключения.

   Зачем это вообще нужно. У BLE-периферии один центральный: пока сенсор держит наш
   телефон, официальное приложение производителя или второй телефон к нему не
   подключатся. Это не ошибка, это устройство железа. Значит человеку нужен способ
   быстро отдать сенсор — например, чтобы отсканировать его родным приложением или
   передать ребёнку второй телефон.

   Без такой кнопки единственный выход — выгружать приложение из памяти, и человек
   быстро приучается делать именно это. Дальше он перестаёт доверять фоновой работе
   вообще, и мы теряем весь ночной мониторинг.

   Показываем только когда есть кому отпускать: в браузере BLE нет как класса, и
   кнопка, которая ничего не делает, хуже её отсутствия. */
export default function ReleaseBle() {
  const snap = useSnapshot();
  const [отдано, setОтдано] = useState(false);

  const bleУстройства = (snap?.devices ?? []).filter(
    (d) => d.kind !== 'service' && d.connection !== 'Disconnected',
  );
  if (!bleУстройства.length) return null;

  const отдать = async () => {
    await sendIntent({ type: 'releaseBle' });
    setОтдано(true);
    window.setTimeout(() => setОтдано(false), 6000);
  };

  return (
    <button className={'release-ble' + (отдано ? ' is-done' : '')} onClick={отдать} disabled={отдано}>
      <IonIcon icon={отдано ? checkmarkCircleOutline : bluetoothOutline} />
      <span>
        <b>{отдано ? 'Устройства отпущены' : 'Отдать устройства'}</b>
        <i>
          {отдано
            ? 'Можно подключаться с другого телефона. Мы вернёмся сами, когда их освободят.'
            : `Отпустить ${bleУстройства.length === 1 ? 'подключение' : 'подключения'} по блютусу — чтобы сенсор увидел другой телефон`}
        </i>
      </span>
    </button>
  );
}
