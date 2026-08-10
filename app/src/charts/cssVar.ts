/* Чтение дизайн-токена из CSS. Живёт отдельно от EChart намеренно: графики грузятся
   лениво (echarts — самая тяжёлая зависимость), а цвета нужны синхронно при сборке
   опций. Если бы cssVar экспортировался из EChart, любой импорт цвета утягивал бы
   за собой всю библиотеку и ленивая загрузка теряла бы смысл. */
export function cssVar(name: string, fallback = '#888') {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
