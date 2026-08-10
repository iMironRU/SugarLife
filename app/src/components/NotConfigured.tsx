import { IonIcon } from '@ionic/react';
import { cloudOfflineOutline, chevronForward } from 'ionicons/icons';
import { useStore } from '../data/store';
import { setOnboarded } from '../data/onboarding';

/* Приложение не настроено — заметный выход, а не мелкая надпись.

   Человек мог нажать «Уже настроено — просто открыть», а настроено оказалось ничего:
   раньше он оставался с прочерками и подписью «Нет данных. Подключите Nightscout в
   профиле» — то есть его отправляли искать настройку самому.

   Кнопка возвращает мастер первого запуска: снимаем флаг «онбординг пройден», и гейт
   в App.tsx показывает его снова. Данные при этом не трогаются. */
export default function NotConfigured({ compact = false }: { compact?: boolean }) {
  const { status } = useStore();
  // 'off' = ни одного включённого облака. Только это и значит «не настроено»;
  // при обрыве связи (stale/error) настройки на месте, мастер предлагать незачем.
  if (status !== 'off') return null;

  return (
    <button className={'nocfg' + (compact ? ' compact' : '')} onClick={() => setOnboarded(false)}>
      <IonIcon icon={cloudOfflineOutline} className="nocfg-ico" />
      <span className="nocfg-txt">
        <span className="nocfg-t">Приложение не настроено</span>
        <span className="nocfg-d">
          {compact
            ? 'Подключить источник данных'
            : 'Данных нет, потому что не подключён ни один источник. Мастер займёт минуту.'}
        </span>
      </span>
      <IonIcon icon={chevronForward} className="nocfg-chev" />
    </button>
  );
}
