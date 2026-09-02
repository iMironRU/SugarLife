import type { DeviceView } from '@/sources/bridge';
import { sendIntent } from '@/sources/bridge';
import { sourceStatusLabel } from '@/слова/приборы';

/* Какой сенсор считать главным — только для карточки сенсора (#406).

   ПОКАЗЫВАЕМ ТОЛЬКО КОГДА ИСТОЧНИКОВ БОЛЬШЕ ОДНОГО. При единственном сенсоре выбор
   бессмысленен, а список из одной строки с отметкой «сейчас» — это интерфейс ради
   интерфейса.

   ОТМЕЧАЕМ ТОТ, У КОГО `primary` В СНИМКЕ, а не тот, что мы отправили: интент
   подтверждает приём, а не результат, и рисовать выбор по своему намерению значит
   однажды показать не то, что происходит на деле (SugarLifeCore#14). */
export default function ОсновнойИсточник({ источники }: { источники: DeviceView[] }) {
  if (источники.length <= 1) return null;
  return (
    <>
      <div className="section-label sec">Основной источник</div>
      <div className="list">
        {источники.map((d) => (
          <button key={d.id} className="list-row"
            onClick={() => sendIntent({ type: 'setPrimarySource', sourceId: d.id })}>
            <span className="pick-main">
              <span className="list-title">{d.name}</span>
              <span className="pick-sub">{sourceStatusLabel(d.status) ?? 'источник глюкозы'}</span>
            </span>
            {d.primary && <span className="meth-now">сейчас</span>}
          </button>
        ))}
        <button className="list-row" onClick={() => sendIntent({ type: 'setPrimarySource', sourceId: null })}>
          <span className="pick-main">
            <span className="list-title">Автоматически</span>
            <span className="pick-sub">приложение выберет само и переключится, когда датчик кончится</span>
          </span>
          {!источники.some((d) => d.primary) && <span className="meth-now">сейчас</span>}
        </button>
      </div>
      <div className="sheet-note">
        Отсюда берётся сахар в круге наверху. Выбор переживает перезапуск; если
        выбранный датчик пропадёт, приложение вернётся к автоматическому.
      </div>
    </>
  );
}
