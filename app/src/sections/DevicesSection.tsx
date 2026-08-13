import Section from '@/ui/Section';
import { DeviceSection } from '@/sections/lazy';
import Row from '@/ui/Row';
import { hardwareChipOutline, flash, repeat, speedometerOutline, helpCircleOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useStore } from '@/sources/store';
import { useDeviceConfig, deviceStatus, deviceStatusLabel } from '@/settings/deviceConfig';
import { pumpById, sensorById } from '@/domain/catalog';
import { useSnapshot } from '@/sources/bridge';
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

        <div className="list" style={{ marginTop: 12 }}>
          <Row icon={helpCircleOutline} title="Проверить / записать по модели" onClick={() => setReqOpen(true)} />
        </div>
        <RequirementsCatalogSheet isOpen={reqOpen} onClose={() => setReqOpen(false)} />
    </Section>
  );
}
