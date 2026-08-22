import { IonIcon } from '@ionic/react';
import { сколькоНазад, часы } from '@/слова/время';
import { useTab } from '@/app/nav';
import { DeviceSection, LoopSetupSection } from '@/sections/lazy';
import { flash, repeat, chevronForward, moonOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useStorePart } from '@/sources/store';
import { useTreatments } from '@/sources/db';
import { detectTherapy } from '@/domain/therapy';
import { activeInsulin } from '@/domain/loopValue';
import { fmt } from '@/domain/units';
import { useSnapshot } from '@/sources/bridge';
import { фонИнсулина, подписьФона } from '@/domain/longInsulin';
import LongInsulinSheet from '@/sheets/LongInsulinSheet';
import InsulinTimeChart from '@/charts/InsulinTimeChart';
import { DataGate } from '@/ui/NotConfigured';
import { useStack } from '@/app/stackCtx';
import Screen from '@/ui/Screen';

const WINDOWS = [1, 3, 6, 12, 24];

export default function Ins() {
  /* Вкладка видна? Все пять смонтированы разом ради свайпа, но читать базу
     невидимому экрану незачем — это и были рывки на соседних вкладках. */
  const активна = useTab() === 3;
  /* Берём только то, что рисуем: статус помпы, профиль и тип терапии. Раньше экран
     подписывался на весь стор и перерисовывался от каждого нового измерения, хотя
     измерения здесь не показываются вовсе. */
  const dev = useStorePart((s) => s.data?.device ?? null);
  const profile = useStorePart((s) => s.data?.profile ?? null);
  const therapy = useStorePart((s) => detectTherapy(s.data));
  const isPen = therapy === 'pen';

  const [win, setWin] = useState(3);
  const { push, pop } = useStack();

  // Живьём из локальной БД (обновляется сокетом/бэкфиллом): раньше грузили один раз
  // на старте — новые болюсы в график не попадали, пока не перезапустишь приложение.
  const treatments = useTreatments(31 * 3600e3, { paused: !активна }); // 24ч окна графика + запас на ступень базала
  const tempBasals = treatments.filter((t) => t.type === 'Temp Basal');
  const boluses = treatments.filter((t) => t.type !== 'Temp Basal' && (t.insulin ?? 0) > 0);
  const baseBasal = dev?.baseBasal ?? profile?.basal ?? null;
  const pumpStatus = dev?.status || (therapy === 'loop' ? 'Замкнутый цикл' : 'Помпа');
  const ai = activeInsulin(dev);
  /* Длинный инсулин — фоном и ОТДЕЛЬНО от активного (#287). Не сложением: 24 ед Туджео
     рядом с 4 ед короткого — это не 28 «активных», и по такому числу решать нельзя.

     И ТОЛЬКО ТЕМ, КТО ЕГО КОЛЕТ. У человека на помпе базал подаёт помпа, длинного
     инсулина у него нет — а карточка «Не записан · Записать» висела на экране и звала
     записать то, чего не существует. Строка, предлагающая внести несуществующее, хуже
     отсутствующей: она заставляет каждый раз заново решать, не забыл ли ты чего.

     Исключение — если запись УЖЕ есть. Так бывает у тех, кто временно снял помпу или
     держит фоновый инсулин при ней намеренно: спрятать то, что человек сам внёс, значит
     потерять его данные из виду. Такому карточку показываем целиком — он ей пользуется. */
  const снимок = useSnapshot();
  const фон = фонИнсулина(снимок, Date.now());
  const [пишуДлинный, setПишуДлинный] = useState(false);
  const длиннаяСтрока = (
    <div className="basal-card" style={{ marginTop: 12 }}>
      <div className="basal-head">
        <IonIcon icon={moonOutline} style={{ color: 'var(--c-ins)' }} /><span>Длинный инсулин</span>
      </div>
      <div className="basal-rows">
        {фон ? (
          <div className="basal-row">
            <span>{подписьФона(фон, часы, (мс) => сколькоНазад(мс))}</span>
            <button className="changed-btn is-undo во-всю" onClick={() => setПишуДлинный(true)}>Записать</button>
          </div>
        ) : (
          <>
            <div className="basal-row">
              <span>Не записан</span>
              <button className="changed-btn is-undo во-всю" onClick={() => setПишуДлинный(true)}>Записать</button>
            </div>
            {/* Молчать здесь нельзя: у человека на ручках базал — тоже инсулин, и если
                его не записать, он не появится нигде. */}
            <div className="basal-note">
              Тот, что колют раз в сутки. Приложение о нём не узнает само — ни помпа, ни
              сенсор его не видят.
            </div>
          </>
        )}
      </div>
    </div>
  );
  const baseBasalTxt = dev?.baseBasal != null ? fmt(dev.baseBasal) : profile?.basal != null ? fmt(profile.basal) : '—';

  return (
    <Screen tab={3}>
          <DataGate>
          {isPen ? (
            <div className="basal-card">
              <div className="basal-head"><IonIcon icon={flash} style={{ color: 'var(--c-ins)' }} /><span>Шприц-ручка</span></div>
              <div className="basal-rows">
                <div className="basal-row"><span>Последняя инъекция</span><b>{dev?.lastBolus != null ? fmt(dev.lastBolus) + ' ед' : '—'}</b></div>
                {/* «Нет инсулина» и «неизвестно, сколько» — разные вещи (domain/loopValue.ts):
                    неизвестное показываем прочерком и объясняем почему, а не молчим. */}
                <div className="basal-row">
                  <span>Активный инсулин</span>
                  <b className={ai.known ? undefined : 'val-unknown'}>{ai.known ? fmt(dev!.iob as number) + ' ед' : '—'}</b>
                </div>
                {ai.reason && <div className="basal-note">{ai.reason}</div>}
              </div>
            </div>
          ) : (
            <>
              {/* помпа (шторка) + петля (шторка) */}
              <div className="pump-row">
                <button className="pump-btn" onClick={() => push(<DeviceSection cat="pump" title="Ввод инсулина" onClose={pop} />, { id: 'категория', cat: 'pump', title: 'Ввод инсулина' })}>
                  <IonIcon icon={flash} className="pump-btn-ico" />
                  <div className="pump-btn-txt">
                    <div className="pump-btn-title">Помпа</div>
                    <div className="pump-btn-sub">{pumpStatus} · базал {baseBasalTxt} ед/ч</div>
                  </div>
                  <IonIcon icon={chevronForward} className="pump-btn-chev" />
                </button>
                <button className="loop-btn" onClick={() => push(<LoopSetupSection onClose={pop} />, { id: 'настройкаПетли' })} aria-label="Петля">
                  <IonIcon icon={repeat} />
                </button>
              </div>

              {/* график подачи инсулина — наверху, как график НМГ */}
              <div className="win-chips">
                {WINDOWS.map((w) => (
                  <button key={w} className={'win-chip' + (win === w ? ' on' : '')} onClick={() => setWin(w)}>{w}ч</button>
                ))}
              </div>
              <InsulinTimeChart tempBasals={tempBasals} boluses={boluses} windowH={win} baseBasal={baseBasal} />
              <div className="chart-legend">
                <span className="lg-item"><i className="lg-dot" style={{ background: 'var(--c-ins)' }} />базал, ед/ч</span>
                <span className="lg-item"><i className="lg-dot" style={{ background: 'var(--c-carb)' }} />болюс, ед</span>
                <span className="lg-item"><i className="lg-dash" />базовая скорость</span>
              </div>
            </>
          )}
          {(isPen || фон) && длиннаяСтрока}
          {пишуДлинный && <LongInsulinSheet onClose={() => setПишуДлинный(false)} />}
          </DataGate>

    </Screen>
  );
}
