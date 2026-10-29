// A small stand-in for the browser, enough to run the client's scripts in
// node:vm against fixtures (tools/test_contract.mjs). It is not a DOM: it
// holds elements, attributes, text, events, a selector subset (tags, #id,
// .class, [attr], [attr="v"], :not(), descendant and child combinators,
// comma lists) and a tag-soup HTML parser for innerHTML. Everything a script
// asks of the world (fetch, EventSource, XMLHttpRequest, timers, location,
// window.open, sendBeacon) is recorded in `world.calls`, so a test compares
// what the client did, not how.

const VOID = new Set(['img', 'br', 'hr', 'input', 'source', 'meta', 'link', 'wbr', 'col', 'area', 'base', 'embed', 'track']);
const REFLECTED = ['id', 'href', 'src', 'title', 'type', 'alt', 'rel', 'placeholder', 'accept', 'name', 'role', 'target', 'draggable', 'autocomplete'];
const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const decode = (s) => s.replace(/&(lt|gt|amp|quot|#39|#34|apos);/g, (_, e) =>
  ({ lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'", '#34': '"', apos: "'" })[e]);
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(String(s)).replace(/"/g, '&quot;');

class Node {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; this._listeners = new Map(); }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const s = this.parentNode.childNodes;
    return s[s.indexOf(this) + 1] || null;
  }
  get children() { return this.childNodes.filter((n) => n instanceof Element); }
  appendChild(n) { return this.insertBefore(n, null); }
  insertBefore(n, ref) {
    if (n instanceof Fragment) { for (const c of [...n.childNodes]) this.insertBefore(c, ref); return n; }
    if (n.parentNode) n.parentNode.removeChild(n);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
    n.parentNode = this;
    return n;
  }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceWith(n) { const p = this.parentNode; if (!p) return; p.insertBefore(n, this); p.removeChild(this); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v !== '' && v != null) this.appendChild(new Text(this.ownerDocument, String(v)));
  }
  addEventListener(type, f) { if (!this._listeners.has(type)) this._listeners.set(type, []); this._listeners.get(type).push(f); }
  removeEventListener(type, f) { const l = this._listeners.get(type); if (l) { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); } }
  dispatchEvent(ev) {
    if (!ev.target) ev.target = this;
    for (let n = this; n && !ev._stopped; n = n.parentNode) {
      ev.currentTarget = n;
      // A listener that throws is reported and the rest still run, as in a browser.
      const run = (f) => { try { f.call(n, ev); } catch (e) { const w = this.ownerDocument && this.ownerDocument.world; if (w) w.errors.push(`${ev.type} listener: ${e && e.message || e}`); else throw e; } };
      for (const f of [...(n._listeners.get(ev.type) || [])]) run(f);
      const on = n['on' + ev.type];
      if (typeof on === 'function') run(on);
      if (ev.bubbles === false) break;
    }
    return !ev.defaultPrevented;
  }
  querySelectorAll(sel) { const out = []; const groups = parseSelector(sel); walk(this, (e) => { if (groups.some((g) => matchGroup(e, g))) out.push(e); }); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
class Text extends Node {
  constructor(doc, s) { super(doc); this.data = s; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}
class Fragment extends Node {}

class Element extends Node {
  constructor(doc, tag) {
    super(doc);
    this.tagName = tag.toUpperCase();
    this.localName = tag.toLowerCase();
    this.attrs = new Map();
    this.style = {};
    const el = this;
    this.dataset = new Proxy({}, {
      get: (_, p) => (typeof p === 'string' && el.attrs.has('data-' + kebab(p))) ? el.attrs.get('data-' + kebab(p)) : undefined,
      set: (_, p, v) => { el.setAttribute('data-' + kebab(p), v); return true; },
      deleteProperty: (_, p) => { el.removeAttribute('data-' + kebab(p)); return true; },
      has: (_, p) => el.attrs.has('data-' + kebab(p)),
    });
    if (this.localName === 'template') this.content = new Fragment(doc);
    if (this.localName === 'textarea' || this.localName === 'input') { this.value = ''; this.selectionStart = 0; this.selectionEnd = 0; }
  }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    const put = (l) => el.setAttribute('class', l.join(' '));
    return {
      contains: (c) => list().includes(c),
      add: (...cs) => { const l = list(); for (const c of cs) if (!l.includes(c)) l.push(c); put(l); },
      remove: (...cs) => put(list().filter((c) => !cs.includes(c))),
      toggle: (c, force) => {
        const has = list().includes(c);
        const want = force === undefined ? !has : !!force;
        if (want && !has) put([...list(), c]); else if (!want && has) put(list().filter((x) => x !== c));
        return want;
      },
    };
  }
  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  set innerHTML(html) {
    const target = this.localName === 'template' ? this.content : this;
    target.textContent = '';
    parseHTML(this.ownerDocument, String(html), target);
  }
  matches(sel) { return parseSelector(sel).some((g) => matchGroup(this, g)); }
  closest(sel) { const gs = parseSelector(sel); for (let n = this; n instanceof Element; n = n.parentNode) if (gs.some((g) => matchGroup(n, g))) return n; return null; }
  focus() { this.ownerDocument.activeElement = this; }
  blur() {}
  // click: as a script's el.click(); an <a> it clicks is a navigation, recorded.
  // userClick: as a person's click, which the browser, not the client, follows.
  userClick() { this.dispatchEvent(this.ownerDocument.event('click')); }
  click() {
    const ev = this.ownerDocument.event('click');
    this.dispatchEvent(ev);
    if (this.localName === 'a' && !ev.defaultPrevented) this.ownerDocument.world.call('link-click', { href: this.getAttribute('href') });
  }
  scrollIntoView() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  showModal() { this.open = true; this.setAttribute('open', ''); }
  close() { if (!this.open) return; this.open = false; this.removeAttribute('open'); this.dispatchEvent(this.ownerDocument.event('close', { bubbles: false })); }
  getContext() { return { fillRect() {}, drawImage() {} }; }
  toDataURL() { return 'data:image/png;base64,'; }
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
}
for (const k of REFLECTED) {
  Object.defineProperty(Element.prototype, k, {
    get() { return this.getAttribute(k) ?? ''; },
    set(v) { this.setAttribute(k, v); },
  });
}

function walk(root, f) { for (const c of root.childNodes) if (c instanceof Element) { f(c); walk(c, f); } }

// ── selectors ──────────────────────────────────────────────────────────────
const cache = new Map();
function parseSelector(sel) {
  if (cache.has(sel)) return cache.get(sel);
  const groups = sel.split(',').map((g) => {
    const toks = g.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
    const parts = [];
    let comb = ' ';
    for (const t of toks) { if (t === '>') { comb = '>'; continue; } parts.push({ comb, c: compound(t) }); comb = ' '; }
    return parts;
  });
  cache.set(sel, groups);
  return groups;
}
function compound(t) {
  const c = { tag: null, ids: [], classes: [], attrs: [], nots: [] };
  const re = /^([a-zA-Z*][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]|:not\(([^)]*)\)/y;
  let i = 0;
  while (i < t.length) {
    re.lastIndex = i;
    const m = re.exec(t);
    if (!m) throw new Error('fakedom: selector not understood: ' + t);
    if (m[1]) c.tag = m[1] === '*' ? null : m[1].toUpperCase();
    else if (m[2]) c.ids.push(m[2]);
    else if (m[3]) c.classes.push(m[3]);
    else if (m[4]) c.attrs.push([m[4], m[5] ?? m[6] ?? m[7]]);
    else if (m[8] !== undefined) c.nots.push(compound(m[8]));
    i = re.lastIndex;
  }
  return c;
}
function matchCompound(e, c) {
  if (!(e instanceof Element)) return false;
  if (c.tag && e.tagName !== c.tag) return false;
  for (const id of c.ids) if (e.getAttribute('id') !== id) return false;
  for (const k of c.classes) if (!e.classList.contains(k)) return false;
  for (const [k, v] of c.attrs) { if (!e.hasAttribute(k)) return false; if (v !== undefined && e.getAttribute(k) !== v) return false; }
  for (const n of c.nots) if (matchCompound(e, n)) return false;
  return true;
}
function matchGroup(e, parts, i = parts.length - 1) {
  if (!matchCompound(e, parts[i].c)) return false;
  if (i === 0) return true;
  if (parts[i].comb === '>') return matchGroup(e.parentNode, parts, i - 1);
  for (let a = e.parentNode; a instanceof Element; a = a.parentNode) if (matchGroup(a, parts, i - 1)) return true;
  return false;
}

// ── HTML in and out ────────────────────────────────────────────────────────
function parseHTML(doc, html, into) {
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|[^<]+|</g;
  const stack = [into];
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].localName === tag) { stack.length = i; break; }
    } else if (m[2]) {
      const el = doc.createElement(m[2]);
      const are = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = are.exec(m[3] || ''))) el.setAttribute(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ''));
      top.appendChild(el);
      if (!VOID.has(el.localName) && !m[0].endsWith('/>')) stack.push(el);
    } else {
      top.appendChild(doc.createTextNode(decode(m[0])));
    }
  }
}

// serialize: an element as HTML, with its style and form state, so two runs
// can be compared as strings.
export function serialize(n) {
  if (n instanceof Text) return escText(n.data);
  if (!(n instanceof Element)) return n.childNodes.map(serialize).join('');
  let s = '<' + n.localName;
  for (const [k, v] of n.attrs) s += ` ${k}="${escAttr(v)}"`;
  const st = Object.keys(n.style).filter((k) => n.style[k] !== '' && n.style[k] != null).sort();
  if (st.length) s += ` style="${escAttr(st.map((k) => k + ':' + n.style[k]).join(';'))}"`;
  if ((n.localName === 'textarea' || n.localName === 'input') && n.value) s += ` value="${escAttr(n.value)}"`;
  if (n.disabled) s += ' disabled';
  s += '>';
  if (VOID.has(n.localName)) return s;
  return s + n.childNodes.map(serialize).join('') + `</${n.localName}>`;
}

// ── the world: one document, and every effect recorded ─────────────────────
export function makeWorld(opts = {}) {
  const calls = [];
  const world = { calls, routes: [], timers: [], sources: [], errors: [] };
  world.call = (kind, detail) => calls.push({ kind, ...detail });

  const doc = new Fragment(null);
  doc.ownerDocument = doc;
  doc.world = world;
  doc.event = (type, extra = {}) => ({
    type, bubbles: true, defaultPrevented: false, _stopped: false, target: null, currentTarget: null,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stopped = true; },
    ...extra,
  });
  doc.createElement = (t) => new Element(doc, t);
  doc.createTextNode = (s) => new Text(doc, String(s));
  doc.createDocumentFragment = () => new Fragment(doc);
  doc.documentElement = doc.createElement('html');
  doc.appendChild(doc.documentElement);
  doc.head = doc.createElement('head');
  doc.body = doc.createElement('body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.getElementById = (id) => doc.querySelector('#' + id);
  doc.elementFromPoint = () => world.pointAt || null;
  doc.activeElement = doc.body;
  world.document = doc;

  // fetch answers from world.routes: [method, url (string or RegExp), answer]
  // where answer is {status, body} or a function (url, init) giving one.
  function answer(method, url, init) {
    for (const [m, u, a] of world.routes) {
      if (m !== method) continue;
      if (typeof u === 'string' ? u === url : u.test(url)) return typeof a === 'function' ? a(url, init) : a;
    }
    return { status: 404, body: 'no route in the test for ' + method + ' ' + url };
  }
  const bodyOf = (b) => b == null ? null : typeof b === 'string' ? b : b instanceof URLSearchParams ? b.toString() : b.constructor && b.constructor.name === 'FormData' ? '[FormData ' + [...b.keys()].join(',') + ']' : String(b);
  function response(a) {
    const text = a.body === undefined ? '' : typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
    return {
      ok: a.status >= 200 && a.status < 300, status: a.status, redirected: !!a.redirected,
      json: () => Promise.resolve().then(() => JSON.parse(text)),
      text: () => Promise.resolve(text),
    };
  }
  const fetch = (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    world.call('fetch', { method, url: String(url), headers: init.headers || null, body: bodyOf(init.body) });
    return Promise.resolve(response(answer(method, String(url), init)));
  };

  class EventSource {
    constructor(url) { this.url = url; this._l = new Map(); this.closed = false; world.sources.push(this); world.call('eventsource', { url }); }
    addEventListener(t, f) { if (!this._l.has(t)) this._l.set(t, []); this._l.get(t).push(f); }
    close() { this.closed = true; world.call('eventsource-close', { url: this.url }); }
    // emit: one frame, `event:` type and `data:` text, as the browser hands it over.
    emit(type, data) {
      if (this.closed) return;
      const ev = { type, data };
      try {
        for (const f of this._l.get(type) || []) f(ev);
        if (type === 'message' && this.onmessage) this.onmessage(ev);
      } catch (e) { world.errors.push(String(e && e.message || e)); }
    }
    listens() { return [...this._l.keys(), ...(this.onmessage ? ['message'] : [])]; }
  }

  class XMLHttpRequest {
    constructor() { this.upload = {}; this.status = 0; this.responseText = ''; }
    open(method, url) { this.method = method.toUpperCase(); this.url = url; }
    send(body) {
      world.call('xhr', { method: this.method, url: this.url, body: bodyOf(body) });
      const a = answer(this.method, this.url, { body });
      queueMicrotask(() => {
        this.status = a.status;
        this.responseText = a.body === undefined ? '' : typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
        try { this.onload && this.onload(); } catch (e) { world.errors.push(String(e && e.message || e)); }
      });
    }
  }

  let nextTimer = 1;
  const setTimeout = (f, ms) => { const id = nextTimer++; world.timers.push({ id, f, ms }); return id; };
  const clearTimeout = (id) => { world.timers = world.timers.filter((t) => t.id !== id); };
  world.runTimers = () => {
    for (let n = 0; world.timers.length && n < 100; n++) {
      const t = world.timers.shift();
      try { t.f(); } catch (e) { world.errors.push(String(e && e.message || e)); }
    }
  };

  const location = {
    _href: opts.href || 'https://chat.test/', hash: opts.hash || '',
    get href() { return this._href; },
    set href(v) { this._href = v; world.call('navigate', { href: v }); },
    reload() { world.call('reload', {}); },
  };
  const win = new Fragment(doc); // an event target for window listeners
  const store = new Map();
  const localStorage = {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  // The globals a script sees. `window` is the global itself, as in a page.
  const g = {
    document: doc, location, localStorage, fetch, EventSource, XMLHttpRequest, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval() {}, queueMicrotask,
    URLSearchParams, TextEncoder, FormData, Blob, Map, Set, Promise, JSON, Math, Number, String, Array, Object, Date, Intl,
    encodeURIComponent, decodeURIComponent, parseInt, isNaN, Error, Proxy,
    crypto: { randomUUID: () => 'cid-' + (world.cids = (world.cids || 0) + 1) },
    navigator: { sendBeacon: (url, blob) => { world.call('beacon', { url, type: blob && blob.type }); return true; } },
    history: { replaceState: (_s, _t, url) => world.call('replace-state', { url }) },
    open: (url, target) => world.call('window-open', { url, target }),
    addEventListener: (t, f) => win.addEventListener(t, f),
    removeEventListener: (t, f) => win.removeEventListener(t, f),
    dispatchWindowEvent: (t, extra) => win.dispatchEvent(doc.event(t, extra)),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    console: { log() {}, warn() {}, error: (...a) => world.call('console-error', { text: a.map((x) => typeof x === 'string' ? x : x && x.message || JSON.stringify(x)).join(' ') }) },
  };
  g.window = g;
  world.global = g;
  return world;
}
