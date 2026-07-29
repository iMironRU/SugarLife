/* SugarLife PWA — компактный движок рендеринга под дизайн-диалект прототипа.
   Поддерживает: {{ выражение }} в тексте и атрибутах, <sc-if value>, <sc-for list as>,
   события onClick/onScroll/onInput/onChange, псевдосостояния style-hover/-active/-focus,
   SVG-namespace и сохранение фокуса/каретки инпутов между ре-рендерами.
   Это НЕ проприетарный support.js из хэндофа — это своя реализация под текущую HTML-фазу. */
(() => {
  'use strict';

  // --- вычисление выражений (все выражения статичны и написаны нами, не пользователем) ---
  const exprCache = new Map();
  function compile(expr) {
    let fn = exprCache.get(expr);
    if (!fn) {
      // eslint-disable-next-line no-new-func
      fn = new Function('ctx', 'with (ctx) { return (' + expr + '); }');
      exprCache.set(expr, fn);
    }
    return fn;
  }
  function evalExpr(expr, ctx) {
    try { return compile(expr.trim())(ctx); }
    catch (e) { console.warn('[dc] expr failed:', expr, e); return undefined; }
  }
  // строка с одним или несколькими {{...}} -> итоговая строка
  const TOKEN = /\{\{([\s\S]*?)\}\}/g;
  function interpolate(str, ctx) {
    if (str.indexOf('{{') === -1) return str;
    return str.replace(TOKEN, (_, e) => {
      const v = evalExpr(e, ctx);
      return v == null ? '' : String(v);
    });
  }
  // атрибут вида ровно "{{ x }}" -> сырое значение (функция/число/строка)
  const SINGLE = /^\s*\{\{([\s\S]*?)\}\}\s*$/;
  function rawAttr(str, ctx) {
    const m = SINGLE.exec(str);
    return m ? evalExpr(m[1], ctx) : interpolate(str, ctx);
  }

  const EVENTS = { onclick: 'click', onscroll: 'scroll', oninput: 'input', onchange: 'input' };
  const PSEUDO = { 'style-hover': 'hover', 'style-active': 'active', 'style-focus': 'focus' };
  const SVG_TAGS = new Set(['svg', 'path', 'rect', 'line', 'circle', 'g', 'polyline', 'polygon', 'defs', 'lineargradient', 'stop', 'text', 'ellipse']);

  let inputSeq = 0; // сквозной счётчик инпутов для стабильных ключей фокуса

  // построить массив живых узлов из узла шаблона
  function build(node, ctx, out) {
    const T = node.nodeType;
    if (T === 3) { // текст
      const t = node.nodeValue;
      out.push(document.createTextNode(t.indexOf('{{') === -1 ? t : interpolate(t, ctx)));
      return;
    }
    if (T !== 1) return; // комментарии и пр. пропускаем

    const tag = node.localName.toLowerCase();

    if (tag === 'sc-if') {
      if (evalExpr(pick(node, 'value'), ctx)) buildChildren(node, ctx, out);
      return;
    }
    if (tag === 'sc-for') {
      const arr = evalExpr(pick(node, 'list'), ctx);
      const as = node.getAttribute('as') || 'item';
      if (Array.isArray(arr)) {
        for (let i = 0; i < arr.length; i++) {
          const child = Object.create(ctx);
          child[as] = arr[i];
          child.$index = i;
          buildChildren(node, child, out);
        }
      }
      return;
    }

    // обычный элемент
    const isSvg = SVG_TAGS.has(tag);
    const el = isSvg
      ? document.createElementNS('http://www.w3.org/2000/svg', node.localName)
      : document.createElement(node.localName);

    let hover = null, active = null, focus = null, valueExpr = null;
    const attrs = node.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const name = attrs[i].name;      // в шаблоне уже lower-case (HTML-парсер)
      const val = attrs[i].value;
      if (name.startsWith('hint-') || name === 'as') continue;
      if (EVENTS[name] !== undefined) {
        const fn = rawAttr(val, ctx);
        if (typeof fn === 'function') el.addEventListener(EVENTS[name], fn);
        continue;
      }
      if (PSEUDO[name]) {
        const css = interpolate(val, ctx);
        if (PSEUDO[name] === 'hover') hover = css;
        else if (PSEUDO[name] === 'active') active = css;
        else focus = css;
        continue;
      }
      if (name === 'value') valueExpr = val;
      const out2 = interpolate(val, ctx);
      if (isSvg) el.setAttributeNS(null, attrs[i].name, out2);
      else el.setAttribute(name, out2);
    }

    // псевдосостояния поверх базового стиля
    if (hover || active || focus) attachPseudo(el, hover, active, focus);

    // дети
    buildChildren(node, ctx, el);

    // инпуты: value-свойство + стабильный ключ фокуса
    if (tag === 'input' || tag === 'textarea') {
      if (valueExpr != null) el.value = interpolate(valueExpr, ctx);
      el.__fkey = (valueExpr || tag) + '#' + (inputSeq++);
    }

    out.push(el);
  }

  function buildChildren(node, ctx, target) {
    const isArr = Array.isArray(target);
    const acc = isArr ? target : [];
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) build(kids[i], ctx, acc);
    if (!isArr) for (let i = 0; i < acc.length; i++) target.appendChild(acc[i]);
  }

  function attachPseudo(el, hover, active, focus) {
    let h = false, a = false, f = false;
    // базовый cssText фиксируем лениво при первом взаимодействии
    let base = null;
    const upd = () => {
      if (base == null) base = el.getAttribute('style') || '';
      el.style.cssText = base
        + (h && hover ? ';' + hover : '')
        + (a && active ? ';' + active : '')
        + (f && focus ? ';' + focus : '');
    };
    if (hover) {
      el.addEventListener('mouseenter', () => { h = true; upd(); });
      el.addEventListener('mouseleave', () => { h = false; a = false; upd(); });
    }
    if (active) {
      el.addEventListener('mousedown', () => { a = true; upd(); });
      el.addEventListener('mouseup', () => { a = false; upd(); });
      if (!hover) el.addEventListener('mouseleave', () => { a = false; upd(); });
    }
    if (focus) {
      el.addEventListener('focusin', () => { f = true; upd(); });
      el.addEventListener('focusout', () => { f = false; upd(); });
    }
  }

  function pick(node, name) {
    const raw = node.getAttribute(name) || '';
    const m = SINGLE.exec(raw);
    return m ? m[1] : raw;
  }

  // --- базовый класс логики (замена DCLogic из рантайма прототипа) ---
  class DCLogic {
    constructor() { this.state = {}; }
    setState(patch) {
      const p = (typeof patch === 'function') ? patch(this.state) : patch;
      if (p) Object.assign(this.state, p);
      if (this._onChange) this._onChange();
    }
  }

  // --- монтирование и цикл ре-рендера ---
  function mount(comp, tplEl, rootEl) {
    const tpl = tplEl.content;
    const rerender = () => {
      const props = comp.renderVals();

      // сохранить фокус/каретку
      const ae = document.activeElement;
      let fkey = null, selS = null, selE = null;
      if (ae && rootEl.contains(ae) && ae.__fkey) {
        fkey = ae.__fkey;
        try { selS = ae.selectionStart; selE = ae.selectionEnd; } catch (e) {}
      }

      inputSeq = 0;
      const frag = document.createDocumentFragment();
      const acc = [];
      const kids = tpl.childNodes;
      for (let i = 0; i < kids.length; i++) build(kids[i], props, acc);
      for (let i = 0; i < acc.length; i++) frag.appendChild(acc[i]);

      rootEl.replaceChildren(frag);
      if (props.themeAttr) {
        rootEl.setAttribute('data-theme', props.themeAttr);
        document.documentElement.setAttribute('data-theme', props.themeAttr);
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', props.themeAttr === 'light' ? '#f4f4f8' : '#161826');
      }

      // восстановить фокус
      if (fkey) {
        const inputs = rootEl.querySelectorAll('input, textarea');
        for (let i = 0; i < inputs.length; i++) {
          if (inputs[i].__fkey === fkey) {
            const t = inputs[i];
            t.focus();
            try {
              if (selS != null) {
                const n = t.value.length;
                t.setSelectionRange(Math.min(selS, n), Math.min(selE, n));
              }
            } catch (e) {}
            break;
          }
        }
      }
    };
    comp._onChange = rerender;
    // системная тема -> ре-рендер при режиме 'system'
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      const onSys = () => { if ((comp.state.theme || 'dark') === 'system') rerender(); };
      mq.addEventListener ? mq.addEventListener('change', onSys) : mq.addListener(onSys);
    }
    rerender();
  }

  window.DC = { DCLogic, mount };
})();
