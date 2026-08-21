import { useEffect, useState } from 'react';
import { IonIcon, IonToggle } from '@ionic/react';
import { alarmOutline, notificationsOutline, playOutline } from 'ionicons/icons';
import Section from '@/ui/Section';
import Row from '@/ui/Row';
import {
  настройкиТревоги, задатьТревогу, проверитьТревогу, тревогиДоступны,
  ПОРОГ_ПО_УМОЛЧАНИЮ, МИН_ПОРОГ, МАКС_ПОРОГ, type НастройкиТревоги,
} from '@/platform/тревоги';
import { isNative, platform } from '@/platform/appUpdate';

/* Тревоги (#418).

   ЧЕСТНОСТЬ ПРО ДОСТАВКУ — ПЕРВЫМ ДЕЛОМ, а не сноской внизу. Человек включает тревогу и
   ложится спать с уверенностью, что его разбудят. Если разбудить мы не можем — сказать об
   этом надо до того, как он уснёт, а не после того, как не проснулся.

   ПРОВЕРОЧНАЯ КНОПКА ОБЯЗАТЕЛЬНА. Иначе узнать, работают ли тревоги, можно только когда
   ночью случится гипогликемия, — худший из возможных способов узнать. Кнопка проходит
   весь путь целиком: канал, звук, обход «не беспокоить», полноэкранное уведомление. */
export default function AlarmsSection({ onClose }: { onClose: () => void }) {
  const [н, setН] = useState<НастройкиТревоги | null>(null);
  const [готово, setГотово] = useState(false);
  const [проверил, setПроверил] = useState(false);

  useEffect(() => {
    void настройкиТревоги().then((r) => { setН(r ?? { on: false, mmol: ПОРОГ_ПО_УМОЛЧАНИЮ }); setГотово(true); });
  }, []);

  const менять = (патч: Partial<НастройкиТревоги>) => {
    const новое = { ...(н ?? { on: false, mmol: ПОРОГ_ПО_УМОЛЧАНИЮ }), ...патч };
    setН(новое);
    void задатьТревогу(новое);
  };

  const порог = н?.mmol ?? ПОРОГ_ПО_УМОЛЧАНИЮ;
  const можем = тревогиДоступны();

  return (
    <Section title="Тревоги" описание="Что должно разбудить и при каких числах. Тревога — это то, что происходит, когда вы не смотрите на экран." onBack={onClose}>

      {/* Предел доставки — до всего остального. */}
      {!можем && (
        <div className="today-alert warn">
          <IonIcon icon={notificationsOutline} className="alert-ico" />
          <div>
            <span className="alert-title">
              {!isNative ? 'В браузере тревог нет' : 'На этом телефоне разбудить не сможем'}
            </span>
            <span>
              {!isNative
                ? 'Браузер не будит: страница спит вместе с телефоном. Тревоги работают в приложении на Android.'
                : platform === 'ios'
                  ? 'На iPhone нет фоновой службы и push-уведомлений, поэтому тревога придёт, только пока приложение открыто. Обещать ночную мы не можем и не будем.'
                  : 'Эта сборка старше тревог — обновите приложение целиком (не только интерфейс).'}
            </span>
          </div>
        </div>
      )}

      <div className="section-label sec">Низкий сахар</div>
      <div className="list">
        <Row icon={alarmOutline} title="Будить при низком сахаре"
          sub={можем ? 'звук будильника, поверх «не беспокоить»' : 'недоступно на этом устройстве'}
          right={<IonToggle checked={!!н?.on} disabled={!можем || !готово}
            onIonChange={(e) => менять({ on: e.detail.checked })} />} />
      </div>

      {н?.on && (
        <>
          <div className="section-label sec">Порог</div>
          <div className="basal-rows">
            <div className="basal-row">
              <span>Будить ниже</span>
              <b>{порог.toFixed(1).replace('.', ',')} ммоль/л</b>
            </div>
          </div>
          <div className="alert-ask alert-ask-row">
            <button className="changed-btn" disabled={порог <= МИН_ПОРОГ}
              onClick={() => менять({ mmol: Math.round((порог - 0.1) * 10) / 10 })}>−0,1</button>
            <button className="changed-btn" disabled={порог >= МАКС_ПОРОГ}
              onClick={() => менять({ mmol: Math.round((порог + 0.1) * 10) / 10 })}>+0,1</button>
          </div>
          {/* Правила, по которым тревога срабатывает, — словами. Человек, который их не
              знает, читает молчание как поломку, а задержку — как «не сработало». */}
          <div className="sheet-note">
            Будим, когда два показания подряд ниже порога: сенсор шумит, и одиночный выброс
            вниз — повод посмотреть, а не будить. Пока сахар не поднялся, тревога
            повторяется — сначала через десять минут, потом реже, до получаса.
          </div>
        </>
      )}

      {можем && (
        <>
          <div className="section-label sec">Проверка</div>
          <button className="changed-btn is-undo во-всю" onClick={() => { void проверитьТревогу(); setПроверил(true); }}>
            <IonIcon icon={playOutline} style={{ marginRight: 6, verticalAlign: -2 }} />
            Проверить тревогу сейчас
          </button>
          <div className="sheet-note">
            {проверил
              ? 'Отправили. Если ничего не слышно — проверьте разрешение на уведомления и «не беспокоить»: тревоги живут в отдельном канале «Тревоги», его громкость и обход задаются в настройках телефона.'
              : 'Пройдёт тем же путём, что настоящая тревога: тот же канал, звук и обход «не беспокоить». Проверьте до того, как ляжете спать, а не после.'}
          </div>
        </>
      )}

      <div className="sheet-note">
        Тревогу считает фоновая служба приложения, а не экран: она живёт, пока приложение
        не убрали из недавних. Убрали — приборы отпускаются и тревог не будет.
      </div>
    </Section>
  );
}
