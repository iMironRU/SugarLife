import { useState, useRef } from 'react';
import { часы } from '@/слова/время';
import Row from '@/ui/Row';
import { IonIcon, IonInput, IonButton } from '@ionic/react';
import {
  linkOutline, keyOutline, chevronForward, chevronBack, cloudOutline,
  listOutline, bluetoothOutline, downloadOutline, checkmarkCircle, hardwareChipOutline, flash,
} from 'ionicons/icons';
import BrandDrop from '@/ui/BrandDrop';
import CatalogPicker from '@/sheets/CatalogPicker';
import { pumpItems, sensorItems, modelTitle } from '@/sheets/modelItems';
import RequirementsCatalogSheet from '@/sheets/RequirementsCatalogSheet';
import DevicesSection from '@/sections/DevicesSection';
import { useSnapshot, sendIntent, эфирДоступен } from '@/sources/bridge';
import { железоДиспетчера, имяЖелезки } from '@/domain/nearby';
import { мешает as помеха, спроситьМожно } from '@/domain/scanReadiness';
import Готовность from '@/ui/Готовность';
import { связь } from '@/domain/deviceState';
import { probeCloud, checkReadAccess, type CloudProbe } from '@/sources/nightscout';
import { addCloud } from '@/sources/clouds';
import { refresh } from '@/sources/store';
import { setDeviceConfig, UNKNOWN_MODEL } from '@/settings/deviceConfig';
import { setOnboarded } from '@/settings/onboarding';
import { toUnits, unitLabel } from '@/domain/units';


/* Ведём на СВОЮ страницу «где взять», а не на GitHub Releases (#316).

   Там человек видел `android-latest`, список `.apk`, `Source code (zip)` и красный
   `Pre-release`: не страшно, а непонятно — что качать, безопасно ли, что будет дальше.
   И ссылка была одна на всех: с айфона она вела туда, где лежит только APK. */
const ГДЕ_ВЗЯТЬ = 'https://imiron.ru/SugarLife/install.html';

type Step = 'welcome' | 'ways' | 'доступ' | 'scan' | 'cloud' | 'streams';

/* Мастер первого запуска (docs/CONNECT-UX.md §7, путь 1) — discovery-first.
   Не «сначала Nightscout», а «как будем доставать данные»: прямое подключение / QR /
   облако / каталог моделей. В вебе прямого BLE нет физически — не изображаем поиск,
   которого не существует, а честно ведём в нативное приложение. */
export default function Onboarding() {
  const [step, setStep] = useState<Step>('welcome');
  const снимок = useSnapshot();
  /* Эфир, а не «нативная сборка» (#337). Признак — живой мост: в вебе его нет, в демо
     есть, и локальная копия проходит железный путь целиком. */
  const эфир = эфирДоступен();
  const железо = железоДиспетчера(снимок);
  const заведено = железо.length;
  /* Вышел ли кто-нибудь на связь. Разница между «завёл» и «работает» — единственное, что
     человека здесь занимает, и говорить «данные пойдут, когда выйдет на связь» о приборе,
     который уже на связи, значит обещать в прошедшем времени. */
  const живой = железо.find((h) => связь(h) === 'live') ?? null;
  const готовность = снимок?.scanReadiness ?? null;

  // --- шаг «облако» ---
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [probe, setProbe] = useState<CloudProbe | null>(null);
  // Поле токена показываем, только если сервер РЕАЛЬНО закрыт (ответил 401/403).
  // У Nightscout по умолчанию чтение открыто — просить токен «на всякий случай»
  // значит требовать лишнего и отпугивать на первом же шаге.
  const [needToken, setNeedToken] = useState(false);

  // --- шаг «потоки → устройства» ---
  const [sensorId, setSensorId] = useState<string | null>(null);
  const [pumpId, setPumpId] = useState<string | null>(null);
  const [pick, setPick] = useState<null | 'sensor' | 'pump'>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const skip = () => setOnboarded(true); // «настрою потом» — приложение с прочерками

  const doProbe = async () => {
    const u = url.trim(), t = token.trim();
    if (!u) { setMsg('Введите адрес сайта'); return; }
    setBusy(true); setMsg('Проверяю доступ…'); setProbe(null);
    try {
      // сначала — нужен ли вообще токен
      const access = await checkReadAccess(u, t || undefined);
      if (access === 'needsToken') {
        setNeedToken(true);
        setBusy(false);
        setMsg(t
          ? 'Токен не подошёл — нужен с правом чтения.'
          : 'Этот Nightscout закрыт: нужен токен с правом чтения.');
        return;
      }
      if (access === 'unreachable') {
        setBusy(false);
        setMsg('Сайт не отвечает. Проверьте адрес.');
        return;
      }
      setNeedToken(false);
      setMsg('Смотрю, что есть в облаке…');
      const p = await probeCloud(u, t);
      setProbe(p);
      if (!p.glucose && !p.pump) {
        setMsg('Сервер ответил, но ни глюкозы, ни статуса помпы там нет. Проверьте адрес и токен.');
      } else {
        setMsg('');
        setStep('streams');
      }
    } catch (e: any) {
      setMsg('Не удалось подключиться: ' + (e?.message || e));
    }
    setBusy(false);
  };

  // Записываем облако + устройства под найденные потоки и открываем приложение.
  /* Одно нажатие — одно облако. Двойной тап по кнопке (на телефоне это обычное дело)
     иначе добавляет второй экземпляр того же адреса: дублей в данных не будет, их
     отсеет слияние по времени, но опрашивать сайт мы станем дважды, и в списке
     источников появится непонятный близнец. Флаг вместо состояния — он должен
     сработать в том же кадре, до перерисовки. */
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    /* Модель — необязательный ответ, и подключение от неё не зависит.
       Раньше поток включался только вместе с выбранной моделью, а кнопка «Готово»
       была заблокирована без неё — то есть проверенное рабочее облако выбрасывалось
       из-за вопроса, на который мы сами разрешили не отвечать.

       Нашли поток — значит источник есть, его и включаем. Устройство при этом
       записываем со статусом «модель неизвестна» (§2a): это законное состояние —
       чтение из облака работает, недоступно только прямое, для которого и нужно
       знать, требуется ли железке мост. */
    const sensor = probe?.glucose ? sensorId ?? UNKNOWN_MODEL : sensorId;
    const pump = probe?.pump ? pumpId ?? UNKNOWN_MODEL : pumpId;
    addCloud({
      kind: 'nightscout',
      name: (() => { try { return new URL(url.trim()).host; } catch { return url.trim(); } })(),
      url: url.trim(), token: token.trim(), enabled: true,
      sourceGlucose: !!probe?.glucose,
      sourcePumpStatus: !!probe?.pump,
    });
    setDeviceConfig({
      ...(sensor ? { sensorId: sensor } : {}),
      ...(pump ? { pumpId: pump } : {}),
    });
    setOnboarded(true);
    refresh();
  };

  // ---------- welcome ----------
  if (step === 'welcome') {
    return (
      <div className="connect">
        <BrandDrop size={92} />
        <h1 className="connect-title">SladkaЯ жизнь</h1>
        <p className="connect-desc">
          Подключим ваши устройства — сенсор и помпу. Напрямую, если приложение видит их рядом,
          или через облако, если данные уже уходят в Nightscout.
        </p>
        <div className="connect-form">
          <IonButton expand="block" className="connect-btn" onClick={() => setStep('ways')}>
            <IonIcon icon={chevronForward} slot="start" />
            Подключить устройство
          </IonButton>
          <button className="ob-skip" onClick={skip}>Уже настроено — просто открыть</button>
        </div>
      </div>
    );
  }

  // ---------- ways: три способа ----------
  if (step === 'ways') {
    return (
      <div className="connect ob-page">
        <div className="ob-head">
          <button className="sheet-close" onClick={() => setStep('welcome')} aria-label="Назад">
            <IonIcon icon={chevronBack} />
          </button>
          <div>
            <div className="sheet-title">Как подключим</div>
            <div className="sheet-subtitle">Выберите, откуда брать данные</div>
          </div>
        </div>

        {/* Прямое подключение: в вебе BLE нет — не изображаем поиск, ведём в приложение */}
        <div className="list">
          {эфир ? (
            /* Скан, а не каталог (#331). Обе строки открывали одно и то же — каталог
               моделей, — и человек, нажавший «найти рядом», получал вопрос «назови свою
               модель»: ровно тот, ради которого он и нажал кнопку.

               Порядок у нас discovery-first (SugarLifeCore#43): сначала показать, что
               реально вещает рядом, и только потом спрашивать модель — у тех, кого в
               эфире не видно. */
            <Row icon={bluetoothOutline} title="Найти рядом" sub="посмотрим, что вещает вокруг"
              /* Знаем, что поиск возможен — не задерживаем лишним шагом. Не знаем или
                 знаем, что нет, — сначала объясняем, потом спрашиваем (#333). */
              onClick={() => setStep(готовность?.canScan ? 'scan' : 'доступ')} />
          ) : (
            <Row icon={downloadOutline} title="Найти рядом — в приложении"
              sub="браузер не умеет Bluetooth · почему так и что тогда делать" href={ГДЕ_ВЗЯТЬ} />
          )}

          <Row icon={cloudOutline} title="Через облако" sub="данные из Nightscout — работает уже сейчас"
            onClick={() => setStep('cloud')} />

          {/* Каталог — запасной путь: он для тех, кого в эфире не нашли. Поэтому и
              стоит ниже, и подписан как ответ на неудачу поиска. */}
          <Row icon={listOutline} title="Выбрать модель" sub="если в эфире не нашлось — скажем, что нужно"
            onClick={() => setCatalogOpen(true)} />

          {/* Отдельного «подключения по QR» здесь больше нет (#350).

              Строка обещала способ подключения, а код с коробки — это ОДНО ПОЛЕ одного
              прибора, а не путь. Сканер живёт там, где это поле спрашивают: нашли сенсор
              в эфире → «Добавить» → «Код сенсора» с кнопкой камеры. Третий вход в то же
              самое, да ещё подписанный «в разработке», только делал вид, что у нас есть
              нерассказанная возможность. */}
        </div>

        <button className="ob-skip" onClick={skip}>Пропустить — настрою потом</button>
        <RequirementsCatalogSheet isOpen={catalogOpen} onClose={() => setCatalogOpen(false)} />
      </div>
    );
  }

  /* ---------- доступ: объясняем ДО системного диалога ----------

     Разрешение, о котором не объяснили заранее, отклоняют — и второй раз система его
     уже не покажет (#333). Цена отказа здесь выше задержки: человек останется без
     блютуса навсегда и не поймёт, почему приложение ничего не находит.

     Это объяснение, а не список красных крестиков. Что именно не так — знает движок, он
     же запускает скан; наша проверка была бы вторым мнением о том же. Поэтому текст
     общий, а разбор конкретной причины приходит из снимка ниже. */
  if (step === 'доступ') {
    /* Показываем препятствие, только если оно НЕ то, о котором и так сказано абзацем
       выше. Невыданное разрешение, которое система ещё может спросить, — это ровно
       следующая кнопка; повторять его тревожной плашкой и второй кнопкой «Открыть
       настройки» значит предложить два занятия сразу и намекнуть, что первое не
       сработает. Отказ «навсегда» — другое дело: там кнопка и есть единственный выход. */
    const п = помеха(снимок);
    const мешаетТут = спроситьМожно(п) ? null : п;
    return (
      <div className="connect ob-page">
        <div className="ob-head">
          <button className="sheet-close" onClick={() => setStep('ways')} aria-label="Назад">
            <IonIcon icon={chevronBack} />
          </button>
          <div>
            <div className="sheet-title">Поиск приборов</div>
            <div className="sheet-subtitle">Один раз спросим доступ</div>
          </div>
        </div>

        <p className="connect-desc">
          Чтобы услышать сенсор или мост, телефону нужно разрешение на поиск по блютусу.
          Сейчас он его спросит — ответьте «разрешить». Поиск идёт на самом телефоне,
          наружу при этом ничего не уходит.
        </p>
        <div className="sheet-note">
          На Android до 12 система вдобавок требует включённую службу геолокации: без неё
          она не покажет ни одного устройства, даже когда блютус включён. Это её правило,
          не наше — местоположением мы не пользуемся.
        </div>

        {/* Что мешает прямо сейчас — если движок уже знает. Здесь это не пугает, а
            экономит шаг: человек чинит причину, не выходя с экрана, и снимок сам
            перестаёт на неё жаловаться. Тот же блок, что в «Приборах» и диагностике. */}
        <Готовность помеха={мешаетТут} />

        <div className="connect-form">
          <IonButton expand="block" className="connect-btn"
            onClick={() => { void sendIntent({ type: 'requestScanPermissions' }); setStep('scan'); }}>
            <IonIcon icon={bluetoothOutline} slot="start" />
            Разрешить и начать поиск
          </IonButton>
        </div>
        <button className="ob-skip" onClick={skip}>Пропустить — настрою потом</button>
      </div>
    );
  }

  /* ---------- scan: та же лента, что и в «Приборах» ----------

     Именно та же, а не своя копия: у мастера был отдельный поиск, и он разошёлся с
     разделом в первую же правку — там одна лента со своими и новыми, здесь остался
     список только незнакомых. Первый запуск учил одному поведению, а приложение назавтра
     показывало другое.

     Кнопка «Готово» появляется, только когда прибор действительно заведён. Раньше выхода
     отсюда не было вовсе: человек добавлял сенсор и оставался в мастере — новый сенсор
     греется часами, первого показания нет, и мастер молча стоял на месте, как будто
     ничего не произошло. */
  if (step === 'scan') {
    return (
      <div className="connect ob-page">
        <div className="ob-head">
          <button className="sheet-close" onClick={() => setStep('ways')} aria-label="Назад">
            <IonIcon icon={chevronBack} />
          </button>
          <div>
            <div className="sheet-title">Что рядом</div>
            <div className="sheet-subtitle">Тапните прибор, чтобы завести</div>
          </div>
        </div>

        <DevicesSection встроенный толькоЛента />

        <div className="connect-form">
          {заведено > 0 ? (
            <>
              {/* Говорим о результате словом, а не оставляем человека сверять список:
                  «завёл или нет» — единственный вопрос, с которым он сюда пришёл. */}
              <div className="sheet-note">
                {живой
                  ? `${имяЖелезки(живой)} на связи — данные пошли.`
                  : `Заведено ${заведено === 1 ? 'устройство' : `устройств: ${заведено}`}. Данные пойдут, как только прибор выйдет на связь: новый сенсор греется — это часы, и это нормально.`}
              </div>
              <IonButton expand="block" className="connect-btn" onClick={() => setOnboarded(true)}>
                <IonIcon icon={checkmarkCircle} slot="start" />
                Готово
              </IonButton>
            </>
          ) : (
            <button className="ob-skip" onClick={skip}>Пропустить — настрою потом</button>
          )}
        </div>
      </div>
    );
  }

  // ---------- cloud: адрес → разведка ----------
  if (step === 'cloud') {
    return (
      <div className="connect ob-page">
        <div className="ob-head">
          <button className="sheet-close" onClick={() => setStep('ways')} aria-label="Назад">
            <IonIcon icon={chevronBack} />
          </button>
          <div>
            <div className="sheet-title">Через облако</div>
            <div className="sheet-subtitle">Nightscout</div>
          </div>
        </div>

        <p className="connect-desc">
          Посмотрим, какие данные там реально есть, и подключим только их. Только чтение.
          Токен спросим, лишь если ваш Nightscout закрыт. Всё хранится на этом устройстве.
        </p>

        <div className="connect-form">
          <div className="field">
            <IonIcon icon={linkOutline} className="field-ico" />
            <IonInput value={url} onIonInput={(e) => setUrl(e.detail.value ?? '')} placeholder="https://ваш-сайт.nightscout…" inputmode="url" autocapitalize="off" />
          </div>
          {needToken && (
            <>
              <div className="field-label">Токен доступа · с правом чтения</div>
              <div className="field">
                <IonIcon icon={keyOutline} className="field-ico" />
                <IonInput value={token} onIonInput={(e) => setToken(e.detail.value ?? '')} placeholder="токен с ролью readable" autocapitalize="off" />
              </div>
            </>
          )}
          <IonButton expand="block" className="connect-btn" onClick={doProbe} disabled={busy}>
            <IonIcon icon={cloudOutline} slot="start" />
            {busy ? 'Проверяю…' : needToken ? 'Проверить с токеном' : 'Посмотреть, что есть'}
          </IonButton>
          <div className="connect-msg">{msg}</div>
        </div>

        <button className="ob-skip" onClick={skip}>Пропустить — настрою потом</button>
      </div>
    );
  }

  // ---------- streams: что нашли → чьё это ----------
  const glucoseAt = probe?.glucose?.at ? часы(probe.glucose.at) : null;
  const pumpBits = [
    probe?.pump?.reservoir != null ? Math.round(probe.pump.reservoir) + ' ед' : null,
    probe?.pump?.battery != null ? probe.pump.battery + '%' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="connect ob-page">
      <div className="ob-head">
        <button className="sheet-close" onClick={() => setStep('cloud')} aria-label="Назад">
          <IonIcon icon={chevronBack} />
        </button>
        <div>
          <div className="sheet-title">Что нашли</div>
          <div className="sheet-subtitle">Осталось сказать, чьи это данные</div>
        </div>
      </div>

      <div className="list">
        {probe?.glucose && (
          <Row icon={hardwareChipOutline} onClick={() => setPick('sensor')}
            title={`Глюкоза · ${toUnits(probe.glucose.mmol)} ${unitLabel()}`}
            sub={(glucoseAt ? `последнее в ${glucoseAt} · ` : '') + (modelTitle('sensor', sensorId) ?? 'какой у вас сенсор?')}
            right={sensorId ? <IonIcon icon={checkmarkCircle} className="list-chev" /> : undefined} />
        )}
        {probe?.pump && (
          <Row icon={flash} onClick={() => setPick('pump')}
            title={`Статус помпы${pumpBits ? ' · ' + pumpBits : ''}`}
            sub={modelTitle('pump', pumpId) ?? 'какая у вас помпа?'}
            right={pumpId ? <IonIcon icon={checkmarkCircle} className="list-chev" /> : undefined} />
        )}
      </div>

      <div className="sheet-note">
        Модель можно не указывать — данные пойдут в любом случае. Она нужна только для
        будущего перехода с облака на прямое чтение: чтобы знать, нужен ли железке мост.
        Спросим ещё раз, когда до этого дойдёт.
      </div>

      <div className="connect-form">
        {/* Не блокируется: модели необязательны, а облако уже проверено и работает. */}
        <IonButton expand="block" className="connect-btn" onClick={finish}>
          <IonIcon icon={checkmarkCircle} slot="start" />
          Подключить
        </IonButton>
      </div>
      {/* «Пропустить» здесь нет намеренно: на этом шаге пропуск молча выбрасывал
          рабочее подключение. Отказаться можно шагом назад, до проверки. */}

      <CatalogPicker
        isOpen={pick === 'sensor'} onClose={() => setPick(null)}
        title="Какой у вас сенсор?" subtitle="Справочник моделей"
        items={sensorItems} selectedId={sensorId} onSelect={setSensorId} currentLabel="только актуальные"
      />
      <CatalogPicker
        isOpen={pick === 'pump'} onClose={() => setPick(null)}
        title="Какая у вас помпа?" subtitle="Справочник моделей"
        items={pumpItems} selectedId={pumpId} onSelect={setPumpId} currentLabel="только актуальные"
      />
    </div>
  );
}
