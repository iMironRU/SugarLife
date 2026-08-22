import Иконка from '@/ui/Иконка';
import { cloudOutline, bluetoothOutline } from 'ionicons/icons';
import type { DeviceView } from '@/sources/bridge';
import { связь } from '@/domain/deviceState';
import { СЛОВО_КАНАЛА, меткаСвязи } from '@/слова/приборы';
import { сколькоНазад } from '@/слова/время';

const сЗаглавной = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* Каналы устройства (SugarLifeCore#23, вынесено в #406).

   Одна карточка, каналы списком — потому что это ОДНО устройство, до которого мы
   дотягиваемся двумя дорогами. Верхние поля карточки описывают активный канал, и без
   этого списка непонятно, откуда взялось «на связи»: помпа рядом или облако помнит её
   последний документ. Разные факты, и человеку важно, какой из них.

   Рисуем только когда каналов больше одного: у одноканального устройства строка
   «напрямую» ничего не добавляет к тому, что уже сказано выше. */
export default function Каналы({ прибор }: { прибор: DeviceView | null | undefined }) {
  const каналы = прибор?.channels ?? [];
  if (каналы.length < 2) return null;
  return (
    <>
      <div className="section-label sec">Каналы</div>
      <div className="list">
        {каналы.map((c) => {
          const с = связь(c as unknown as DeviceView);
          return (
            <div key={c.id} className="list-row" style={{ cursor: 'default' }}>
              <Иконка icon={c.kind === 'cloud' ? cloudOutline : bluetoothOutline} className="list-ico" />
              <span className="pick-main">
                <span className="list-title">{сЗаглавной(СЛОВО_КАНАЛА[c.kind])}</span>
                <span className="pick-sub">
                  {c.label ? c.label + ' · ' : ''}
                  {меткаСвязи[с] ?? 'состояние неизвестно'}
                  {c.latestAtMs != null ? ' · ' + сколькоНазад(c.latestAtMs) : ''}
                </span>
              </span>
              {c.id === прибор?.activeChannel && <span className="meth-now">сейчас</span>}
            </div>
          );
        })}
      </div>
      <div className="sheet-note">
        Приложение само берёт тот канал, где данные свежее. Прямая связь предпочтительнее
        облака, но молчащая прямая уступает живому облаку.
      </div>
    </>
  );
}
