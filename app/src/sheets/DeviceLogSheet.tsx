import { useCallback, useEffect, useState } from 'react';
import { IonIcon, IonToggle } from '@ionic/react';
import { shareOutline, checkmarkCircle } from 'ionicons/icons';
import Sheet from '@/ui/Sheet';
import { запросЖурнала, sendIntent, type HardwareView, type LogRecord } from '@/sources/bridge';
import {
  ОБЫЧНЫЙ_УРОВЕНЬ, важнее, естьИдентификаторы, подробноЕщёМинут, словоПустого,
  времяЗаписи, строкаПолей,
} from '@/domain/deviceLog';

/* «Что происходит» — живой обмен с ОДНИМ прибором (SugarLife#354, мост 1.25).

   Не консоль разработчика на главном экране. Обычному человеку это не нужно никогда — до
   того дня, когда прибор замолчит; поэтому место здесь, в карточке прибора, рядом с «нет
   связи», куда он и так придёт за ответом.

   ЖИВОЙ — значит опросом, а не подпиской: журнал приходит запросом (записей тысячи, в
   снимок им нельзя), и «живость» здесь наша. Две секунды — компромисс между «видно, как
   идёт» и «не жжём батарею»; опрос идёт, только пока шторка открыта.

   Автопрокрутки нет намеренно: человек открывает журнал, чтобы прочитать, что случилось,
   а прыгающий список читать нельзя. Новое приходит сверху — там же, где он смотрит. */
const ШАГ_МС = 2000;
const СКОЛЬКО = 200;

export default function DeviceLogSheet({ прибор, onClose }: {
  прибор: HardwareView; onClose: () => void;
}) {
  const [записи, setЗаписи] = useState<LogRecord[] | null>(null);
  const [журналЕсть, setЖурналЕсть] = useState(true);
  const [подробно, setПодробно] = useState(false);
  const [сейчас, setСейчас] = useState(() => Date.now());
  const [поделился, setПоделился] = useState(false);

  const обновить = useCallback(async () => {
    const r = await запросЖурнала({ deviceId: прибор.id, limit: СКОЛЬКО });
    setСейчас(Date.now());
    if (!r) { setЖурналЕсть(false); setЗаписи([]); return; }
    setЖурналЕсть(true);
    setЗаписи(r.records);
  }, [прибор.id]);

  useEffect(() => {
    void обновить();
    const id = window.setInterval(() => void обновить(), ШАГ_МС);
    return () => window.clearInterval(id);
  }, [обновить]);

  const все = записи ?? [];
  const видимые = подробно ? все : все.filter((з) => важнее(з, ОБЫЧНЫЙ_УРОВЕНЬ));
  const ещёМинут = подробноЕщёМинут(прибор.logDetailUntilMs, сейчас);

  const переключить = async (вкл: boolean) => {
    setПодробно(вкл);
    await sendIntent({ type: 'setDeviceLogDetail', deviceId: прибор.id, detailed: вкл });
  };

  /* Отправка — с явным вопросом, а не галочкой в настройках. В сырых кадрах лежат
     радио-адрес помпы и код сенсора; блок-лист по именам полей их не ловит, и движок
     помечает такие записи сам. Спросить один раз честнее, чем предупредить однажды в
     настройках и считать, что человек это помнит. */
  const поделиться = async () => {
    if (естьИдентификаторы(все) && !window.confirm(
      'В журнале есть записи с опознавательными данными прибора — радио-адресом помпы и '
      + 'кодом сенсора. Они попадут в выгрузку. Отправляем?',
    )) return;
    await sendIntent({ type: 'exportLog' });
    setПоделился(true);
    window.setTimeout(() => setПоделился(false), 2000);
  };

  return (
    <Sheet isOpen onClose={onClose} title="Что происходит"
      subtitle={`обмен с «${прибор.model || прибор.name}»`}>

      <div className="sync-toggle">
        <div>
          <div className="sync-toggle-title">Подробный обмен</div>
          {/* Срок — словами. Подробность гаснет сама, и переключатель без срока соврал бы
              ровно тогда, когда человек про него забудет. */}
          <div className="sync-toggle-sub">
            {ещёМинут != null
              ? `каждый кадр · сам выключится через ${ещёМинут} мин`
              : 'каждый кадр — сотни записей в минуту; включают, чтобы повторить проблему'}
          </div>
        </div>
        <IonToggle checked={подробно} onIonChange={(e) => void переключить(e.detail.checked)} />
      </div>

      {видимые.length > 0 ? (
        <div className="журнал">
          {поПорядку(видимые).map((з, i) => (
            <div key={`${з.atMs}-${i}`} className={'журнал-строка у-' + з.level.toLowerCase()}>
              <span className="журнал-время">{времяЗаписи(з.atMs)}</span>
              <span className="журнал-текст">
                {з.event}
                {строкаПолей(з.fields) && <span className="журнал-поля">{строкаПолей(з.fields)}</span>}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="sheet-note" style={{ marginTop: 12 }}>
          {словоПустого({ журналЕсть, всегоЗаписей: все.length })}
        </div>
      )}

      <div className="list" style={{ marginTop: 12 }}>
        <button className="list-row" onClick={() => void поделиться()} disabled={!все.length}>
          <IonIcon icon={поделился ? checkmarkCircle : shareOutline} className="list-ico" />
          <span className="pick-main">
            <span className="list-title">{поделился ? 'Отправлено' : 'Поделиться журналом'}</span>
            <span className="pick-sub">выгрузка целиком — переслать нам, когда что-то не так</span>
          </span>
        </button>
      </div>
    </Sheet>
  );
}

/* Новое сверху. Движок отдаёт по возрастанию времени, а смотрят всегда последнее — и
   пролистывать до него значит листать мимо того, ради чего экран открыли. */
function поПорядку(з: LogRecord[]): LogRecord[] {
  return [...з].sort((a, b) => b.atMs - a.atMs);
}
