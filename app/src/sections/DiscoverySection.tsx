import { IonIcon, IonSpinner } from '@ionic/react';
import { bluetoothOutline, radioOutline, pauseOutline, playOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import PageHead from '@/ui/PageHead';
import Row from '@/ui/Row';
import DeviceScanSheet from '@/sheets/DeviceScanSheet';
import { useSnapshot, sendIntent } from '@/sources/bridge';
import { sourceStatusLabel, sourceStatusWarn } from '@/domain/sourceStatus';
import { agoText, plural } from '@/domain/units';
import { близость } from '@/domain/signal';

/* «Устройства рядом» — вход через эфир, а не через модель.

   У нас сложился перекос: BLE открывался только после того, как человек указал модель.
   Условие не выдуманное — не зная модели, мы не знаем, нужен ли ей мост. Но для вопроса
   «что тут вообще рядом» оно лишнее: движок сам узнаёт, что вещает, по объявлению в
   эфире. Модель уточняется при подключении, а если так и осталась неизвестной — работает
   облако, как и раньше (SugarLifeCore#12).

   Это дополнительный вход, а не замена карточке устройства. Карточка отвечает на вопрос
   «как устроено моё хозяйство», этот экран — на «подключись уже наконец».

   Пустой список тут — не одно состояние, а три, и они требуют разных действий: мы не
   сканируем, сканируем и не находим, или находим не то. Писать на всё «ничего не
   найдено» значит оставить человека гадать. */
export default function DiscoverySection({ onClose }: { onClose: () => void }) {
  const snap = useSnapshot();
  const [scanOpen, setScanOpen] = useState(false);

  const devices = (snap?.devices ?? []).filter((d) => d.kind !== 'service');
  const discovered = snap?.discovered ?? [];
  const scanning = !!snap?.scanning;

  /* Скан идёт, пока экран открыт, и останавливается при уходе: эфир слушать вхолостую —
     это батарея телефона, и «забыли выключить» здесь стоит дорого. */
  useEffect(() => {
    void sendIntent({ type: 'startScan' });
    return () => { void sendIntent({ type: 'stopScan' }); };
  }, []);

  /* Уже заведено или новое. Флага в контракте пока нет (попросили в #12), поэтому
     сопоставляем сами и НЕ по совпадению имени: имена у железок повторяются («Dexcom»,
     «MiaoMiao»), и перепутать чужой сенсор со своим — худший исход. Сопоставляем по
     bleId, который должен встречаться в идентификаторе записи; не встретился — считаем
     новым. Ошибиться в эту сторону безопасно: получится лишний экран подключения, а не
     подключение не к тому. */
  const заведено = (bleId: string) => devices.find((d) => d.id.includes(bleId)) ?? null;

  const пусто = discovered.length === 0;

  return (
    <div className="sheet stack-body">
      <PageHead title="Устройства рядом" subtitle="Подключить новое или вернуть связь" onBack={onClose} />

      {devices.length > 0 && (
        <>
          <div className="section-label sec">Подключены</div>
          <div className="list">
            {devices.map((d) => {
              const статус = sourceStatusLabel(d.status);
              const живой = d.connection === 'Connected' || d.connection === 'Streaming';
              return (
                <div key={d.id} className="list-row">
                  <IonIcon icon={bluetoothOutline} className={'list-ico' + (живой ? '' : ' muted')} />
                  <span className="pick-main">
                    <span className="list-title">{d.name}</span>
                    <span className={'pick-sub' + (sourceStatusWarn(d.status) ? ' warn' : '')}>
                      {статус ?? (живой ? 'на связи' : 'не подключено')}
                      {d.latestAtMs != null && ' · ' + agoText(d.latestAtMs)}
                    </span>
                  </span>
                  <button className="changed-btn"
                    onClick={() => sendIntent({ type: живой ? 'disconnect' : 'connect', deviceId: d.id })}>
                    <IonIcon icon={живой ? pauseOutline : playOutline} />
                    {живой ? 'Пауза' : 'Подключить'}
                  </button>
                </div>
              );
            })}
          </div>
          {devices.some((d) => d.note) && (
            <div className="sheet-note warn">
              {devices.find((d) => d.note)?.note}
            </div>
          )}
        </>
      )}

      <div className="section-label sec">Рядом в эфире</div>
      <div className={'scan-state' + (scanning ? ' on' : '')}>
        {scanning ? <IonSpinner name="crescent" /> : <IonIcon icon={bluetoothOutline} />}
        <span>{scanning ? 'Слушаю эфир…' : 'Поиск не идёт'}</span>
      </div>

      {!пусто && (
        <div className="list">
          {discovered.map((d) => {
            const своё = заведено(d.bleId);
            return (
              <Row key={d.bleId} icon={d.isTransport ? radioOutline : bluetoothOutline}
                title={d.displayName}
                sub={[d.name, своё ? 'уже заведено' : null].filter(Boolean).join(' · ') || undefined}
                value={близость(d.rssi)}
                onClick={() => (своё
                  ? sendIntent({ type: 'connect', deviceId: своё.id })
                  : setScanOpen(true))} />
            );
          })}
        </div>
      )}

      {пусто && (
        <div className="sheet-note">
          {!scanning
            ? 'Поиск не идёт. Обычно это значит, что приложению не разрешили блютус — проверь в настройках телефона.'
            : 'Пока никого. Держи устройство ближе к телефону. Если оно уже подключено к другому телефону или к родному приложению производителя, в эфире его не будет: у сенсора один хозяин за раз.'}
        </div>
      )}

      {discovered.length > 0 && (
        <div className="sheet-note">
          Нашли {discovered.length} {plural(discovered.length, 'устройство', 'устройства', 'устройств')}.
          Модель заранее указывать не нужно — приложение узнаёт по эфиру, что это, и спросит
          недостающее при подключении.
        </div>
      )}

      <DeviceScanSheet isOpen={scanOpen} onClose={() => setScanOpen(false)} title="Что рядом" />
    </div>
  );
}
