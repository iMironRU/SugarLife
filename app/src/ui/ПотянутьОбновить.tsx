import { useRef, useState, type ReactNode } from 'react';
import Крутилка from './Крутилка';

/* ПОТЯНУТЬ ВНИЗ — ОБНОВИТЬ. Своё, вместо `IonRefresher` (SugarLife#405).

   Жест на месте, где его ожидают, и без кнопки: опрос идёт раз в минуту, но когда связь пропала и
   вернулась, ждать минуту незачем — человек уже смотрит в экран.

   ПОРОГ БОЛЬШЕ ОБЫЧНОГО (90 px, как было у Ionic здесь же): панель на этом экране и так ездит за
   пальцем, и при стандартном пороге случайный потяг запускал бы опрос по десять раз за прокрутку.

   ТЯНЕМ ТОЛЬКО ОТ САМОГО ВЕРХА. Если содержимое прокручено, вниз — это прокрутка, и перехватывать её
   нельзя: иначе список перестанет листаться там, где ему положено.

   СОПРОТИВЛЕНИЕ. Тянется вдвое медленнее пальца — так человек чувствует, что это не прокрутка, а
   натяжение, и понимает, что можно отпустить. */
const ПОРОГ = 90;
const ПОТОЛОК = 200;

export default function ПотянутьОбновить({ скроллер, обновить, children }: {
  скроллер: React.RefObject<HTMLDivElement | null>;
  обновить?: () => Promise<void>;
  children: ReactNode;
}) {
  const [натяжение, setНатяжение] = useState(0);
  const [идёт, setИдёт] = useState(false);
  const старт = useRef<number | null>(null);

  if (!обновить) return <>{children}</>;

  const начало = (e: React.TouchEvent) => {
    const el = скроллер.current;
    старт.current = el && el.scrollTop <= 0 && !идёт ? e.touches[0].clientY : null;
  };

  const движение = (e: React.TouchEvent) => {
    if (старт.current == null) return;
    const dy = e.touches[0].clientY - старт.current;
    if (dy <= 0) { setНатяжение(0); return; }
    setНатяжение(Math.min(ПОТОЛОК, dy / 2));
  };

  const конец = () => {
    const было = натяжение;
    старт.current = null;
    setНатяжение(0);
    if (было < ПОРОГ / 2 || идёт) return;
    setИдёт(true);
    void обновить().finally(() => setИдёт(false));
  };

  const тянут = натяжение > 0;
  const хватит = натяжение >= ПОРОГ / 2;

  return (
    <div className="тянуть" onTouchStart={начало} onTouchMove={движение} onTouchEnd={конец} onTouchCancel={конец}>
      {(тянут || идёт) && (
        <div className="тянуть-полоска" style={{ height: идёт ? 44 : натяжение }}>
          {идёт
            ? <><Крутилка /> <span>Спрашиваю…</span></>
            : <span>{хватит ? 'Отпустите, чтобы обновить' : 'Потяните, чтобы обновить'}</span>}
        </div>
      )}
      {children}
    </div>
  );
}
