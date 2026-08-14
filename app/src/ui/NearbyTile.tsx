import { IonIcon } from '@ionic/react';
import { bluetoothOutline, chevronForward } from 'ionicons/icons';
import { useSnapshot } from '@/sources/bridge';
import { связь } from '@/domain/deviceState';
import { железоДиспетчера } from '@/domain/nearby';
import { useStack } from '@/app/stackCtx';
import { DiscoverySection, DevicesSection } from '@/sections/lazy';

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

  /* Железо и его состояние — из тех же мест, что у диспетчера, и по тому же правилу
     (#224). Плитка считала «на связи» сама: смотрела на connection и пропускала status.
     А connection — это сокет, status — жизненный цикл данных: устройство бывает
     Connected и при этом Disconnected по смыслу. Отсюда и получалось, что плитка
     писала «на связи 2 устройства», а раздел устройств и приложение ядра — что связи
     нет. Одно приложение не может отвечать на один вопрос двумя способами.

     Правило теперь одно на всех: domain/deviceState.ts. */
  const железо = железоДиспетчера(snap);
  const живые = железо.filter((d) => связь(d) === 'live');
  const отвалились = железо.filter((d) => связь(d) === 'off');

  const проблема = железо.length === 0 || отвалились.length > 0 || живые.length === 0;
  /* Куда вести, зависит от того, есть ли уже своё железо.

     Нечего подключать — веди в поиск: там ищут незнакомое. А если железка заведена и
     отвалилась, поиск бесполезен и даже вреден: своё в нём не показывается вовсе
     (SugarLifeCore#34), и человек решит, что устройство пропало. Ему нужен диспетчер —
     список своего с состоянием и «подключить». Он живёт в «Устройствах». */
  const открыть = () => push(железо.length === 0
    ? <DiscoverySection onClose={pop} />
    : <DevicesSection onClose={pop} />);

  if (!проблема) {
    return (
      <button className="nearby-quiet" onClick={открыть}>
        <IonIcon icon={bluetoothOutline} />
        <span>На связи {живые.length === 1 ? (живые[0].model || живые[0].name) : `${живые.length} устройства`} · посмотреть, что рядом</span>
        <IonIcon icon={chevronForward} className="nearby-chev" />
      </button>
    );
  }

  return (
    <button className="nearby-tile" onClick={открыть}>
      <IonIcon icon={bluetoothOutline} />
      <div>
        <b>{железо.length === 0 ? 'Подключить устройство' : 'Связь с устройством потеряна'}</b>
        <span>
          {железо.length === 0
            ? 'Посмотреть, что рядом в эфире. Модель заранее указывать не нужно.'
            : 'Открыть поиск и переподключить — или отдать устройство другому телефону.'}
        </span>
      </div>
      <IonIcon icon={chevronForward} className="nearby-chev" />
    </button>
  );
}
