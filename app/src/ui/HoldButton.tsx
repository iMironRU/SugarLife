import { useRef } from 'react';

/* Кнопка «удерживайте, чтобы применить» (из прототипа мастера петли, 1100 мс).

   Не украшение: на экране, где настраивается подача инсулина, случайный тап не
   должен ничего применять. Полоса заполнения показывает прогресс удержания —
   иначе непонятно, что от тебя хотят. */
const HOLD_MS = 1100;

export default function HoldButton({ label, disabled, onComplete }: {
  label: string; disabled?: boolean; onComplete: () => void;
}) {
  const fill = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (timer.current) { window.clearInterval(timer.current); timer.current = null; }
    if (fill.current) fill.current.style.width = '0%';
  };

  const start = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    const t0 = Date.now();
    stop();
    timer.current = window.setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / HOLD_MS);
      if (fill.current) fill.current.style.width = p * 100 + '%';
      if (p >= 1) { stop(); onComplete(); }
    }, 16);
  };

  return (
    <button
      className={'hold-btn' + (disabled ? ' off' : '')}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
    >
      <span className="hold-fill" ref={fill} />
      <span className="hold-label">{label}</span>
    </button>
  );
}
