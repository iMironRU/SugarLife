/* Живые размеры «рамы» приложения — верхней панели и таббара — в CSS-переменные.

   Зачем: карточки (облако, устройство, профиль петли) открываются НЕ поверх всего
   экрана, а между панелью и таббаром. Тогда сахар виден всё время, пока человек
   что-то настраивает, а до «Сегодня» — одно касание из любой глубины, без закрытия
   слоёв по очереди.

   Считать эти высоты в CSS нельзя: у панели три состояния разной высоты, и она
   меняется на ходу (сворачивается при прокрутке), а у таббара снизу ещё safe-area,
   разная на разных телефонах. Поэтому меряем настоящие элементы и отдаём в переменные.

   Первая попытка мерила один раз при монтировании — и записала нули: эффект
   выполняется до того, как оболочка окажется в DOM. Поэтому ждём появления
   элементов наблюдателем и отключаем его, как только оба найдены: следить за всеми
   изменениями дерева в приложении с графиками — дорого, а нужно это ровно один раз. */

const put = (name: string, el: Element | null): boolean => {
  if (!el) return false;
  document.documentElement.style.setProperty(name, Math.round(el.getBoundingClientRect().height) + 'px');
  return true;
};

export function watchChrome(): () => void {
  let ro: ResizeObserver | null = null;
  let mo: MutationObserver | null = null;

  const measure = () => {
    const panel = document.querySelector('.hero-panel');
    const tabbar = document.querySelector('.tabbar');
    put('--sl-panel-h', panel);
    put('--sl-tabbar-h', tabbar);
    return !!panel && !!tabbar;
  };

  const attach = () => {
    const panel = document.querySelector('.hero-panel');
    const tabbar = document.querySelector('.tabbar');
    if (!panel || !tabbar) return false;
    ro = new ResizeObserver(measure);
    ro.observe(panel);
    ro.observe(tabbar);
    measure();
    return true;
  };

  if (!attach()) {
    mo = new MutationObserver(() => { if (attach()) { mo?.disconnect(); mo = null; } });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  window.addEventListener('resize', measure);
  /* Подстраховка к наблюдателю: первый замер попадает на момент, когда иконки ещё не
     разложились, и высота выходит меньше настоящей. ResizeObserver это потом
     поправит — но только если страница видима, а на старте она может быть и в фоне.
     Два дешёвых повторных замера снимают вопрос. */
  document.fonts?.ready.then(measure).catch(() => {});
  setTimeout(measure, 800);

  return () => {
    ro?.disconnect(); mo?.disconnect();
    window.removeEventListener('resize', measure);
  };
}
