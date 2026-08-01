import { IonIcon } from '@ionic/react';
import { useEffect } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { pulse, flash, moon } from 'ionicons/icons';
import { useStore } from '../data/store';
import { toUnits, agoText, unitLabel, useUnit } from '../data/units';
import { arrowChar } from '../data/nightscout';
import { usePanelScrolled, setPanelScrolled } from '../data/panel';
import { useTheme } from '../theme/useTheme';
import CircleSparkline from './CircleSparkline';

const DASH = '—';

// Короткий статус помпы для крыла
function shortStatus(s?: string | null): string {
  if (!s) return DASH;
  const l = s.toLowerCase();
  if (l.includes('приостан') || l.includes('пауза') || l.includes('suspend') || l.includes('stop')) return 'Пауза';
  if (l.includes('замкнут') || l.includes('closed')) return 'Цикл вкл';
  if (l.includes('открыт') || l.includes('open')) return 'Цикл выкл';
  return s;
}

/* Верхняя панель — единый постоянный элемент над контентом на ВСЕХ экранах.
   Три состояния плавно перетекают друг в друга (переход 0.22s):
   • full    — на «Сегодня»: большой круг, подписи-детали, строка синхронизации;
   • compact — на прочих экранах: панель сжата;
   • line    — прочие экраны при прокрутке: тонкая строка. */
export default function HeroPanel() {
  const { data, live } = useStore();
  const { toggle } = useTheme();
  useUnit(); // перерисовка при смене единиц
  const history = useHistory();
  const { pathname } = useLocation();
  const scrolled = usePanelScrolled();

  const full = pathname === '/today' || pathname === '/';
  const line = !full && scrolled;
  const mode = full ? 'is-full' : line ? 'is-line' : 'is-compact';

  // при переходе на другой экран панель разворачивается заново (сброс прокрутки)
  useEffect(() => { setPanelScrolled(false); }, [pathname]);

  const latest = data?.latest || null;
  const dev = data?.device || null;

  const glucose = latest ? toUnits(latest.mmol) : DASH;
  const arrow = latest ? arrowChar(latest.dir) : '';
  const ago = latest ? agoText(latest.t) : DASH;
  const minsAgo = latest ? Math.round((Date.now() - latest.t) / 60000) : null;
  const fresh = minsAgo == null ? DASH : minsAgo < 1 ? 'сейчас' : minsAgo + ' мин';

  const reservoir = dev?.reservoir != null ? Math.round(dev.reservoir) + ' ед' : DASH;
  const pumpStatus = shortStatus(dev?.status);
  const syncText = live ? 'реальное время' : latest ? 'Обновлено ' + agoText(data!.updatedAt) : 'Нет данных';

  return (
    <div className={'hero-panel ' + mode}>
      {full && (
        <div className="hp-sync">
          <span className="hp-synctext"><span className="heart">♥</span> {syncText}</span>
          <button className="theme-btn" onClick={toggle} aria-label="Тема"><IonIcon icon={moon} /></button>
        </div>
      )}

      <div className="hp-row">
        <div className="hp-rect">
          <button className="hp-wing hp-wing-l" onClick={() => history.push('/mon')}>
            <span className="hp-ico"><IonIcon icon={pulse} /></span>
            <span className="hp-head">
              <span className="hp-name">НМГ</span>
              {live && <span className="live-dot" title="реальное время" />}
            </span>
            <span className="hp-sub">обновлено</span>
            <span className="hp-val">{fresh}</span>
          </button>

          <div className="hp-gap" />

          <button className="hp-wing hp-wing-r" onClick={() => history.push('/ins')}>
            <span className="hp-ico"><IonIcon icon={flash} /></span>
            <span className="hp-name">Помпа</span>
            <span className="hp-sub">{pumpStatus}</span>
            <span className="hp-val">{reservoir}</span>
            <span className="hp-sub">резервуар</span>
          </button>
        </div>

        <button className="hp-circle" onClick={() => history.push('/mon')} aria-label="Глюкоза">
          <CircleSparkline entries={data?.entries || []} />
          <span className="hp-circle-inner">
            <span className="hp-circle-val">
              <span className="hp-value">{glucose}</span>
              {arrow && <span className="hp-arrow">{arrow}</span>}
            </span>
            <span className="hp-unit">{unitLabel()}</span>
            <span className="hp-ago">{ago}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
