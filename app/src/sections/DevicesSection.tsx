import { IonIcon } from '@ionic/react';
import Section from '@/ui/Section';
import { DeviceSection } from '@/sections/lazy';
import Row from '@/ui/Row';
import {
  hardwareChipOutline, flash, repeat, speedometerOutline, helpCircleOutline,
  bluetoothOutline, radioOutline, searchOutline, playOutline, pauseOutline,
} from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useStore } from '@/sources/store';
import { useDeviceConfig, deviceStatus, deviceStatusLabel } from '@/settings/deviceConfig';
import { pumpById, sensorById } from '@/domain/catalog';
import { useSnapshot, sendIntent } from '@/sources/bridge';
import { наширядом } from '@/domain/nearby';
import { связь, меткаСвязи, толькоОблако, черезЧто as черезЧтоУстройства } from '@/domain/deviceState';
import { sourceStatusLabel } from '@/domain/sourceStatus';
import { DiscoverySection } from '@/sections/lazy';
import { устройствоРоли, рольСнимка, черезЧто } from '@/domain/deviceState';
import type { DeviceCatKey } from './DeviceSection';
import { useStack } from '@/app/stackCtx';
import RequirementsCatalogSheet from '@/sheets/RequirementsCatalogSheet';

/* Профиль → «Устройства» — отдельный полноэкранный раздел (не вложенная секция), как в
   docs/CONNECT-UX.md §10 «Карта интерфейса». Группировка по классу устройства (§2a: реестр).
   Детали (резервуар/батарея и т.п.) показываем только когда данные реально есть — честно. */
export default function DevicesSection({ onClose }: { onClose: () => void }) {
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
  const каналПомпы = черезЧто(устройствоРоли(снимок, 'pump'), рольСнимка(снимок, 'pump')?.via);
  const каналСенсора = черезЧто(устройствоРоли(снимок, 'sensor'), рольСнимка(снимок, 'sensor')?.via);

  /* Деталь-строка честна: показываем только то, что реально знаем. Канал — из
     снимка движка, резервуар и заряд пока из Nightscout-стора (переезд на снимок —
     SugarLifeCore#13/#19). Канал не привязан к выбранной модели: связь есть и тогда,
     когда модель ещё не названа, а «нет данных о резервуаре» без слова о пути к
     помпе — ровно та половина ответа, из-за которой чинят не то. */
  const pumpDetail = [каналПомпы,
    dev?.reservoir != null ? Math.round(dev.reservoir) + ' ед' : null,
    dev?.pumpBattery != null ? dev.pumpBattery + '%' : null]
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

     Служебные источники (облако) сюда не идут: это не железо, у него нет ни «рядом»,
     ни «переподключить», а живёт оно в «Облаках». */
  const железо = (снимок?.devices ?? []).filter((d) => d.kind !== 'service');
  /* Время держим своим счётчиком: «рядом» протухает по часам, а не по приходу снимка,
     и без тика строка «рядом» висела бы, пока движок не пришлёт что-нибудь ещё. */
  const [сейчас, setСейчас] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setСейчас(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const рядом = наширядом(железо, снимок?.discovered ?? [], сейчас);

  return (
    <Section title="Устройства" subtitle="Профиль · Устройства" onBack={onClose}>
        <div className="sheet-note">
          Тапни устройство — там все действия (мост, подключение, «забыть»). На плитке ничего не отключишь случайно.
        </div>

        <div className="section-label sec">Помпа</div>
        <div className="list">
          <Row icon={flash} title={pump?.model ?? 'Ввод инсулина'} sub={pumpDetail || undefined}
            value={deviceStatusLabel(deviceStatus('pump', devCfg))} onClick={() => openCat('pump')} />
        </div>

        <div className="section-label sec">Сенсоры</div>
        <div className="list">
          <Row icon={hardwareChipOutline} title={sensor?.name ?? 'Сенсор (НМГ)'} sub={каналСенсора ?? undefined}
            value={deviceStatusLabel(deviceStatus('sensor', devCfg))} onClick={() => openCat('sensor')} />
        </div>

        <div className="section-label sec">Глюкометры и петля</div>
        <div className="list">
          {/* Значение строки обязано совпадать с тем, что человек найдёт внутри (#163).
              Здесь стояло «настроить» у обоих, а внутри — «в разработке»: у глюкометра
              настраивать пока нечего (можно только внести показание), у петли нет и
              этого. Слово, обещающее действие, которого нет, читается как поломка, а
              не как «ещё не сделали». */}
          <Row icon={speedometerOutline} title="Глюкометр" value="внести показание"
            onClick={() => openCat('meter')} />
          <Row icon={repeat} title="Петля" value="в разработке" valueMuted
            onClick={() => openCat('loop')} />
        </div>

        {железо.length > 0 && (
          <>
            <div className="section-label sec">Наше железо</div>
            <div className="list">
              {железо.map((d) => {
                /* «Живой» здесь — про НАШУ связь с железкой, а не про то, доходят ли
                   о ней сведения. Помпа, о которой мы знаем через облако, тоже несёт
                   status Live — и «Пауза» на ней обещала бы, что мы можем эту связь
                   разорвать. Не можем: её держит чужой телефон. */
                const живой = связь(d) === 'live' && !толькоОблако(d);
                const близко = рядом.has(d.id);
                const строка = [
                  sourceStatusLabel(d.status) ?? меткаСвязи[связь(d)],
                  черезЧтоУстройства(d),
                  близко && !живой ? 'рядом' : null,
                ].filter(Boolean).join(' · ');
                return (
                  <div key={d.id} className="list-row">
                    <IonIcon icon={d.kind === 'bridge' ? radioOutline : bluetoothOutline}
                      className={'list-ico' + (живой ? '' : ' muted')} />
                    <span className="pick-main">
                      <span className="list-title">{d.name}</span>
                      <span className="pick-sub">{строка || 'состояние неизвестно'}</span>
                    </span>
                    {/* Переподключить предлагаем только когда железка рядом: кнопка,
                        которая заведомо ничего не даст (устройство в другой комнате),
                        читается как поломка приложения, а не как отсутствие связи. */}
                    {живой ? (
                      <button className="changed-btn"
                        onClick={() => sendIntent({ type: 'disconnect', deviceId: d.id })}>
                        <IonIcon icon={pauseOutline} />Пауза
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

        <div className="list" style={{ marginTop: 12 }}>
          {/* Поиск — только про НОВОЕ. Известное железо живёт выше со своим состоянием,
              и показывать его ещё раз среди кандидатов на добавление значит предлагать
              завести второй такой же (SugarLifeCore#34). */}
          <Row icon={searchOutline} title="Найти новое устройство"
            sub="поиск в эфире — только то, чего мы ещё не знаем"
            onClick={() => push(<DiscoverySection onClose={pop} />)} />
          <Row icon={helpCircleOutline} title="Проверить / записать по модели" onClick={() => setReqOpen(true)} />
        </div>
        <RequirementsCatalogSheet isOpen={reqOpen} onClose={() => setReqOpen(false)} />
    </Section>
  );
}
