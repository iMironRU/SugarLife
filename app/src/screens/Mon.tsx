import { useSnapshot } from '@/sources/bridge';
import { предупредитьОСыром } from '@/domain/сырое';
import { СЛОВО_СЫРОГО, ПОЯСНЕНИЕ_СЫРОГО } from '@/слова/сырое';
import Иконка from '@/ui/Иконка';
import { useTab } from '@/app/nav';
import { DeviceSection } from '@/sections/lazy';
import { useChanges } from '@/settings/changes';
import { hardwareChipOutline, chevronForward } from 'ionicons/icons';
import { useState, useEffect } from 'react';
import { useEntries } from '@/sources/db';
import { toUnits, toUnitsDelta, unitLabel, useUnit } from '@/domain/units';
import { getCfg, loadEventsRange, type Treatment } from '@/sources/nightscout';
import { СТРЕЛКА, изНаправленияNS } from '@/domain/trend';
import { deviceAges } from '@/domain/treatmentStats';
import { пятиминутки, ГОРИЗОНТЫ, ОКНО_МИН } from '@/domain/дельты';
import GlucoseTimeChart from '@/charts/GlucoseTimeChart';
import { DataGate } from '@/ui/NotConfigured';
import { useStack } from '@/app/stackCtx';
import Screen from '@/ui/Screen';

const WINDOWS = [1, 3, 6, 12, 24];

/** Часы и минуты; с секундами — в раскрытой пятиминутке, где минуты идут подряд. */
const чч = (ms: number, сСекундами = false) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}` + (сСекундами ? `:${p(d.getSeconds())}` : '');
};

const fmtWhen = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} в ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function Mon() {
  const сырое = предупредитьОСыром(useSnapshot());
  /* Вкладка видна? Все пять смонтированы разом ради свайпа, но читать базу
     невидимому экрану незачем — это и были рывки на соседних вкладках. */
  const активна = useTab() === 1;
  useUnit(); // перерисовка при смене единиц
  const [win, setWin] = useState(3);
  const { push, pop } = useStack();
  const entries = useEntries(24 * 3600e3, { paused: !активна });

  const cfg = getCfg();
  const [events, setEvents] = useState<Treatment[]>([]);
  useEffect(() => {
    let cancel = false;
    if (cfg?.enabled && cfg.url) {
      loadEventsRange(cfg.url, cfg.token, 30).then((e) => { if (!cancel) setEvents(e); }).catch(() => {});
    }
    return () => { cancel = true; };
  }, [cfg?.url, cfg?.token, cfg?.enabled]);
  const changes = useChanges();
  const ages = deviceAges(events, changes);

  /* ЛЕНТА — ПЯТИМИНУТКАМИ, А НЕ ПОСЛЕДНИМИ ВОСЕМЬЮ ПОКАЗАНИЯМИ (#698).

     Здесь было `entries.slice(-8)`: при минутном сенсоре это восемь минут — меньше, чем один
     горизонт наблюдения, и подряд идущие минуты дают шум, а не картину. Теперь два часа
     пятиминутками, а минутные внутри строки: раскрыл — увидел, из чего она сложилась. */
  const лента = пятиминутки(entries, Date.now(), ОКНО_МИН);
  const [раскрыта, раскрыть] = useState<number | null>(null);

  return (
    <Screen tab={1}>
          <DataGate>
          {/* сахар/тренд/свежесть — в верхней панели; здесь кнопка датчика + график */}
          {ages.sensor && (
            <button className="pump-btn" style={{ marginTop: 0 }} onClick={() => push(<DeviceSection cat="sensor" title="Сенсор (НМГ)" onClose={pop} />, { id: 'категория', cat: 'sensor', title: 'Сенсор (НМГ)' })}>
              <Иконка icon={hardwareChipOutline} className="pump-btn-ico" style={{ color: 'var(--color-accent)' }} />
              <div className="pump-btn-txt">
                <div className="pump-btn-title">Датчик</div>
                <div className="pump-btn-sub">День {ages.sensor.days + 1} · установлен {fmtWhen(ages.sensor.at)}</div>
              </div>
              <Иконка icon={chevronForward} className="pump-btn-chev" />
            </button>
          )}

          {/* период */}
          <div className="win-chips">
            {WINDOWS.map((w) => (
              <button key={w} className={'win-chip' + (win === w ? ' on' : '')} onClick={() => setWin(w)}>{w}ч</button>
            ))}
          </div>

          {/* график */}
          <GlucoseTimeChart entries={entries} windowH={win} />

          {/* последние измерения */}
          {/* Объяснение — здесь, а не у числа: у круга место только на короткую пометку,
              а понять, что делать, человек приходит на этот экран (SugarLifeCore#88). */}
          {сырое && <div className="today-alert" style={{ marginBottom: 12 }}>
            <div><span className="alert-title">{СЛОВО_СЫРОГО}</span><span>{ПОЯСНЕНИЕ_СЫРОГО}</span></div>
          </div>}

          <div className="section-label sec">Последние два часа</div>
          {/* ТРИ ГОРИЗОНТА — ТРИ ВОПРОСА. Подписаны в шапке, а не у каждой строки: три числа в
              строке без объяснения читаются как непонятно что, а с подписью в каждой строке
              строка перестаёт читаться вовсе. */}
          <div className="лента-шапка">
            <span className="лента-время">время</span>
            <span className="лента-значение">{unitLabel()}</span>
            {ГОРИЗОНТЫ.map((г) => <span key={г} className="лента-дельта">{г} мин</span>)}
          </div>
          <div className="list">
            {лента.map((строка, i) => (
              <div key={строка.метка}>
                <button
                  className={'лента-строка' + (раскрыта === строка.метка ? ' раскрыта' : '')}
                  style={i === 0 ? { background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' } : undefined}
                  onClick={() => раскрыть(раскрыта === строка.метка ? null : строка.метка)}>
                  <span className="лента-время" style={{ fontWeight: i === 0 ? 600 : 400 }}>
                    {чч(строка.метка)}
                    {/* Сколько минутных внутри — единственный повод раскрывать. Одна точка внутри
                        значит, что раскрывать нечего, и об этом надо сказать заранее. */}
                    {строка.точки.length > 1 && <span className="лента-сколько">{строка.точки.length}</span>}
                  </span>
                  <span className="лента-значение" style={{ fontWeight: i === 0 ? 600 : 400 }}>{toUnits(строка.mmol)}</span>
                  {строка.дельты.map((д, j) => (
                    /* Прочерк — ответ, а не пустота: показания у дальнего конца нет, и посчитать
                       разницу не из чего. Молчание честнее числа по краям. */
                    <span key={ГОРИЗОНТЫ[j]} className={'лента-дельта' + (д == null ? ' молчит' : '')}>
                      {д == null ? '—' : toUnitsDelta(д)}
                    </span>
                  ))}
                </button>
                {раскрыта === строка.метка && строка.точки.length > 1 && (
                  <div className="лента-минуты">
                    {строка.точки.map((e) => (
                      <div key={e.t} className="лента-минута">
                        <span>{чч(e.t, true)}</span>
                        <span>{toUnits(e.mmol)}</span>
                        {/* Стрелка — свойство ЭТОЙ записи, а не «сейчас»: считать по ней
                            направление из соседних точек значило бы показывать у старого
                            показания сегодняшний расчёт. Нет направления — нет стрелки. */}
                        <span className="reading-arrow">{СТРЕЛКА[изНаправленияNS(e.dir)]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!лента.length && <div className="mon-empty">Нет данных.</div>}
          </div>

          <div className="metric-note">День датчика — из события замены сенсора в Nightscout (Sensor Change). Сахар, тренд и свежесть — вживую.</div>
          </DataGate>
    </Screen>
  );
}
