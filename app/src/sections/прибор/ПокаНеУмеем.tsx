import Иконка from '@/ui/Иконка';
import { gitNetworkOutline, hardwareChipOutline } from 'ionicons/icons';
import type { DeviceCatKey } from '../DeviceSection';

/* Категории, у которых пока нет модели: петля и глюкометр (#406).

   Пустой экран здесь — законное состояние, а не заглушка «скоро будет». Разница в том,
   что мы говорим, чего именно нет, и что при этом уже работает: показания глюкометра
   вносятся руками уже сейчас, и кнопка стоит здесь же. Пустота без объяснения читается
   как поломка. */
export default function ПокаНеУмеем({ cat, onВнести }: {
  cat: DeviceCatKey;
  onВнести: () => void;
}) {
  const петля = cat === 'loop';
  return (
    <div className="loop-empty">
      <Иконка icon={петля ? gitNetworkOutline : hardwareChipOutline} />
      <div className="loop-empty-t">{петля ? 'Петля' : 'Глюкометр'}</div>
      <div className="loop-empty-s">{петля
        ? 'Алгоритм замкнутого цикла (AAPS/Loop/встроенный) и статус — в разработке.'
        : 'Модель глюкометра и расходники (тест-полоски, ланцеты) — в разработке. Показания можно вносить уже сейчас.'}</div>
      {cat === 'meter' && (
        <button className="loop-empty-btn" onClick={onВнести}>Внести показание</button>
      )}
    </div>
  );
}
