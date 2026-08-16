import { IonIcon } from '@ionic/react';
import Section from '@/ui/Section';
import { DeviceSection } from '@/sections/lazy';
import Row from '@/ui/Row';
import {
  hardwareChipOutline, flash, speedometerOutline, helpCircleOutline,
  bluetoothOutline, radioOutline, searchOutline, playOutline, pauseOutline,
} from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useStore } from '@/sources/store';
import { useDeviceConfig, deviceStatus, deviceStatusLabel } from '@/settings/deviceConfig';
import { pumpById, sensorById } from '@/domain/catalog';
import { useSnapshot, sendIntent } from '@/sources/bridge';
import {
  железоДиспетчера, СЛОТ, рядомЖелезо, мостЖелезки, имяЖелезки, адресВЭфире,
  заМостомЛи, звеноЦепочки, словоЦепочки,
} from '@/domain/nearby';
import { связь, меткаСвязи } from '@/domain/deviceState';
import { расходка, подписьРасходки } from '@/domain/supplies';
import { agoText } from '@/domain/units';
import { sourceStatusLabel } from '@/domain/sourceStatus';
import { DiscoverySection } from '@/sections/lazy';
import { слотПоСнимку, путьСлота, ПОДПИСЬ_СЛОТА } from '@/domain/slotStatus';
import type { DeviceCatKey } from './DeviceSection';
import { useStack } from '@/app/stackCtx';
import RequirementsCatalogSheet from '@/sheets/RequirementsCatalogSheet';

/* Профиль → «Устройства» — отдельный полноэкранный раздел (не вложенная секция), как в
   docs/CONNECT-UX.md §10 «Карта интерфейса». Группировка по классу устройства (§2a: реестр).
   Детали (резервуар/батарея и т.п.) показываем только когда данные реально есть — честно. */
/* Раздел живёт вкладкой внутри «Устройств и данных» (SugarLife#279). */
export default function DevicesSection({ onClose, встроенный }: {
  onClose?: () => void; встроенный?: boolean;
}) {
  const { push, pop } = useStack();
  const { data } = useStore();
  const devCfg = useDeviceConfig();
  const [reqOpen, setReqOpen] = useState(false);

  const pump = pumpById(devCfg.pumpId);
  const sensor = sensorById(devCfg.sensorId);
  const dev = data?.device ?? null;
  /* Через что живёт роль — из снимка движка (SugarLifeCore#34). Строка роли раньше
     говорила только «настроено», и это отвечало на вопрос про настройку, а не про
     то, работает ли связь и откуда. */
  const снимок = useSnapshot();
  /* Откуда идут цифры — в строке слота, а не только в карточке. Это другой вопрос,
     чем «на связи ли»: помпа может молчать по радио, а данные идти из Nightscout, и
     человеку важно видеть это, не открывая карточку (#224). */
  const путьПомпы = путьСлота(снимок, 'pump');
  const путьСенсора = путьСлота(снимок, 'sensor');

  /* Состояние слота спрашиваем у движка, а локальную запись держим запасным ответом
     (#224). Из-за двух источников строка сенсора умудрялась показывать «по радио» и
     «только через облако» одновременно — про одно и то же устройство. */
  const состояние = (роль: 'sensor' | 'pump') => {
    const изДвижка = слотПоСнимку(снимок, роль);
    return изДвижка ? ПОДПИСЬ_СЛОТА[изДвижка] : deviceStatusLabel(deviceStatus(роль, devCfg));
  };

  /* Деталь-строка честна: показываем только то, что реально знаем. Канал — из
     снимка движка, резервуар и заряд пока из Nightscout-стора (переезд на снимок —
     SugarLifeCore#13/#19). Канал не привязан к выбранной модели: связь есть и тогда,
     когда модель ещё не названа, а «нет данных о резервуаре» без слова о пути к
     помпе — ровно та половина ответа, из-за которой чинят не то. */
  const расх = расходка(снимок, { reservoir: dev?.reservoir, pumpBattery: dev?.pumpBattery, at: dev?.at });
  const pumpDetail = [путьПомпы,
    расх.остаток != null ? Math.round(расх.остаток) + ' ед' : null,
    расх.заряд != null ? расх.заряд + '%' : null,
    /* Возраст и путь — рядом с числом, а не в карточке: строка списка и есть то место,
       где человек его читает, а «37 ед» часовой давности выглядят как свежие (#183). */
    подписьРасходки(расх, Date.now(), (мс) => agoText(мс))]
    .filter(Boolean).join(' · ') || (pump ? 'нет данных о резервуаре/батарее' : null);

  const titles: Record<DeviceCatKey, string> = {
    sensor: 'Сенсор (НМГ)', pump: 'Ввод инсулина', loop: 'Петля', meter: 'Глюкометр',
  };
  const openCat = (c: DeviceCatKey) => push(<DeviceSection cat={c} title={titles[c]} onClose={pop} />);

  /* Диспетчер: наши экземпляры железа отдельно от ролей (SugarLifeCore#34).

     Роль отвечает на «что у меня с сахаром и подачей», железо — на «что у меня есть и
     на связи ли оно». Раньше это был один список, и вопросы смешивались: человек искал
     «почему нет данных» среди моделей, а «какой у меня сенсор» — среди состояний
     связи. Железо стоит ниже ролей намеренно: заходят сюда чаще посмотреть, чем
     починить.

     Список берём готовым у движка (SugarLifeCore#44): hardware[] — это ровно
     экземпляры железа, без облаков. Раньше мы фильтровали devices[] по виду и на этом
     ошибались: облачная запись помпы тоже приходит как kind 'pump', и в диспетчере
     появлялась «железка», которой нет. */
  const железо = железоДиспетчера(снимок);
  /* Время держим своим счётчиком: «рядом» протухает по часам, а не по приходу снимка,
     и без тика строка «рядом» висела бы, пока движок не пришлёт что-нибудь ещё. */
  const [сейчас, setСейчас] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setСейчас(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  /* «Рядом» считаем с оглядкой на мост (#251): помпа Medtronic по блютусу не вещает
     вовсе, и пока OrangeLink молчит, «рядом» про неё — утверждение, которого никто не
     делал. Правило в domain/nearby.ts. */
  const рядом = рядомЖелезо(снимок, сейчас);
  const мост = (h: Parameters<typeof имяЖелезки>[0]) => мостЖелезки(h, снимок);

  const тело = (
    <>
        {железо.length > 0 && (
          <>
            <div className="section-label sec первый">Мои устройства</div>
            <div className="list">
              {железо.map((d) => {
                /* Облако в этот список больше не попадает по построению, поэтому
                   «живой» здесь — просто наша связь с железкой. */
                const живой = связь(d) === 'live';
                const близко = рядом.has(d.id);
                const звено = звеноЦепочки(d, снимок);
                const мостИмя = мост(d) ? имяЖелезки(мост(d)!) : null;
                const строка = [
                  /* У железки за мостом состояние описывает цепочка, а не одна метка:
                     иначе строка сказала бы «нет связи · OrangeLink не на связи» — то же
                     самое дважды, причём первое без подсказки, что делать. */
                  звено ? словоЦепочки(звено, мостИмя)
                    : sourceStatusLabel(d.status) ?? меткаСвязи[связь(d)],
                  /* В каком слоте стоит железка — ответ на «а эта штука вообще
                     работает на что-нибудь». Другой конец той же связки виден у роли
                     (SugarLifeCore#44), и показывать надо оба: человек приходит сюда
                     и от роли («откуда сахар»), и от железа («зачем этот прибор»). */
                  d.inSlot ? `слот: ${СЛОТ[d.inSlot]}` : null,
                  /* «Возможно занят» — догадка движка, а не факт: точное «занято
                     телефоном X» он отложил. Так и говорим, без имени чужого телефона. */
                  d.busy === 'possibly' ? 'возможно, занят другим телефоном' : null,
                  близко && !живой ? 'рядом' : null,
                ].filter(Boolean).join(' · ');
                /* Адрес в эфире — чтобы различать два одинаковых прибора. Не нашли —
                   не показываем: выдуманный «серийник» хуже отсутствия. */
                const адрес = адресВЭфире(d);
                return (
                  <div key={d.id} className="list-row">
                    {/* Значок — про то, каким способом железка разговаривает С ТЕЛЕФОНОМ,
                        и раньше он стоял наоборот (SugarLifeCore#50). Мост — блютусный:
                        это он подключён к телефону. А до помпы блютус не доходит вовсе,
                        связь с ней радийная и через мост, и синий значок рядом с
                        «Medtronic 722» был утверждением о том, чего нет. */}
                    <IonIcon icon={заМостомЛи(d, снимок) ? radioOutline : bluetoothOutline}
                      className={'list-ico' + (живой ? '' : ' muted')} />
                    <span className="pick-main">
                      <span className="list-title">{d.model || d.name}</span>
                      <span className="pick-sub">{строка || 'состояние неизвестно'}</span>
                      {адрес && <span className="dev-addr">{адрес}</span>}
                    </span>
                    {/* Переподключить предлагаем только когда железка рядом: кнопка,
                        которая заведомо ничего не даст (устройство в другой комнате),
                        читается как поломка приложения, а не как отсутствие связи. */}
                    {/* Пока связь встаёт, кнопок нет вовсе: «Подключить» во время
                        подключения ничего не ускоряет, а «Пауза» обрывает то, чего
                        человек как раз ждёт. */}
                    {связь(d) === 'wait' ? null : живой ? (
                      /* У моста действие называется иначе, потому что оно и есть иное.
                         «Пауза» — про приостановку работы; у моста смысл в том, чтобы
                         УСТУПИТЬ прибор: блютус держит один центральный, и пока держим
                         мы, другой телефон к мосту не подключится (SugarLifeCore#50). */
                      <button className="changed-btn"
                        onClick={() => sendIntent({ type: 'disconnect', deviceId: d.id })}>
                        <IonIcon icon={pauseOutline} />{d.kind === 'bridge' ? 'Отпустить' : 'Пауза'}
                      </button>
                    ) : близко ? (
                      <button className="changed-btn"
                        onClick={() => sendIntent({ type: 'connect', deviceId: d.id })}>
                        <IonIcon icon={playOutline} />Подключить
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Поиск стоит рядом со списком железа, а не внизу раздела: это продолжение
            того же вопроса «что у меня есть», только про то, чего ещё нет. И только
            про НОВОЕ — известное лежит списком выше, и показывать его среди кандидатов
            на добавление значит предлагать завести второй такой же (SugarLifeCore#34). */}
        <div className="list" style={{ marginTop: железо.length ? 10 : 0 }}>
          <Row icon={searchOutline} title="Найти новое устройство"
            sub="поиск в эфире — только то, чего мы ещё не знаем"
            onClick={() => push(<DiscoverySection onClose={pop} />)} />
        </div>

        {/* Ниже — слоты: кто чем занят. Это ответ на другой вопрос, и потому он второй:
            «что у меня есть» человек проверяет чаще, чем «куда это назначено», а
            заходя сюда с проблемой связи, он ищет прибор, а не роль. */}
        <div className="sheet-note">
          Тапни устройство — там все действия (мост, подключение, «забыть»). На плитке ничего не отключишь случайно.
        </div>

        <div className="section-label sec">Помпа</div>
        <div className="list">
          <Row icon={flash} title={pump?.model ?? 'Ввод инсулина'} sub={pumpDetail || undefined}
            value={состояние('pump')} onClick={() => openCat('pump')} />
        </div>

        <div className="section-label sec">Сенсоры</div>
        <div className="list">
          <Row icon={hardwareChipOutline} title={sensor?.name ?? 'Сенсор (НМГ)'} sub={путьСенсора ?? undefined}
            value={состояние('sensor')} onClick={() => openCat('sensor')} />
        </div>

        {/* Петли здесь больше нет (#279). Она не прибор, а режим управления подачей:
            у неё нет ни связи, ни батареи, ни «забыть». Её место — рядом с профилем
            петли, где задают полномочия, а не среди железа. */}
        <div className="section-label sec">Глюкометр</div>
        <div className="list">
          {/* Значение строки обязано совпадать с тем, что человек найдёт внутри (#163).
              Здесь стояло «настроить» у обоих, а внутри — «в разработке»: у глюкометра
              настраивать пока нечего (можно только внести показание), у петли нет и
              этого. Слово, обещающее действие, которого нет, читается как поломка, а
              не как «ещё не сделали». */}
          <Row icon={speedometerOutline} title="Глюкометр" value="внести показание"
            onClick={() => openCat('meter')} />
        </div>

        <div className="list" style={{ marginTop: 12 }}>
          <Row icon={helpCircleOutline} title="Проверить / записать по модели" onClick={() => setReqOpen(true)} />
        </div>
        <RequirementsCatalogSheet isOpen={reqOpen} onClose={() => setReqOpen(false)} />
    </>
  );

  if (встроенный) return тело;
  return (
    <Section title="Устройства" subtitle="Профиль · Устройства" onBack={onClose ?? (() => {})}>
      {тело}
    </Section>
  );
}
