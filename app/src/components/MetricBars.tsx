/* Мини-график по дням для метрик (углеводы/инсулин): тонкие столбики, высота по
   значению за день. muted-дни (неполное покрытие temp basal) — приглушены, чтобы
   не выдавать неполные данные за настоящие. Заменяет декоративную заглушку. */
export default function MetricBars({ values, color, muted }: { values: number[]; color: string; muted?: boolean[] }) {
  const W = 300, H = 90, pad = 6;
  const n = Math.max(1, values.length);
  const max = Math.max(1, ...values);
  const gap = n > 40 ? 0.6 : n > 14 ? 1.4 : 4;
  const bw = Math.max(0.6, (W - gap * (n - 1)) / n);
  return (
    <svg className="hero-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {values.map((v, i) => {
        const h = (v / max) * (H - pad);
        const x = i * (bw + gap);
        return (
          <rect key={i} x={x} y={H - h} width={bw} height={h} rx={bw > 3 ? 1.5 : 0}
            fill={color} fillOpacity={muted?.[i] ? 0.16 : 0.55} />
        );
      })}
    </svg>
  );
}
