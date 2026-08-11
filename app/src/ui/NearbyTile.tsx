import { IonIcon } from '@ionic/react';
import { bluetoothOutline, chevronForward } from 'ionicons/icons';
import { useSnapshot } from '@/sources/bridge';
import { useStack } from '@/app/stackCtx';
import { DiscoverySection } from '@/sections/lazy';

/* Вход в «устройства рядом» с главного экрана.

   Плитка не должна кричать. «Посмотри, что рядом» полезно ровно в двух случаях: когда
   подключать ещё нечего и когда связь отвалилась. Когда всё работает, постоянное
   напоминание про скан — шум на экране, к которому человек привыкает и перестаёт
   замечать; а замечать он должен именно тогда, когда что-то сломалось.

   Поэтому два вида: заметная карточка при проблеме и тихая строка в остальное время.

   В браузере не показываем вовсе. BLE там нет как класса, и вход в поиск, который
   ничего не найдёт никогда, — обещание, которого мы не выполним. Признак живого
   движка — наличие драйверов в снимке: Nightscout-шим их не отдаёт. */
export default function NearbyTile() {
  const snap = useSnapshot();
  const { push, pop } = useStack();

  const drivers = snap?.availableDrivers ?? [];
  if (!drivers.length) return null;

  const devices = (snap?.devices ?? []).filter((d) => d.kind !== 'service');
  const живые = devices.filter((d) => d.connection === 'Connected' || d.connection === 'Streaming');
  const отвалились = devices.filter((d) => d.connection === 'Error' || d.status === 'Disconnected');

  const проблема = devices.length === 0 || отвалились.length > 0 || живые.length === 0;
  const открыть = () => push(<DiscoverySection onClose={pop} />);

  if (!проблема) {
    return (
      <button className="nearby-quiet" onClick={открыть}>
        <IonIcon icon={bluetoothOutline} />
        <span>На связи {живые.length === 1 ? живые[0].name : `${живые.length} устройства`} · посмотреть, что рядом</span>
        <IonIcon icon={chevronForward} className="nearby-chev" />
      </button>
    );
  }

  return (
    <button className="nearby-tile" onClick={открыть}>
      <IonIcon icon={bluetoothOutline} />
      <div>
        <b>{devices.length === 0 ? 'Подключить устройство' : 'Связь с устройством потеряна'}</b>
        <span>
          {devices.length === 0
            ? 'Посмотреть, что рядом в эфире. Модель заранее указывать не нужно.'
            : 'Открыть поиск и переподключить — или отдать устройство другому телефону.'}
        </span>
      </div>
      <IonIcon icon={chevronForward} className="nearby-chev" />
    </button>
  );
}
