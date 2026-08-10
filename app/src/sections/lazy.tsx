import { lazy, Suspense, type ComponentType } from 'react';
import PageLoading from '@/ui/PageLoading';

/* Точки ленивой загрузки — все в одном файле, а не размазаны по местам вызова.

   Разделы открываются по явному действию: нажал «Устройства» — поехал код устройств.
   До этого он в первом куске не нужен, а весит вместе с остальными изрядно: справочник
   помп и инсулинов, мастер петли, базальный редактор, разбор данных. Первый экран
   должен появляться быстро, а не ждать код, до которого дойдут не все и не сразу.

   Каждый раздел завёрнут в заглушку с заголовком, который уже известен: пока код едет,
   человек видит не пустоту, а страницу, куда он шёл. Заголовок здесь — не украшение:
   он подтверждает, что нажатие сработало и открывается именно то. */

function ленивый<P extends object>(
  загрузить: () => Promise<{ default: ComponentType<P> }>,
  заголовок: string,
): ComponentType<P> {
  const C = lazy(загрузить);
  return (props: P) => (
    <Suspense fallback={<PageLoading title={заголовок} />}>
      <C {...props} />
    </Suspense>
  );
}

export const DevicesSection = ленивый<{ onClose: () => void }>(
  () => import('./DevicesSection'), 'Устройства');

export const ServicesSection = ленивый<{ onClose: () => void }>(
  () => import('./ServicesSection'), 'Сервисы');

export const DeviceSection = ленивый<{ onClose: () => void; cat: 'sensor' | 'pump' | 'meter' | 'loop'; title: string }>(
  () => import('./DeviceSection'), 'Устройство');

export const CloudSection = ленивый<{ cloudId: string; onClose: () => void }>(
  () => import('./CloudSection'), 'Облако');

export const BasalProfileSection = ленивый<{ onClose: () => void }>(
  () => import('./BasalProfileSection'), 'Базальный профиль');

export const LoopSetupSection = ленивый<{ onClose: () => void }>(
  () => import('./LoopSetupSection'), 'Профиль петли');

export const AnalyticsSection = ленивый<{ onClose: () => void }>(
  () => import('./AnalyticsSection'), 'Аналитика');
