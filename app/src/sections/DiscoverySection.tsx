import { IonIcon, IonSpinner } from '@ionic/react';
import { bluetoothOutline, radioOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import Section from '@/ui/Section';
import Row from '@/ui/Row';
import DeviceScanSheet from '@/sheets/DeviceScanSheet';
import { useSnapshot, sendIntent } from '@/sources/bridge';
import { plural } from '@/domain/units';
import { новоеВЭфире } from '@/domain/nearby';
import { близость } from '@/domain/signal';
import { Capacitor } from '@capacitor/core';

// В браузере прямого BLE нет и не будет — это свойство платформы, а не «не разрешили»
const isNative = Capacitor.isNativePlatform();

/* Поиск НОВОГО устройства — вход через эфир, а не через модель.

   У нас сложился перекос: BLE открывался только после того, как человек указал модель.
   Условие не выдуманное — не зная модели, мы не знаем, нужен ли ей мост. Но для вопроса
   «что тут вообще рядом» оно лишнее: движок сам узнаёт, что вещает, по объявлению в
   эфире. Модель уточняется при подключении, а если так и осталась неизвестной — работает
   облако, как и раньше (SugarLifeCore#12).

   ЧТО ЗДЕСЬ ПОЯВЛЯЕТСЯ, А ЧТО НЕТ. Только незнакомое. Раньше в списке вперемешку стояли
   кандидаты на добавление и уже заведённые железки — и заведённый OrangeLink выглядел
   как предложение завести второй такой же (SugarLifeCore#34). Своё железо со своим
   состоянием живёт в «Устройствах», там же «рядом — подключить»: у заведённой железки
   действие «переподключить», у незнакомой — «добавить», и это разные экраны.

   Пустой список тут — не одно состояние, а три, и они требуют разных действий: мы не
   сканируем, сканируем и не находим, или находим не то. Писать на всё «ничего не
   найдено» значит оставить человека гадать. */
export default function DiscoverySection({ onClose }: { onClose: () => void }) {
  const snap = useSnapshot();
  const [scanOpen, setScanOpen] = useState(false);

  const devices = (snap?.devices ?? []).filter((d) => d.kind !== 'service');
  const весьЭфир = snap?.discovered ?? [];
  /* Кандидаты — только незнакомое. Сопоставляет движок (knownDeviceId), а не мы: по
     имени железки повторяются, и перепутать чужой сенсор со своим — худший исход. */
  const discovered = новоеВЭфире(весьЭфир, devices);
  const своиВЭфире = весьЭфир.length - discovered.length;
  const scanning = !!snap?.scanning;

  /* Скан идёт, пока экран открыт, и останавливается при уходе: эфир слушать вхолостую —
     это батарея телефона, и «забыли выключить» здесь стоит дорого. */
  useEffect(() => {
    void sendIntent({ type: 'startScan' });
    return () => { void sendIntent({ type: 'stopScan' }); };
  }, []);

  const пусто = discovered.length === 0;

  return (
    <Section title="Найти устройство" описание="Приборы, которые сейчас вещают в эфир и ещё не заведены. Уже известные сюда не попадают — они в списке «Мои устройства»." onBack={onClose}>

      <div className="section-label sec">Незнакомые в эфире</div>
      <div className={'scan-state' + (scanning ? ' on' : '')}>
        {scanning ? <IonSpinner name="crescent" /> : <IonIcon icon={bluetoothOutline} />}
        <span>{scanning ? 'Слушаю эфир…' : 'Поиск не идёт'}</span>
      </div>

      {!пусто && (
        <div className="list">
          {discovered.map((d) => (
            <Row key={d.bleId} icon={d.isTransport ? radioOutline : bluetoothOutline}
              /* Имя из эфира — только если оно добавляет что-то к опознанному: у
                 половины железок они совпадают, и строка «Dexcom G7 · Dexcom G7»
                 выглядит сбоем. */
              title={d.displayName} sub={d.name && d.name !== d.displayName ? d.name : undefined}
              value={близость(d.rssi)} onClick={() => setScanOpen(true)} />
          ))}
        </div>
      )}

      {пусто && (
        <div className="sheet-note">
          {/* В браузере блютуса нет как класса, и списывать пустой эфир на разрешения
              здесь — враньё: человек пойдёт их проверять и ничего не найдёт (#163).
              Причина у пустоты разная, и объяснение должно быть разное. */}
          {!isNative
            ? 'В браузере блютуса нет — это свойство браузера, а не настроек. Поиск устройств работает в приложении на телефоне; данные при этом продолжают идти через облако.'
            : !scanning
            ? 'Поиск не идёт. Обычно это значит, что приложению не разрешили блютус — проверь в настройках телефона.'
            : 'Пока никого. Держи устройство ближе к телефону. Если оно уже подключено к другому телефону или к родному приложению производителя, в эфире его не будет: у сенсора один хозяин за раз.'}
        </div>
      )}

      {discovered.length > 0 && (
        <div className="sheet-note">
          Нашли {discovered.length} {plural(discovered.length, 'незнакомое устройство', 'незнакомых устройства', 'незнакомых устройств')}.
          Модель заранее указывать не нужно — приложение узнаёт по эфиру, что это, и спросит
          недостающее при подключении.
        </div>
      )}

      {/* Своё железо в эфире не прячем молча: человек ищет глазами знакомое имя и, не
          найдя, решит, что связи нет. Говорим, где оно, и не предлагаем завести
          второе. */}
      {своиВЭфире > 0 && (
        <div className="sheet-note">
          Рядом {своиВЭфире === 1 ? 'ещё одно устройство' : `ещё ${своиВЭфире}`} — но {своиВЭфире === 1 ? 'оно уже заведено' : 'они уже заведены'}.
          Состояние и «подключить» — в «Устройствах», здесь только новое.
        </div>
      )}

      <DeviceScanSheet isOpen={scanOpen} onClose={() => setScanOpen(false)} title="Что рядом" />
    </Section>
  );
}
