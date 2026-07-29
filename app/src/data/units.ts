/* Форматирование значений глюкозы и времени. */
export function fmt(v: number) { return v.toFixed(1).replace('.', ','); }

export function toUnits(mmol: number, mgdl = false) {
  return mgdl ? String(Math.round(mmol * 18)) : fmt(mmol);
}

export function agoText(t: number, now = Date.now()) {
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return 'только что';
  if (m < 60) return m + ' мин назад';
  return Math.floor(m / 60) + ' ч назад';
}
