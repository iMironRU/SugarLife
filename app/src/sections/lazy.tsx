import { lazy, Suspense, type ComponentType } from 'react';
import PageLoading from '@/ui/PageLoading';

/* Точки ленивой загрузки — все в одном файле, а не размазаны по местам вызова.

   Разделы открываются по явному действию: нажал «Устройства» — поехал код устройств.
   До этого он в первом куске не нужен, а весит вместе с остальными изрядно: справочник
   помп и инсулинов, мастер петли, базальный редактор, разбор данных. Первый экран
   должен появляться быстро, а не ждать код, до которого дойдут не все и не сразу.

   Но «не в первом куске» и «в момент нажатия» — это разные вещи, и раньше они были
   склеены. Код ехал ровно тогда, когда человек нажал: страница уже выехала, а внутри
   пусто, и содержимое появлялось вторым шагом. Отсюда и ощущение, что экран моргает —
   сначала прежний, потом поверх новый, и только потом в нём что-то есть.

   Поэтому загрузка отвязана от нажатия. Куски прогреваются в простое, через минуту
   после старта: первый экран это уже не задерживает, а к нажатию код обычно на месте.
   Прогретый раздел рисуется сразу, без Suspense вовсе, — заглушке неоткуда мигнуть
   даже на кадр.

   Заглушка остаётся для непрогретого случая: медленная сеть, нажали в первую секунду,
   не сработал requestIdleCallback. Тогда всё как было — каркас страницы и спиннер. */

type Прогреваемый<P> = ComponentType<P> & { прогреть: () => Promise<unknown> };

function ленивый<P extends object>(
  загрузить: () => Promise<{ default: ComponentType<P> }>,
  заголовок: string,
): Прогреваемый<P> {
  let готовый: ComponentType<P> | null = null;
  let поехало: Promise<unknown> | null = null;
  /* Один промис на все вызовы: прогрев может совпасть с нажатием, и грузить дважды
     незачем. Сам bundler кусок тоже кеширует, но лишний виток промисов — лишний кадр. */
  const прогреть = () => (поехало ??= загрузить().then((m) => { готовый = m.default; }));

  const Ленивый = lazy(загрузить);

  const Обёртка = (props: P) => {
    if (готовый) {
      const Готовый = готовый;
      return <Готовый {...props} />;
    }
    return (
      <Suspense fallback={<PageLoading title={заголовок} />}>
        <Ленивый {...props} />
      </Suspense>
    );
  };
  Обёртка.прогреть = прогреть;
  return Обёртка;
}

export const DevicesSection = ленивый<{ onClose?: () => void; встроенный?: boolean }>(
  () => import('./DevicesSection'), 'Устройства');
export const ОхранаSection = ленивый<{ onClose: () => void }>(
  () => import('./ОхранаSection'), 'Охрана',
);

export const AppearanceSection = ленивый<{ onClose: () => void; часть?: 'показ' | 'вид' }>(
  () => import('./AppearanceSection'), 'Оформление');
export const PermissionsSection = ленивый<{ onClose: () => void }>(
  () => import('./PermissionsSection'), 'Разрешения');

export const AboutSection = ленивый<{ onClose: () => void }>(
  () => import('./AboutSection'), 'О приложении');

export const HealthSection = ленивый<{ onClose: () => void }>(
  () => import('./HealthSection'), 'Здоровье');
export const VisitNoteSection = ленивый<{ onClose?: () => void; встроенный?: boolean }>(
  () => import('./VisitNoteSection'), 'Отчёт к приёму');

export const ServicesSection = ленивый<{ onClose?: () => void; встроенный?: boolean }>(
  () => import('./ServicesSection'), 'Сервисы');

export const DeviceSection = ленивый<{ onClose: () => void; cat: 'sensor' | 'pump' | 'meter' | 'loop'; title: string }>(
  () => import('./DeviceSection'), 'Устройство');

export const CloudSection = ленивый<{ cloudId: string; onClose: () => void }>(
  () => import('./CloudSection'), 'Облако');

export const BasalProfileSection = ленивый<{ onClose: () => void }>(
  () => import('./BasalProfileSection'), 'Базальный профиль');

export const LoopSection = ленивый<{ onClose: () => void }>(
  () => import('./LoopSection'), 'Петля');

export const LoopSetupSection = ленивый<{ onClose: () => void }>(
  () => import('./LoopSetupSection'), 'Профиль петли');

export const DataDevicesSection = ленивый<{ onClose: () => void; вкладка?: 'данные' | 'приборы' | 'облака' }>(
  () => import('./DataDevicesSection'), 'Устройства и данные');

export const SourcesSection = ленивый<{ onClose?: () => void; встроенный?: boolean }>(
  () => import('./SourcesSection'), 'Откуда берутся данные');

export const CloudAccountsSection = ленивый<{ onClose: () => void }>(
  () => import('./CloudAccountsSection'), 'Облачные учётки');

export const HistorySection = ленивый<{ onClose: () => void }>(
  () => import('./HistorySection'), 'История');
export const AnalyticsSection = ленивый<{ onClose?: () => void; встроенный?: boolean }>(
  () => import('./AnalyticsSection'), 'Аналитика');


export const MealsSection = ленивый<{ onClose: () => void }>(
  () => import('./MealsSection'), 'Приёмы пищи');

export const AlarmsSection = ленивый<{ onClose: () => void }>(
  () => import('./AlarmsSection'), 'Тревоги',
);
export const DiagnosticsSection = ленивый<{ onClose: () => void }>(
  () => import('./DiagnosticsSection'), 'Диагностика');

/* Порядок — по тому, как часто сюда заходят: аналитика и приёмы пищи открываются с
   «Сегодня» каждый день, диагностика — раз в полгода. По одному за раз, а не пачкой:
   пачка на медленной сети займёт канал ровно тогда, когда приложение тянет показания,
   а они важнее любого раздела.

   Прогрев не обязан успеть. Не успел — откроется как раньше, через заглушку. */
const ОЧЕРЕДЬ: { прогреть: () => Promise<unknown> }[] = [
  AnalyticsSection, MealsSection, DevicesSection, DeviceSection, HealthSection, VisitNoteSection, AboutSection, AppearanceSection,
  PermissionsSection,
  ServicesSection, CloudSection,
  BasalProfileSection, LoopSetupSection, DiagnosticsSection,
];

type СПростоем = typeof window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };

/* «В простое, но не дольше секунды». Простой — это подсказка, а не обещание: в Safari
   его нет вовсе, а в скрытой вкладке он не наступает никогда. Ждать его без срока
   значит написать прогрев, который на части устройств просто не работает — и узнать
   об этом только по жалобе на моргание. Поэтому таймер идёт наперегонки. */
function вПростое(f: () => void): void {
  let было = false;
  const один = () => { if (!было) { было = true; f(); } };
  (window as СПростоем).requestIdleCallback?.(один, { timeout: 1000 });
  window.setTimeout(один, 1000);
}

export function прогретьРазделы(): void {
  let i = 0;
  const дальше = () => {
    if (i >= ОЧЕРЕДЬ.length) return;
    const текущий = ОЧЕРЕДЬ[i++];
    текущий.прогреть().then(() => вПростое(дальше), () => вПростое(дальше));
  };
  вПростое(дальше);
}
