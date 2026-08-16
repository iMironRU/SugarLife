import { useState } from 'react';
import { playOutline, pauseOutline, refreshOutline, trashOutline } from 'ionicons/icons';
import Sheet from '@/ui/Sheet';
import Row from '@/ui/Row';
import { sendIntent, type HardwareView, type UiSnapshot, type Intent } from '@/sources/bridge';
import { связь, меткаСвязи } from '@/domain/deviceState';
import { sourceStatusLabel } from '@/domain/sourceStatus';
import {
  СЛОТ, мостЖелезки, имяЖелезки, адресВЭфире, звеноЦепочки, словоЦепочки,
} from '@/domain/nearby';

/* Карточка одного прибора (SugarLife#301).

   Её не было вовсе. Список приборов подписан «тапни устройство — там все действия», но
   плитка ничем не открывалась: подсказка обещала экран, которого не существует. И на
   него же указывал единственный оставшийся путь.

   ПОЧЕМУ ЭТО БЫЛО ТУПИКОМ. «Подключить» на плитке показывалось, только когда прибор
   замечен в эфире. Замысел верный: кнопка, которая заведомо ничего не даст (прибор в
   другой комнате), читается как поломка приложения. Но у известного прибора «рядом»
   берётся из эфира, а в эфир он попадёт, только когда его слушают, — получилось кольцо:
   подключить нельзя, потому что не видно, а не видно, потому что не подключён. Поиск
   нового не спасает: он по построению показывает только НЕзнакомых.

   ПОЭТОМУ ЗДЕСЬ «ПОДКЛЮЧИТЬ» ЕСТЬ ВСЕГДА. Карточку открывают намеренно — это и есть та
   осознанность, ради которой действие убрали с плитки. А раз оно может не сработать,
   рядом сказано почему: прибор должен быть рядом и свободен. Обещания «сейчас
   подключится» тут нет.

   «Забыть» уводит запись из движка целиком (removeDevice, rev ≥ 1.8), поэтому со
   спросом: вернуть прибор можно только новым поиском, а серийник и мост придётся
   вводить заново. */
export default function HardwareSheet({ прибор, снимок, onClose }: {
  прибор: HardwareView;
  снимок: UiSnapshot | null | undefined;
  onClose: () => void;
}) {
  const [ждём, setЖдём] = useState<string | null>(null);

  const состояние = связь(прибор);
  const живой = состояние === 'live';
  const звено = звеноЦепочки(прибор, снимок);
  const мост = мостЖелезки(прибор, снимок);
  const адрес = адресВЭфире(прибор);

  const строка = звено
    ? словоЦепочки(звено, мост ? имяЖелезки(мост) : null)
    : sourceStatusLabel(прибор.status) ?? меткаСвязи[состояние];

  const шли = (intent: Intent, метка: string) => {
    setЖдём(метка);
    void Promise.resolve(sendIntent(intent)).finally(() => setЖдём(null));
  };

  const забыть = () => {
    if (!window.confirm(
      `Забыть «${имяЖелезки(прибор)}»? Запись уйдёт из приложения целиком — серийник, мост и `
      + 'настройки драйвера. Вернуть прибор можно будет только новым поиском.',
    )) return;
    шли({ type: 'removeDevice', deviceId: прибор.id }, 'забыть');
    onClose();
  };

  return (
    <Sheet isOpen onClose={onClose} title={имяЖелезки(прибор)} subtitle={строка ?? undefined}>
      <div className="list">
        {/* Адрес в эфире — чтобы различать два одинаковых прибора. Нет — не выдумываем. */}
        {адрес && <Row title="Адрес" value={адрес} chevron={false} oneLine />}
        {прибор.inSlot && <Row title="Слот" value={СЛОТ[прибор.inSlot]} chevron={false} />}
        {/* Телеметрия — только то, что прибор реально отдал (core#38). Пустых строк не
            рисуем: «заряд —» ничем не лучше отсутствия строки. */}
        {прибор.batteryPct != null && (
          <Row title="Заряд" value={`${прибор.batteryPct}%`} chevron={false} />
        )}
        {прибор.firmware && <Row title="Прошивка" value={прибор.firmware} chevron={false} />}
      </div>

      <div className="list" style={{ marginTop: 12 }}>
        {живой ? (
          /* У моста действие иное по смыслу: блютус держит один центральный, и пока
             держим мы, другой телефон к мосту не подключится (SugarLifeCore#50). */
          <Row icon={pauseOutline} chevron={false} disabled={!!ждём}
            title={прибор.kind === 'bridge' ? 'Отпустить' : 'Приостановить'}
            sub={прибор.kind === 'bridge'
              ? 'освободить мост для другого телефона'
              : 'разорвать связь; запись о приборе останется'}
            onClick={() => шли({ type: 'disconnect', deviceId: прибор.id }, 'пауза')} />
        ) : (
          <Row icon={playOutline} chevron={false} disabled={!!ждём}
            title={ждём === 'подключить' ? 'Подключаю…' : 'Подключить'}
            sub="получится, если прибор рядом и не занят другим телефоном"
            onClick={() => шли({ type: 'connect', deviceId: прибор.id }, 'подключить')} />
        )}

        {/* «Прочитать сейчас» имеет смысл только при живой связи: без неё запрос уйдёт в
            никуда, а человек решит, что сломан прибор. */}
        {живой && (
          <Row icon={refreshOutline} chevron={false} disabled={!!ждём}
            title={ждём === 'читать' ? 'Читаю…' : 'Прочитать сейчас'}
            sub="не ждать очередного опроса"
            onClick={() => шли({ type: 'readNow', deviceId: прибор.id }, 'читать')} />
        )}

        <Row icon={trashOutline} chevron={false} disabled={!!ждём}
          title="Забыть прибор" sub="убрать запись из приложения" onClick={забыть} />
      </div>
    </Sheet>
  );
}
