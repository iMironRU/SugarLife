/* ПЕРЕКЛЮЧАТЕЛЬ — свой, вместо `IonToggle` (SugarLife#405).

   Ionic весит больше всего приложения, а используется на треть: поверхности у нас давно свои, и
   каждый оставшийся импорт держит в первом экране всю его библиотеку. Переключатель — самый простой
   из оставшихся: разметка в две строки, поведение в одну.

   ЭТО КНОПКА, А НЕ ГАЛОЧКА. `role="switch"` и `aria-checked` — не украшение: без них голосовой доступ
   читает «кнопка», не называя состояния, и человек не знает, включает он или выключает.

   Размер пальца, а не курсора: 44 пикселя — тот минимум, ниже которого промахиваются (и Apple, и
   Google говорят одно и то же). Ширину держим в CSS, здесь только поведение. */
export default function Переключатель({ checked, onChange, disabled, ariaLabel }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`переключатель${checked ? ' вкл' : ''}`}
      onClick={() => { if (!disabled) onChange(!checked); }}
    >
      <span className="переключатель-шарик" />
    </button>
  );
}
