import { useEffect } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { createGesture, type Gesture } from '@ionic/react';

// Порядок как в нижнем таб-баре: свайп влево → следующая, вправо → предыдущая.
const TABS = ['/metrics', '/mon', '/today', '/ins', '/profile'];

/* Горизонтальные свайпы между вкладками. В Ionic нет нативного свайпа между
   табами — вешаем жест direction:'x' на область контента (.app-body), чтобы он
   не конфликтовал с вертикальной прокруткой ion-content. Рендерит null. */
export default function TabSwipe() {
  const history = useHistory();
  const location = useLocation();

  useEffect(() => {
    const el = document.querySelector('.app-body') as HTMLElement | null;
    if (!el) return;

    let cur = TABS.indexOf(location.pathname);
    if (cur === -1) cur = TABS.indexOf('/today'); // '/' и прочее → как «Сегодня»

    const gesture: Gesture = createGesture({
      el,
      gestureName: 'tab-swipe',
      direction: 'x',
      threshold: 12,
      onEnd: (d) => {
        // явно горизонтальный и достаточный жест (иначе это скролл/тап)
        if (Math.abs(d.deltaX) < Math.abs(d.deltaY)) return;
        const far = Math.abs(d.deltaX) > 60;
        const fast = Math.abs(d.velocityX) > 0.3;
        if (!far && !fast) return;

        const next = d.deltaX < 0 ? Math.min(TABS.length - 1, cur + 1)
                                  : Math.max(0, cur - 1);
        if (next !== cur) history.push(TABS[next]);
      },
    });
    gesture.enable();
    return () => gesture.destroy();
  }, [location.pathname, history]);

  return null;
}
