/* Авто-определение режима терапии из данных Nightscout. */
import type { Device, Treatment } from '@/domain/types';

export type Therapy = 'loop' | 'pump' | 'pen';

export function detectTherapy(data: { device?: Device | null; treatments?: Treatment[] } | null): Therapy {
  const dev = data?.device;
  const treatments = data?.treatments || [];
  const tempBasals = treatments.filter((t) => t.type === 'Temp Basal').length;
  const boluses = treatments.filter((t) => t.insulin && t.insulin > 0).length;

  if (dev?.loop) return 'loop';                                   // замкнутая петля
  if (dev?.pump || dev?.reservoir != null || tempBasals > boluses) return 'pump'; // помпа
  if (boluses > 0) return 'pen';                                  // ручка/МДИ
  return 'pen';
}

export function therapyLabel(t: Therapy): string {
  return t === 'loop' ? 'Замкнутый цикл' : t === 'pump' ? 'Помпа' : 'Шприц-ручка';
}
