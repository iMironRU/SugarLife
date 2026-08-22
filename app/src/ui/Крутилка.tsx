/* КРУТИЛКА — своя, вместо `IonSpinner` (SugarLife#405). Рисуется целиком в CSS: это круг с вырезом,
   который вращается. Никакой библиотеки для этого не нужно, а `name="crescent"` мы использовали ровно
   в трёх местах. */
export default function Крутилка({ className }: { className?: string }) {
  return <span className={`крутилка${className ? ` ${className}` : ''}`} aria-hidden="true" />;
}
