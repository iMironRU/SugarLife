/* SugarLife PWA — компактный движок рендеринга под дизайн-диалект прототипа.
   Поддерживает: {{ выражение }} в тексте и атрибутах, <sc-if value>, <sc-for list as>,
   события onClick/onScroll/onInput/onChange, псевдосостояния style-hover/-active/-focus,
   SVG-namespace. Обновление — точечное (morph): узлы переиспользуются, меняются только
   изменившиеся текст/атрибуты → нет мигания, шторки не переанимируются, скролл и фокус
   сохраняются. События делегированы от корня, поэтому обработчики всегда свежие. */
(() => {
  'use strict';

  // --- вычисление выражений (статичные, написаны нами, не пользователем) ---
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
  const TOKEN = /\{\{([\s\S]*?)\}\}/g;
  function interpolate(str, ctx) {
    if (str.indexOf('{{') === -1) return str;
    return str.replace(TOKEN, (_, e) => { const v = evalExpr(e, ctx); return v == null ? '' : String(v); });
  }
  const SINGLE = /^\s*\{\{([\s\S]*?)\}\}\s*$/;
  function rawAttr(str, ctx) { const m = SINGLE.exec(str); return m ? evalExpr(m[1], ctx) : interpolate(str, ctx); }
  function pick(node, name) { const raw = node.getAttribute(name) || ''; const m = SINGLE.exec(raw); return m ? m[1] : raw; }

  const EVENTS = { onclick: 'click', onscroll: 'scroll', oninput: 'input', onchange: 'input' };
  const PSEUDO = { 'style-hover': 'hover', 'style-active': 'active', 'style-focus': 'focus' };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SVG_TAGS = new Set(['svg', 'path', 'rect', 'line', 'circle', 'g', 'polyline', 'polygon', 'defs', 'lineargradient', 'stop', 'text', 'ellipse']);

  // ============ ПОСТРОЕНИЕ нового (детачнутого) дерева из шаблона ============
  function build(node, ctx, out) {
    const T = node.nodeType;
    if (T === 3) { const t = node.nodeValue; out.push(document.createTextNode(t.indexOf('{{') === -1 ? t : interpolate(t, ctx))); return; }
    if (T !== 1) return;

    const tag = node.localName.toLowerCase();
    if (tag === 'sc-if') { if (evalExpr(pick(node, 'value'), ctx)) buildChildren(node, ctx, out); return; }
    if (tag === 'sc-for') {
      const arr = evalExpr(pick(node, 'list'), ctx);
      const as = node.getAttribute('as') || 'item';
      if (Array.isArray(arr)) for (let i = 0; i < arr.length; i++) { const c = Object.create(ctx); c[as] = arr[i]; c.$index = i; buildChildren(node, c, out); }
      return;
    }

    const isSvg = SVG_TAGS.has(tag);
    const el = isSvg ? document.createElementNS(SVG_NS, node.localName) : document.createElement(node.localName);
    let ev = null, ps = null, valueExpr = null;
    const attrs = node.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const name = attrs[i].name, val = attrs[i].value;
      if (name.indexOf('hint-') === 0 || name === 'as') continue;
      if (EVENTS[name] !== undefined) {
        const fn = rawAttr(val, ctx);
        if (typeof fn === 'function') { (ev || (ev = {}))[EVENTS[name]] = fn; }
        continue;
      }
      if (PSEUDO[name]) { (ps || (ps = {}))[PSEUDO[name]] = interpolate(val, ctx); continue; }
      if (name === 'value') { valueExpr = val; continue; }
      const out2 = interpolate(val, ctx);
      if (isSvg) el.setAttributeNS(null, attrs[i].name, out2); else el.setAttribute(name, out2);
    }
    if (ev) el.__ev = ev;
    if (ps) { ps.base = el.getAttribute('style') || ''; el.__pseudo = ps; }
    buildChildren(node, ctx, el);
    if (tag === 'input' || tag === 'textarea') { el.__isInput = true; el.value = valueExpr != null ? interpolate(valueExpr, ctx) : ''; }
    out.push(el);
  }
  function buildChildren(node, ctx, target) {
    const isArr = Array.isArray(target), acc = isArr ? target : [];
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) build(kids[i], ctx, acc);
    if (!isArr) for (let i = 0; i < acc.length; i++) target.appendChild(acc[i]);
  }

  // ============ ТОЧЕЧНОЕ ОБНОВЛЕНИЕ (morph) ============
  function morphable(o, n) {
    if (o.nodeType !== n.nodeType) return false;
    if (o.nodeType !== 1) return true;
    return o.namespaceURI === n.namespaceURI && o.localName === n.localName;
  }

  function reconcile(parent, newParent) {
    const news = Array.prototype.slice.call(newParent.childNodes);
    for (let i = 0; i < news.length; i++) {
      const n = news[i], o = parent.childNodes[i];
      if (!o) { parent.appendChild(n); mountNode(n); }
      else if (morphable(o, n)) morph(o, n);
      else { parent.replaceChild(n, o); mountNode(n); }
    }
    while (parent.childNodes.length > news.length) parent.removeChild(parent.lastChild);
  }

  function morph(o, n) {
    if (o.nodeType === 3) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
    // атрибуты
    const na = n.attributes, oa = o.attributes;
    for (let i = 0; i < na.length; i++) { const a = na[i]; if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value); }
    for (let i = oa.length - 1; i >= 0; i--) { const name = oa[i].name; if (!n.hasAttribute(name)) o.removeAttribute(name); }
    // поведение (всегда берём свежие обработчики)
    o.__ev = n.__ev || null;
    o.__isInput = n.__isInput;
    // псевдосостояния
    if (n.__pseudo) {
      if (!o.__pseudo) o.__pseudo = n.__pseudo;
      else { o.__pseudo.base = n.__pseudo.base; o.__pseudo.hover = n.__pseudo.hover; o.__pseudo.active = n.__pseudo.active; o.__pseudo.focus = n.__pseudo.focus; }
      ensurePseudo(o);
      if (o.__papply) o.__papply();
    }
    // значение инпута — не трогаем сфокусированное поле (иначе прыгает каретка)
    if (o.__isInput && document.activeElement !== o && o.value !== n.value) o.value = n.value;
    reconcile(o, n);
  }

  function mountNode(node) {
    if (node.nodeType !== 1) return;
    ensurePseudo(node);
    for (let c = node.firstChild; c; c = c.nextSibling) mountNode(c);
  }

  function ensurePseudo(el) {
    const ps = el.__pseudo;
    if (!ps || el.__pbound) return;
    el.__pbound = true;
    const apply = () => {
      el.style.cssText = ps.base
        + (el.__ph && ps.hover ? ';' + ps.hover : '')
        + (el.__pa && ps.active ? ';' + ps.active : '')
        + (el.__pf && ps.focus ? ';' + ps.focus : '');
    };
    el.__papply = apply;
    if (ps.hover) { el.addEventListener('mouseenter', () => { el.__ph = true; apply(); }); el.addEventListener('mouseleave', () => { el.__ph = false; el.__pa = false; apply(); }); }
    if (ps.active) { el.addEventListener('mousedown', () => { el.__pa = true; apply(); }); el.addEventListener('mouseup', () => { el.__pa = false; apply(); }); if (!ps.hover) el.addEventListener('mouseleave', () => { el.__pa = false; apply(); }); }
    if (ps.focus) { el.addEventListener('focusin', () => { el.__pf = true; apply(); }); el.addEventListener('focusout', () => { el.__pf = false; apply(); }); }
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

    // делегирование событий от корня (обработчики всегда актуальны через __ev)
    const dispatch = (type) => (e) => {
      let n = e.target;
      while (n && n !== rootEl.parentNode) { if (n.__ev && n.__ev[type]) { n.__ev[type](e); return; } n = n.parentNode; }
    };
    rootEl.addEventListener('click', dispatch('click'));
    rootEl.addEventListener('input', dispatch('input'));
    // scroll не всплывает → capture; привязка строго к целевому скроллеру (без подъёма вверх)
    rootEl.addEventListener('scroll', (e) => { const t = e.target; if (t && t.__ev && t.__ev.scroll) t.__ev.scroll(e); }, true);

    let scheduled = false;
    const rerender = () => {
      const props = comp.renderVals();
      const frag = document.createDocumentFragment();
      const acc = [];
      const kids = tpl.childNodes;
      for (let i = 0; i < kids.length; i++) build(kids[i], props, acc);
      for (let i = 0; i < acc.length; i++) frag.appendChild(acc[i]);
      reconcile(rootEl, frag);
      if (props.themeAttr) {
        rootEl.setAttribute('data-theme', props.themeAttr);
        document.documentElement.setAttribute('data-theme', props.themeAttr);
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', props.themeAttr === 'light' ? '#f4f4f8' : '#161826');
      }
    };
    // склеиваем частые setState в один кадр
    comp._onChange = () => {
      if (scheduled) return;
      scheduled = true;
      (window.requestAnimationFrame || window.setTimeout)(() => { scheduled = false; rerender(); });
    };

    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      const onSys = () => { if ((comp.state.theme || 'dark') === 'system') rerender(); };
      mq.addEventListener ? mq.addEventListener('change', onSys) : mq.addListener(onSys);
    }
    rerender();
  }

  window.DC = { DCLogic, mount };
})();
