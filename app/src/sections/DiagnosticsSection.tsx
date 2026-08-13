import { IonIcon, IonToggle } from '@ionic/react';
import { useState } from 'react';
import { documentTextOutline, shareOutline, warningOutline } from 'ionicons/icons';
import Section from '@/ui/Section';
import { useSnapshot, sendIntent } from '@/sources/bridge';
import type { LoggingState } from '@/sources/bridge';

/* Диагностика: уровень лога, захват, выгрузка.

   Понадобилось из-за конкретного случая: сенсор «на связи», а данных нет — и понять
   почему нечем. Драйвер пишет подробный лог с фазами обмена, но из приложения его не
   видно и не достать (SugarLifeCore#17).

   Экран для редкого случая, поэтому лежит в глубине профиля, а не на виду: человеку с
   диабетом диагностика нужна раз в полгода, и место на главном она занимать не должна.

   Два места, где здесь легко навредить, и оба про честность, а не про удобство.

   ПЕРВОЕ: цена подробности. На уровне Trace лог пишется постоянно и заметно ест батарею
   и место. Молча включить и забыть — значит съесть у человека день автономности, и он
   не поймёт почему. Поэтому цена написана рядом, а не спрятана в справку.

   ВТОРОЕ: в логе лежат его данные. Значения сахара, идентификаторы устройств, иногда
   сырой обмен с сенсором. «Поделиться» отправляет это наружу — в мессенджер, в почту,
   в чужие руки. Предупредить об этом обязаны мы, до нажатия, а не после. */

const УРОВНИ: { id: LoggingState['level']; name: string; цена: string }[] = [
  { id: 'Error', name: 'Ошибки', цена: 'только сбои' },
  { id: 'Warn', name: 'Важное', цена: 'сбои и предупреждения' },
  { id: 'Info', name: 'Обычный', цена: 'по умолчанию' },
  { id: 'Debug', name: 'Подробный', цена: 'для разбора проблемы' },
  { id: 'Trace', name: 'Всё подряд', цена: 'ест батарею и место' },
];

export default function DiagnosticsSection({ onClose }: { onClose: () => void }) {
  const snap = useSnapshot();
  const logging = snap?.logging ?? null;
  const [делюсь, setДелюсь] = useState(false);

  /* Движка нет — и логировать нечего: Nightscout-шим в браузере ничего не пишет.
     Экран с переключателями, которые ни на что не влияют, хуже его отсутствия. */
  if (!logging) {
    return (
      <Section title="Диагностика" subtitle="Логи работы" onBack={onClose}>
        <div className="loop-empty">
          <IonIcon icon={documentTextOutline} />
          <div className="loop-empty-t">Логов нет</div>
          <div className="loop-empty-s">
            Лог ведёт движок приложения, а в браузере он не работает. Открой раздел в
            приложении на телефоне — там будет и уровень, и выгрузка.
          </div>
        </div>
      </Section>
    );
  }

  const поделиться = async () => {
    setДелюсь(true);
    await sendIntent({ type: 'exportLog' });
    window.setTimeout(() => setДелюсь(false), 2000);
  };

  return (
    <Section title="Диагностика" subtitle="Логи работы приложения" onBack={onClose}>

      <div className="section-label sec">Подробность</div>
      <div className="list">
        {УРОВНИ.map((у) => (
          <button key={у.id} className="list-row"
            onClick={() => sendIntent({ type: 'setLogLevel', level: у.id })}>
            <span className="pick-main">
              <span className="list-title">{у.name}</span>
              <span className="pick-sub">{у.цена}</span>
            </span>
            {logging.level === у.id && <span className="meth-now">сейчас</span>}
          </button>
        ))}
      </div>
      <div className="sheet-note">
        Чем подробнее, тем больше расход батареи и места. Для обычной работы хватает
        «обычного»; подробный включают, когда что-то разбирают, и выключают после.
      </div>

      <div className="section-label sec">Запись</div>
      <div className="list">
        <div className="list-row">
          <span className="pick-main">
            <span className="list-title">Писать в файл</span>
            <span className="pick-sub">
              без этого лог живёт только в памяти и пропадает при перезапуске
              {logging.retentionHours ? ` · хранится ${logging.retentionHours} ч` : ''}
            </span>
          </span>
          <IonToggle checked={logging.capturingFile}
            onIonChange={(e) => sendIntent({ type: 'setLogCapture', file: e.detail.checked, raw: null })} />
        </div>
        <div className="list-row">
          <span className="pick-main">
            <span className="list-title">Сырой обмен с устройством</span>
            <span className="pick-sub">нужен редко, для разбора протокола · пишет много</span>
          </span>
          <IonToggle checked={logging.capturingRaw}
            onIonChange={(e) => sendIntent({ type: 'setLogCapture', file: null, raw: e.detail.checked })} />
        </div>
      </div>

      <button className="sheet-danger diag-share" onClick={поделиться} disabled={делюсь}>
        <IonIcon icon={делюсь ? shareOutline : shareOutline} />
        {делюсь ? 'Открываю…' : 'Поделиться логом'}
      </button>
      {/* Предупреждение ДО нажатия, а не после: отправленное обратно не вернуть. */}
      <div className="sheet-note warn">
        <IonIcon icon={warningOutline} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        В логе твои данные: значения сахара, идентификаторы устройств, при включённом
        сыром обмене — переписка с сенсором. Отправляй только тому, кто разбирает проблему.
      </div>
    </Section>
  );
}
