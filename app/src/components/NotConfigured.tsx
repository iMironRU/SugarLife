import { IonIcon } from '@ionic/react';
import { cloudOfflineOutline, chevronForward } from 'ionicons/icons';
import { useStore } from '../data/store';
import { setOnboarded } from '../data/onboarding';

/* Приложение не настроено — заметный выход, а не мелкая надпись.

   Человек мог нажать «Уже настроено — просто открыть», а настроено оказалось ничего:
   раньше он оставался с прочерками и подписью «Нет данных. Подключите Nightscout в
   профиле» — то есть его отправляли искать настройку самому.

   Кнопка возвращает мастер первого запуска: снимаем флаг «онбординг пройден», и гейт
   в App.tsx показывает его снова. Данные при этом не трогаются.

   ОДИН вид на всех экранах, без вариантов: две разные версии читались как разные
   вещи, хотя это одна и та же кнопка про одно и то же. */
export default function NotConfigured() {
  const { status } = useStore();
  // 'off' = ни одного включённого облака. Только это и значит «не настроено»;
  // при обрыве связи (stale/error) настройки на месте, мастер предлагать незачем.
  if (status !== 'off') return null;

  return (
    <button className="nocfg" onClick={() => setOnboarded(false)}>
      <IonIcon icon={cloudOfflineOutline} className="nocfg-ico" />
      <span className="nocfg-txt">
        <span className="nocfg-t">Приложение не настроено</span>
        <span className="nocfg-d">Не подключён ни один источник данных. Мастер займёт минуту.</span>
      </span>
      <IonIcon icon={chevronForward} className="nocfg-chev" />
    </button>
  );
}
