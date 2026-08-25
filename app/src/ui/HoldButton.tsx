import { useRef } from 'react';
import Иконка from './Иконка';
import { timeOutline } from 'ionicons/icons';

/* Кнопка «удерживайте, чтобы применить» (из прототипа мастера петли, 1100 мс).

   Не украшение: на экране, где настраивается подача инсулина, случайный тап не
   должен ничего применять. Полоса заполнения показывает прогресс удержания —
   иначе непонятно, что от тебя хотят.

   ОНА ОБЯЗАНА ОТЛИЧАТЬСЯ ОТ ОБЫЧНОЙ — ДО НАЖАТИЯ, А НЕ ПОСЛЕ (замечание владельца).

   Полоса заполнения объясняет происходящее тому, кто уже держит. Тому, кто только смотрит на
   экран, она не говорит ничего: он видит кнопку, жмёт её как все прочие, ничего не происходит — и
   делает единственный доступный вывод, что кнопка сломана. Особенно ночью и спросонья, то есть
   ровно там, где мы это удержание и завели.

   Поэтому у неё свой облик: пунктирная рамка (её видно и боковым зрением), значок времени и
   подпись «держите» прямо в кнопке. Слово вместо намёка: значок можно истолковать как «долго
   грузится», слово толкуется однозначно. */
const HOLD_MS = 1100;

export default function HoldButton({ label, disabled, className, holdMs, подсказка = 'держите', onComplete }: {
  label: string; disabled?: boolean;
  /** Слово рядом с названием действия. Пустая строка — скрыть (когда рядом уже всё сказано). */
  подсказка?: string;
  /** Свой вид кнопки — для тревожной полосы, где акцентная заливка была бы призывом. */
  className?: string;
  /* Насколько держать. Умолчание — 1100 мс, столько же, сколько у подачи инсулина. Тревоге
     хватает меньше: там цена ошибки — «не то применил», здесь — «случайно погасил», и держать
     секунду спросонья дольше, чем нужно. */
  holdMs?: number;
  onComplete: () => void;
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
    const держать = holdMs ?? HOLD_MS;
    stop();
    timer.current = window.setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / держать);
      if (fill.current) fill.current.style.width = p * 100 + '%';
      if (p >= 1) { stop(); onComplete(); }
    }, 16);
  };

  return (
    <button
      className={'hold-btn' + (disabled ? ' off' : '') + (className ? ' ' + className : '')}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
    >
      <span className="hold-fill" ref={fill} />
      <span className="hold-label">
        <Иконка icon={timeOutline} />
        {label}
        {подсказка && <span className="hold-hint">{подсказка}</span>}
      </span>
    </button>
  );
}
