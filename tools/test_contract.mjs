// The client's contract with the server (CONTRACT.md, contract/contract.json),
// held to the client's own scripts. Each script runs in node:vm over a small
// stand-in for the browser (tools/fakedom.mjs), fed the contract's examples,
// and these hold:
//   - every example has its payload's shape (the fixtures match the contract);
//   - every file:line the contract cites says the field it cites it for;
//   - each reader, fed its examples, shows what they say (hand-written checks);
//   - every field the contract names is read under that name: renaming it in
//     the examples changes what the client does, so a renamed key fails;
//   - the client asks for exactly the URLs, streams and events listed, and
//     the markup classes it styles and clicks on are listed;
//   - CONTRACT.md names every payload, field and citation in the JSON.
//
//   node tools/test_contract.mjs                      run the tests
//   node tools/test_contract.mjs --plant P.F[=NEW]    rename field F of payload P
//       in the contract and its examples first (as if the contract followed a
//       server's rename and the client did not), to see the tests go red
//   node tools/test_contract.mjs --check P FILE       a server's own output, one
//       payload P (JSON, or with --lines one JSON a line), against the contract
//   node tools/test_contract.mjs --check-stream S FILE   a capture of stream S
//       (the SSE text as sent) against the contract
//   node tools/test_contract.mjs --check-page G FILE  a page G as served (HTML):
//       its elements, their data-* attributes and its inline JSON
//   CONTRACT_SHOW=P node tools/test_contract.mjs      also print what the client
//       did with payload P's examples (the observation the rename check compares)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { makeWorld, serialize } from './fakedom.mjs';

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const clone = (v) => JSON.parse(JSON.stringify(v));
const C = JSON.parse(read('contract/contract.json'));
const args = process.argv.slice(2);

// ── shapes ─────────────────────────────────────────────────────────────────
// validate(shape, value) → a list of errors, each "path: what". A key the
// shape does not name (nor list as ignored) is an error: a renamed key shows
// as one missing and one unknown.
function validate(shape, v, path = '$', errs = []) {
  if (shape.ref) return validate(C.payloads[shape.ref].shape, v, path, errs);
  if (shape.oneOf) {
    const tries = shape.oneOf.map((s) => validate(s, v, path, []));
    if (tries.some((e) => e.length === 0)) return errs;
    const byKind = shape.oneOf.findIndex((s) => { const k = (s.ref ? C.payloads[s.ref].shape : s).fields?.kind; return k && v && k.const === v.kind; });
    errs.push(...(byKind >= 0 ? tries[byKind] : [`${path}: matches none of ${shape.oneOf.map((s) => s.ref || 'a shape').join(', ')}`]));
    return errs;
  }
  const t = shape.type;
  const isType = { string: (x) => typeof x === 'string', integer: Number.isInteger, number: (x) => typeof x === 'number', boolean: (x) => typeof x === 'boolean', array: Array.isArray, object: (x) => x !== null && typeof x === 'object' && !Array.isArray(x) }[t];
  if (!isType) { errs.push(`${path}: the contract names no type "${t}"`); return errs; }
  if (!isType(v)) { errs.push(`${path}: want ${t}, got ${JSON.stringify(v)}`); return errs; }
  if ('const' in shape && v !== shape.const) errs.push(`${path}: want ${JSON.stringify(shape.const)}, got ${JSON.stringify(v)}`);
  if (shape.enum && !shape.enum.includes(v)) errs.push(`${path}: want one of ${shape.enum.join(', ')}, got ${JSON.stringify(v)}`);
  if (shape.pattern && !new RegExp(shape.pattern).test(v)) errs.push(`${path}: ${JSON.stringify(v)} is not ${shape.pattern}`);
  if (t === 'array' && shape.items) v.forEach((x, i) => validate(shape.items, x, `${path}[${i}]`, errs));
  if (t === 'object' && shape.fields) {
    for (const [k, f] of Object.entries(shape.fields)) {
      if (k in v) validate(f, v[k], `${path}.${k}`, errs);
      else if (f.required) errs.push(`${path}.${k}: missing (required)`);
    }
    for (const k of Object.keys(v)) if (!(k in shape.fields) && !(shape.ignored || []).includes(k)) errs.push(`${path}.${k}: not in the contract`);
  }
  return errs;
}

// fieldPaths: every field a shape names, as a path: ['topics'], ['words','[]','word'].
function fieldPaths(shape, pre = []) {
  const out = [];
  if (shape.type === 'array' && shape.items && shape.items.fields) out.push(...fieldPaths(shape.items, [...pre, '[]']));
  if (shape.type === 'object' && shape.fields) {
    for (const [k, f] of Object.entries(shape.fields)) {
      out.push({ path: [...pre, k], field: f });
      if (f.type === 'array' && f.items && f.items.fields) out.push(...fieldPaths(f.items, [...pre, k, '[]']));
      if (f.type === 'object' && f.fields) out.push(...fieldPaths(f, [...pre, k]));
    }
  }
  return out;
}
const pathName = (p) => p.join('.').replace(/\.\[\]/g, '[]');
// renameAt: rename the key at `path` in a value, everywhere it occurs; the
// count of keys renamed.
function renameAt(v, path, to) {
  if (v === null || typeof v !== 'object') return 0;
  const [h, ...rest] = path;
  if (h === '[]') return Array.isArray(v) ? v.reduce((n, x) => n + renameAt(x, rest, to), 0) : 0;
  if (rest.length) return renameAt(v[h], rest, to);
  if (!(h in v)) return 0;
  v[to(h)] = v[h]; delete v[h];
  return 1;
}

// ── servers' own output (the --check modes) ────────────────────────────────
function report(errs, what) {
  if (errs.length) { console.error(`${what}: ${errs.length} disagreement(s) with the contract\n  ` + errs.join('\n  ')); process.exit(1); }
  console.log(`${what}: agrees with the contract`);
  process.exit(0);
}
function checkJSONText(names, text, where) {
  let v;
  try { v = JSON.parse(text); } catch (e) { return [`${where}: not JSON (${e.message})`]; }
  const tries = names.map((n) => validate(C.payloads[n].shape, v, where));
  return tries.some((e) => e.length === 0) ? [] : (names.length === 1 ? tries[0] : [`${where}: is none of ${names.join(', ')}: ` + tries.map((e) => e[0]).join(' | ')]);
}
function attrsOf(tag) {
  const out = {};
  const re = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let a;
  while ((a = re.exec(tag))) out[a[1].toLowerCase()] = (a[2] ?? a[3] ?? a[4] ?? '').replace(/&(lt|gt|amp|quot|#39|#34);/g, (_, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'", '#34': '"' })[e]);
  return out;
}
if (args[0] === '--check' || args[0] === '--check-stream' || args[0] === '--check-page') {
  const [mode, name, file] = args;
  const text = readFileSync(file, 'utf8');
  const errs = [];
  if (mode === '--check') {
    if (!C.payloads[name]) report([`no payload "${name}"; the payloads are ${Object.keys(C.payloads).join(', ')}`], file);
    const docs = args.includes('--lines') ? text.split('\n').map((l, i) => [l, `line ${i + 1}`]).filter(([l]) => l.trim()) : [[text, '$']];
    for (const [t, where] of docs) errs.push(...(C.payloads[name].shape.type === 'string' ? validate(C.payloads[name].shape, t.trim(), where) : checkJSONText([name], t, where)));
  } else if (mode === '--check-stream') {
    const s = C.streams[name];
    if (!s) report([`no stream "${name}"; the streams are ${Object.keys(C.streams).join(', ')}`], file);
    text.replace(/\r\n/g, '\n').split(/\n\n+/).forEach((frame, i) => {
      if (!frame.trim() || frame.split('\n').every((l) => l.startsWith(':'))) return;
      let event = 'message';
      const data = [];
      for (const l of frame.split('\n')) {
        const m = /^([a-z]+):\s?(.*)$/.exec(l);
        if (!m) continue;
        if (m[1] === 'event') event = m[2]; else if (m[1] === 'data') data.push(m[2]);
      }
      const e = s.events[event];
      if (!e) { errs.push(`frame ${i + 1}: event "${event}" is not in the contract for ${name}`); return; }
      const d = data.join('\n');
      if (e.data.length === 1 && C.payloads[e.data[0]].shape.type === 'string') errs.push(...validate(C.payloads[e.data[0]].shape, d, `frame ${i + 1} (${event})`));
      else errs.push(...checkJSONText(e.data, d, `frame ${i + 1} (${event})`));
    });
  } else {
    const g = C.pages[name];
    if (!g) report([`no page "${name}"; the pages are ${Object.keys(C.pages).join(', ')}`], file);
    for (const [id, e] of Object.entries(g.elements || {})) {
      const m = new RegExp(`<([a-zA-Z]+)((?:\\s+[^>]*?)?\\sid=(?:"${id}"|'${id}'|${id}\\b)[^>]*)>`).exec(text);
      if (!m) { if (!e.optional) errs.push(`#${id}: missing`); continue; }
      if (e.attributes) {
        const got = Object.fromEntries(Object.entries(attrsOf(m[2])).filter(([k]) => k.startsWith('data-')));
        errs.push(...validate(C.payloads[e.attributes].shape, got, `#${id}`));
      }
      if (e.script) {
        const end = text.indexOf('</script>', m.index);
        errs.push(...checkJSONText([e.script], text.slice(m.index + m[0].length, end), `#${id}`));
      }
    }
    for (const cls of Object.keys(g.classes || {})) if (!new RegExp(`class=["'][^"']*\\b${cls}\\b`).test(text)) errs.push(`.${cls}: missing`);
  }
  report(errs, file);
}

// --plant P.F[=NEW]: the contract and its examples say NEW where they said F.
const plantArg = args.includes('--plant') ? args[args.indexOf('--plant') + 1] : null;
if (plantArg) {
  const m = /^([a-z_]+)\.([\w-]+)(?:=([\w-]+))?$/.exec(plantArg || '');
  if (!m || !C.payloads[m[1]] || !C.payloads[m[1]].shape.fields || !C.payloads[m[1]].shape.fields[m[2]]) { console.error('--plant wants <payload>.<top-level field>[=<new name>]'); process.exit(2); }
  const [, p, f, to = f + '_planted'] = m;
  const fields = C.payloads[p].shape.fields;
  C.payloads[p].shape.fields = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k === f ? to : k, v]));
  for (const ex of C.payloads[p].examples) renameAt(ex, [f], () => to);
  console.log(`planted: ${p}.${f} is ${p}.${to} in the contract and its examples`);
}

// ── running the client ─────────────────────────────────────────────────────
let current = null; // the world a driver is running, for unhandled rejections
process.on('unhandledRejection', (e) => { if (current) current.errors.push('unhandled: ' + String(e && e.message || e)); });
const NOW = Date.parse('2026-10-28T14:10:00Z');
class FixedDate extends Date {
  constructor(...a) { super(...(a.length ? a : [NOW])); }
  static now() { return NOW; }
}
function world(opts) {
  const w = makeWorld(opts);
  w.global.Date = FixedDate;
  w.ctx = vm.createContext(w.global);
  current = w;
  return w;
}
function load(w, files) {
  for (const f of files) {
    try { vm.runInContext(read('js/' + f), w.ctx, { filename: 'js/' + f }); } catch (e) { w.errors.push(`${f}: ${e.message}`); }
  }
}
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
function el(d, tag, attrs = {}, parent = d.body) {
  const e = d.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.appendChild(e);
  return e;
}
const allCalls = []; // every request any baseline run made, for the request checks
const listened = {}; // stream url → the events the client listens for
// observe: what the client did, as text to compare and to read: the DOM it
// built, then one line a call, then its errors.
function observe(w, ...els) {
  return [...els.map(serialize), ...w.calls.map((c) => JSON.stringify(c)), ...w.errors.map((e) => 'error: ' + e)].join('\n');
}
function done(w, obs, extra = {}) {
  current = null;
  return { w, obs, ...extra };
}
// rec: a stub method that records its call (functions left out of the args).
const rec = (w, name) => (...a) => { w.call('stub', { name, args: JSON.parse(JSON.stringify(a, (k, v) => typeof v === 'function' ? undefined : v) ?? 'null') }); };
const P = () => clone(C.payloads.page_chat_root.examples[0]);
const ex = (name) => clone(C.payloads[name].examples);
const sessionBase = (p) => p['data-conv-base'] + '/' + encodeURIComponent(p['data-session']);

// The conversation page: chat.js with the real message.js, chat_reactions.js
// and notify.js; the widgets around them stubbed, each call recorded.
async function chatPage(o = {}) {
  const page = o.root || P();
  const frames = o.frames || ex('message_frame');
  const reactions = o.reactions || ex('reaction_line');
  const w = world();
  const d = w.document;
  const root = el(d, 'div', { id: 'chat-root', ...page });
  el(d, 'div', { id: 'chat-notify' }, root);
  const layout = el(d, 'div', { class: 'chat-layout' }, root);
  el(d, 'div', { id: 'chat-left-sidebar' }, layout);
  el(d, 'script', { type: 'application/json', id: 'chat-sidebar-data' }, layout).textContent = JSON.stringify(o.sidebar || ex('sidebar_data')[0]);
  el(d, 'div', { id: 'chat-feed' }, layout);
  el(d, 'div', { id: 'chat-right-sidebar' }, layout);
  const sb = sessionBase(page);
  w.routes.push(
    ['GET', sb + '/saved', { status: 200, body: o.saved || ex('saved_ids')[0] }],
    ['GET', sb + '/reactions', { status: 200, body: o.sidecar || '' }],
    ['POST', /./, { status: 200, body: '' }],
  );
  const g = w.global;
  g.ChatMiddlePane = {
    init(deps) {
      const bubbles = d.createElement('div');
      deps.mount.appendChild(bubbles);
      let n = 0;
      return {
        bubbles, navbar: d.createElement('div'),
        append(m) { n++; bubbles.appendChild(deps.renderBubble(n, m)); },
        startBacklog: rec(w, 'pane.startBacklog'), endBacklog: rec(w, 'pane.endBacklog'),
        caughtUp: () => true, cursorToExtreme: rec(w, 'pane.cursorToExtreme'),
        focusBubble: rec(w, 'pane.focusBubble'), focus() {}, back() {}, forward() {}, getSelected: () => 0,
      };
    },
  };
  g.ChatCompose = {
    init: (deps) => { rec(w, 'ChatCompose.init')({ sessionBase: deps.sessionBase, uploads: deps.uploads }); return { body: d.createElement('div') }; },
    isPending: () => false, sentHere: (cid) => cid === 'cid-1', ackIfPending: rec(w, 'ChatCompose.ackIfPending'),
    insertAtCursor: rec(w, 'ChatCompose.insertAtCursor'), setMarkdown: rec(w, 'ChatCompose.setMarkdown'), focus() {},
  };
  g.ChatRightSidebar = { init: () => ({}), openCompose() {}, closeCompose() {} };
  g.ChatHelp = { init: (deps) => { w.help = deps; } };
  g.ChatResponsive = { init() {} };
  g.ChatSearch = { init: (deps) => rec(w, 'ChatSearch.init')({ minWord: deps.minWord, sessionBase: deps.sessionBase }), isOpen: () => false, refreshIfOpen() {} };
  g.ChatLeftSidebar = { init: (deps) => { rec(w, 'ChatLeftSidebar.init')({ conv: deps.conv, convBase: deps.convBase, data: deps.data }); return { mount: deps.mount }; } };
  g.ChatEmoji = { pick: rec(w, 'ChatEmoji.pick'), glyphOf: () => '👍' };
  g.ChatSavePopup = { show: (opts) => opts.onConfirm(opts.note) };
  for (const p of ['ChatImagePopup', 'ChatCodePopup', 'ChatTimePopup']) g[p] = { show: rec(w, p + '.show') };
  load(w, ['message.js', 'chat_reactions.js', 'notify.js', 'chat.js']);
  const es = w.sources.find((s) => s.url === sb + '/stream?since=0');
  if (es) {
    const backlog = frames.slice(0, -1);
    es.emit('backlog-size', o.backlogSize ?? String(backlog.length));
    for (const f of backlog) es.emit('message', JSON.stringify(f));
    await flush();
    for (const f of frames.slice(-1)) es.emit('message', JSON.stringify(f));
    w.call('strip', { text: d.querySelector('#chat-notify').textContent });
    for (const l of reactions) es.emit('reaction', JSON.stringify(l));
    await flush();
    // Click everything a reader clicks: each element of each body, then
    // each bubble's buttons.
    // each bubble's buttons on the last one only, so the others keep their
    // saved state as the examples left it.
    const bubbles = d.querySelectorAll('.chat-msg');
    for (const b of bubbles) for (const x of b.querySelectorAll('.chat-body *, .chat-react-chip')) x.userClick();
    const last = bubbles[bubbles.length - 1];
    for (const s of ['.chat-time', '.msg-quote', '.msg-edit', '.msg-save']) { const x = last && last.querySelector(s); if (x) x.userClick(); }
    await flush();
    if (w.help) { w.help.viewRaw(); w.help.downloadBundle(); }
  }
  const styles = d.head.querySelectorAll('style').map((s) => s.textContent).join('\n');
  return done(w, observe(w, d.body), { d, styles });
}

// The left rail: chat_left_sidebar.js with the real drag and add-topic widgets.
async function sidebarPage(o = {}) {
  const page = P();
  const w = world();
  const d = w.document;
  const mount = el(d, 'div', { id: 'chat-left-sidebar' });
  w.routes.push(['POST', /./, o.answer || { status: 200, body: '' }]);
  load(w, ['chat_drag_to_pin.js', 'chat_add_topic.js', 'chat_left_sidebar.js']);
  try {
    w.global.ChatLeftSidebar.init({ mount, conv: page['data-conv'], convBase: page['data-conv-base'], data: clone(o.data || ex('sidebar_data')[0]) });
  } catch (e) { w.errors.push('init: ' + e.message); }
  const es = w.sources.find((s) => s.url === '/chat/sidebar/stream');
  for (const e of o.events || []) es && es.emit('message', JSON.stringify(e));
  if (o.then) await o.then(w, d, mount);
  await flush();
  return done(w, observe(w, mount), { d, mount });
}

// A drag from Sessions to Pinned: the pin request (js/chat_drag_to_pin.js).
async function dragToPin(w, d, mount) {
  const li = mount.querySelector('ul[data-section="sessions"] li[data-sid]');
  const pinned = mount.querySelector('ul[data-section="pinned"]');
  if (!li || !pinned) return;
  const ev = (type, x, y) => d.event(type, { button: 0, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', cancelable: true });
  const drag = (item, to) => {
    item.dispatchEvent(ev('pointerdown', 0, 0));
    item.dispatchEvent(ev('pointermove', 20, 2));
    w.pointAt = to;
    item.dispatchEvent(ev('pointerup', 20, 2));
  };
  drag(li, pinned);
  await flush();
  drag(mount.querySelector('ul[data-section="pinned"] li[data-sid="plans"]'), mount.querySelector('ul[data-section="sessions"]'));
}

// The two readers of a new topic's answer: the rail's Add Topic form and the
// first-topic page.
async function topicCreated(answer, attrs = clone(C.payloads.page_first_topic.examples[0])) {
  const route = { status: 200, body: answer };
  const a = await sidebarPage({
    answer: route,
    then: async (w, d, mount) => {
      const form = mount.querySelector('form.chat-add-topic');
      form.querySelector('input').value = 'lunch';
      form.dispatchEvent(d.event('submit'));
      await flush();
    },
  });
  const w = world();
  const d = w.document;
  el(d, 'div', { id: 'chat-first-topic', ...attrs });
  w.routes.push(['POST', /./, route]);
  load(w, ['chat_add_topic.js', 'chat_first_topic.js']);
  const form = d.querySelector('form.chat-add-topic');
  if (form) form.dispatchEvent(d.event('submit'));
  await flush();
  const b = done(w, observe(w, d.body));
  return { w: a.w, obs: a.obs + b.obs, rail: a, first: b };
}

// The compose box: chat_compose.js, one upload a file and a send.
async function composePage(answers) {
  const page = P();
  const sb = sessionBase(page);
  const w = world();
  const d = w.document;
  const rail = { wrapper: el(d, 'div'), closedPanel: null, registerComposeBody() {} };
  const queue = [...answers];
  w.routes.push(['POST', sb + '/upload', () => ({ status: 200, body: queue.shift() })], ['POST', sb + '/send', { status: 200, body: '' }]);
  w.global.ChatColors = { mutedFg: '#888' };
  w.global.ChatEmoji = { attach() {} };
  load(w, ['chat_compose.js']);
  try {
    w.global.ChatCompose.init({
      rail, sessionBase: sb, closeCompose() {},
      uploads: { imageMax: Number(page['data-upload-image-max']), videoMax: Number(page['data-upload-video-max']), accept: page['data-upload-accept'] },
    });
  } catch (e) { w.errors.push('init: ' + e.message); }
  const file = d.querySelector('#chat-file');
  for (let i = 0; file && i < answers.length; i++) {
    file.files = [{ type: 'image/gif', size: 1000, name: 'x.gif' }];
    file.dispatchEvent(d.event('change'));
    await flush();
  }
  const ta = d.querySelector('#chat-body');
  if (ta) {
    const value = ta.value;
    ta.value = 'hello';
    d.querySelector('#chat-form').dispatchEvent(d.event('submit'));
    await flush();
    w.call('textarea', { value });
  }
  return done(w, observe(w));
}

// The search palette: chat_search.js, a prefix typed, Enter, Enter.
async function searchPage(o = {}) {
  const page = P();
  const w = world();
  const d = w.document;
  w.routes.push(
    ['GET', /^\/chat\/search\/words\?prefix=/, { status: 200, body: o.words || ex('search_words')[0] }],
    ['GET', /^\/chat\/search\/messages\?word=/, { status: 200, body: o.messages || ex('search_messages')[0] }],
  );
  w.global.ChatMiddlePane = { makeNavButton: () => d.createElement('button') };
  load(w, ['message.js', 'chat_search.js']);
  const snaps = [];
  try {
    w.global.ChatSearch.init({ minWord: Number(page['data-search-min']), navbar: el(d, 'div'), focusFeed() {}, sessionBase: sessionBase(page), jumpToId: (id) => w.call('jump', { id }) });
    w.global.ChatSearch.open();
    const dlg = d.querySelector('dialog.chat-search-modal');
    dlg.querySelector('input').value = 'pla';
    dlg.querySelector('input').dispatchEvent(d.event('input'));
    w.runTimers();
    await flush();
    snaps.push(serialize(dlg));
    dlg.dispatchEvent(d.event('keydown', { key: 'Enter' }));
    await flush();
    snaps.push(serialize(dlg));
    dlg.dispatchEvent(d.event('keydown', { key: 'Enter' }));
    await flush();
  } catch (e) { w.errors.push(e.message); }
  return done(w, [...snaps, observe(w)].join('\n'), { snaps });
}

// The status strip: notify.js on the conversation page.
async function notifyPage(events, page = P()) {
  const w = world();
  const d = w.document;
  el(d, 'div', { id: 'chat-root', ...page });
  const strip = el(d, 'div', { id: 'chat-notify' });
  load(w, ['notify.js']);
  const es = w.sources.find((s) => s.url === '/chat/notifications');
  for (const n of events) es && es.emit('message', JSON.stringify(n));
  return done(w, observe(w, strip, d.head), { strip });
}

// Recent, Code, Images: a page's inline JSON, then frames on its stream.
async function feedPage(kind, initial, events = []) {
  const w = world();
  const d = w.document;
  const mount = el(d, 'div', { id: kind + '-mount' });
  el(d, 'script', { id: kind + '-data', type: 'application/json' }).textContent = JSON.stringify(initial);
  w.global.ChatColors = { mutedFg: '#888', softBorder: '#ccc', cardBg: '#fff', metaFg: '#444', border: '#ddd', bg: '#fff', codeStrapBg: '#eee', codeFg: '#111' };
  w.global.ChatCodePopup = { show: rec(w, 'ChatCodePopup.show') };
  w.global.ChatImagePopup = { show: rec(w, 'ChatImagePopup.show') };
  load(w, kind === 'recent' ? ['recent.js'] : ['styles.js', kind + '.js']);
  const es = w.sources.find((s) => s.url === `/chat/${kind}/stream`);
  for (const e of events) es && es.emit('message', JSON.stringify(e));
  for (const x of mount.querySelectorAll('pre, img')) x.userClick();
  return done(w, observe(w, mount), { mount });
}

// A doc's page: docs.js, an edit (render and save), an unload, and a post.
async function docsPage(posted, attrs = clone(C.payloads.page_docs_body.examples[0])) {
  const w = world();
  const d = w.document;
  const ta = el(d, 'textarea', { id: 'docs-body', ...attrs });
  ta.value = 'Hello';
  el(d, 'section', { id: 'docs-preview' });
  el(d, 'span', { id: 'docs-status' });
  el(d, 'button', { id: 'docs-post-btn' });
  const dlg = el(d, 'dialog', { id: 'docs-posted-dialog' });
  el(d, 'button', { id: 'docs-posted-ok' }, dlg);
  w.routes.push(
    ['POST', '/chat/docs/render', { status: 200, body: '<p>Hello</p>' }],
    ['POST', '/chat/docs/save', { status: 204, body: '' }],
    ['POST', '/chat/docs/post', { status: 200, body: posted }],
  );
  load(w, ['docs.js']);
  ta.dispatchEvent(d.event('input'));
  w.runTimers();
  await flush();
  ta.dispatchEvent(d.event('input'));
  w.global.dispatchWindowEvent('beforeunload');
  d.querySelector('#docs-post-btn').click();
  await flush();
  d.querySelector('#docs-posted-ok').click();
  await flush();
  return done(w, observe(w, d.body));
}

// Each payload's driver: its examples in, an observation out.
const DRIVERS = {
  page_chat_root: async (e) => { const a = await chatPage({ root: e[0] }); const b = await notifyPage(ex('notification'), e[0]); return { ...a, obs: a.obs + b.obs, notify: b }; },
  page_first_topic: async (e) => topicCreated(ex('topic_created')[0], e[0]),
  page_docs_body: async (e) => docsPage(ex('docs_posted')[0], e[0]),
  sidebar_data: async (e) => sidebarPage({ data: e[0] }),
  sidebar_topic: async (e) => sidebarPage({ data: { ...ex('sidebar_data')[0], pinned_sessions: e.slice(0, 1), topics: e.slice(1) } }),
  sidebar_user_arrived: async (e) => sidebarPage({ events: e }),
  sidebar_topic_added: async (e) => sidebarPage({ events: e }),
  sidebar_user_online: async (e) => sidebarPage({ events: e }),
  message_frame: async (e) => chatPage({ frames: e }),
  reaction_line: async (e) => chatPage({ reactions: e }),
  saved_ids: async (e) => chatPage({ saved: e[0] }),
  topic_created: async (e) => topicCreated(e[0]),
  upload_answer: async (e) => composePage(e),
  search_words: async (e) => searchPage({ words: e[0] }),
  search_messages: async (e) => searchPage({ messages: e[0] }),
  notification: async (e) => notifyPage(e),
  recent_chat_event: async (e) => feedPage('recent', [], e),
  recent_doc_event: async (e) => feedPage('recent', [], e),
  recent_data: async (e) => feedPage('recent', e[0]),
  code_entry: async (e) => feedPage('code', [], e),
  code_data: async (e) => feedPage('code', e[0]),
  images_entry: async (e) => feedPage('images', [], e),
  images_data: async (e) => feedPage('images', e[0]),
  docs_posted: async (e) => docsPage(e[0]),
  backlog_size: async () => chatPage(),
};

// What each payload's examples must make the client do, checked on the
// unchanged examples.
const has = (s, sub, why) => assert.ok(s.includes(sub), `${why}: wanted ${JSON.stringify(sub)}`);
const hasNot = (s, sub, why) => assert.ok(!s.includes(sub), `${why}: did not want ${JSON.stringify(sub)}`);
const calls = (r, kind) => r.w.calls.filter((c) => c.kind === kind);
const CHECKS = {
  page_chat_root: (r) => {
    has(r.obs, '"url":"/chat/c/1_2/plans/saved"', 'the saved set is asked for at <session-base>/saved');
    has(r.obs, '"url":"/chat/c/1_2/plans/stream?since=0"', 'the topic stream is <session-base>/stream');
    has(r.obs, '"name":"ChatSearch.init","args":[{"minWord":2,', 'data-search-min reaches search');
    has(r.obs, '"uploads":{"imageMax":10485760,"videoMax":104857600,"accept":"image/png', 'the upload limits reach compose');
    has(r.obs, '"name":"ChatLeftSidebar.init","args":[{"conv":"1_2","convBase":"/chat/c/1_2",', 'conv and conv-base reach the rail');
    has(r.obs, 'class="chat-msg mine" id="msg-plans_3"', 'a message with no from_uid is mine by data-me-name');
    has(r.notify.obs, 'Ann: lunch?', 'notify shows a ping about another topic');
    hasNot(r.notify.obs, 'Claude: hi', 'notify drops a ping about the open topic (data-conv, data-session)');
  },
  message_frame: (r) => {
    assert.equal(r.d.querySelectorAll('.chat-msg').length, 4, 'four bubbles');
    has(r.obs, 'class="chat-msg mine" id="msg-plans_1" data-i="0" data-id="plans_1"', 'mine by from_uid, under the name it had then');
    has(r.obs, 'class="chat-msg theirs" id="msg-plans_2"', 'theirs by from_uid');
    has(r.obs, '#1 Steve H · ', 'the meta line numbers it and names its author');
    has(r.obs, 'Edited in <a class="msg-ref" href="#msg-plans_4">MSG_plans_4</a>', 'an "Edit of MSG_" supersedes the original');
    has(r.obs, '✓ your message was sent to plans_4', 'a live frame with this tab\'s cid is acknowledged');
    has(r.obs, '<pre class="chat-quote">quoted words</pre>', 'the html is the body');
    has(r.obs, '"name":"ChatTimePopup.show","args":["2026-10-28T14:08:00Z"]', 'the time opens at `at`');
    has(r.obs, '"pane.endBacklog"', 'the backlog ends after backlog-size frames');
  },
  reaction_line: (r) => {
    const chips = r.d.querySelectorAll('#msg-plans_2 .chat-react-chip');
    assert.equal(chips.length, 1, 'one chip on MSG 2');
    assert.equal(chips[0].textContent, '👍 2', 'two reactors');
    assert.ok(chips[0].classList.contains('mine'), 'mine: one reactor is data-me');
    assert.equal(chips[0].title, 'Steve, Claude — click to remove yours', 'names in the title');
    assert.equal(r.d.querySelectorAll('#msg-plans_1 .chat-react-chip').length, 0, 'a retracted reaction is gone');
  },
  saved_ids: (r) => {
    assert.equal(r.d.querySelector('#msg-plans_2 .msg-save').textContent, '✓ saved', 'a saved id marks its bubble');
    assert.equal(r.d.querySelector('#msg-plans_1 .msg-save').textContent, 'save', 'an unsaved one is not marked');
  },
  sidebar_data: (r) => {
    const s = r.mount;
    const labels = (sec) => s.querySelectorAll(`ul[data-section="${sec}"] li[data-sid] a`).map((a) => a.textContent);
    assert.deepEqual(labels('sessions'), ['ideas', 'zig'], 'the topics are listed under Sessions');
    hasNot(r.obs, 'No sessions yet', 'topics present: no empty-state');
    assert.deepEqual(labels('pinned'), ['plans'], 'the pins are listed under Pinned');
    assert.ok(s.querySelector('li[data-sid="plans"] a.active'), 'the open topic is active');
    assert.ok(s.querySelector('li.online[data-uid="uid:2"] .chat-presence-dot'), 'an online person has the dot, filled');
    assert.ok(!s.querySelector('li[data-uid="ch:general"] .chat-presence-dot'), 'a channel has no dot');
    assert.equal(s.querySelector('li[data-uid="uid:3"] a').getAttribute('href'), '/chat/c/1_3', 'a row links to its url');
  },
  sidebar_topic: (r) => {
    assert.deepEqual(r.mount.querySelectorAll('ul[data-section="pinned"] li[data-sid] a.active').map((a) => [a.textContent, a.getAttribute('href')]), [['plans', '/chat/c/1_2/plans']], 'a pinned topic');
    assert.deepEqual(r.mount.querySelectorAll('ul[data-section="sessions"] li[data-sid="ideas"] a').map((a) => [a.className, a.textContent, a.getAttribute('href')]), [['', 'ideas', '/chat/c/1_2/ideas']], 'a topic');
  },
  sidebar_user_arrived: (r) => assert.equal(r.mount.querySelector('li[data-uid="uid:4"] a')?.textContent, 'Bo', 'an arrived user gets a row'),
  sidebar_topic_added: (r) => assert.deepEqual(r.mount.querySelectorAll('ul[data-section="sessions"] li[data-sid]').map((l) => l.dataset.sid), ['ideas', 'lunch', 'zig'], 'a new topic is placed in order'),
  sidebar_user_online: (r) => assert.ok(r.mount.querySelector('li.online[data-uid="uid:3"]'), 'a user who came online is marked'),
  topic_created: (r) => {
    assert.deepEqual(calls(r.rail, 'navigate').map((c) => c.href), ['/chat/c/1_2/lunch'], 'the rail goes to the new topic');
    assert.deepEqual(calls(r.first, 'navigate').map((c) => c.href), ['/chat/c/1_2/lunch'], 'the first-topic page goes to the new topic');
  },
  page_first_topic: (r) => has(r.first.obs, '"method":"POST","url":"/chat/c/1_2/new"', 'the first topic is made at <conv-base>/new'),
  upload_answer: (r) => {
    const v = calls(r, 'textarea')[0].value;
    has(v, '<img src="/chat/c/1_2/plans/uploads/a.png" alt="a.png" width="640" height="480">', 'an image answer inserts an <img>');
    has(v, '<video src="/chat/c/1_2/plans/uploads/b.webm"></video>', 'a video answer inserts a <video>');
  },
  search_words: (r) => {
    has(r.snaps[0], 'The top 2 words', 'most');
    has(r.snaps[0], '1 topic could not be read', 'unreadable');
    has(r.snaps[0], '<mark>pla</mark>ns', 'the prefix is marked');
    has(r.snaps[0], '3 msgs', 'count');
  },
  search_messages: (r) => {
    has(r.snaps[1], '3 messages (the first 2 shown)', 'matched');
    has(r.snaps[1], 'plans (this topic) · Steve · ', 'a result here');
    has(r.snaps[1], '#general · lunch → · Ann · ', 'a result in a channel');
    has(r.snaps[1], 'See <mark>plans</mark> soon', 'the excerpt');
    assert.deepEqual(calls(r, 'jump').map((c) => c.id), ['plans_1'], 'choosing a result here jumps to it');
  },
  notification: (r) => {
    assert.equal(r.strip.querySelector('a')?.getAttribute('href'), '/chat/c/1_3/lunch', 'a ping links to link_url');
    assert.equal(r.strip.textContent, 'Ann: lunch?', 'a ping about the open topic is dropped');
  },
  recent_chat_event: (r) => {
    has(r.obs, 'href="/channel/general/lunch"', 'a chat row links to url');
    has(r.obs, '#general', 'a channel row names its channel from where');
    has(r.obs, '<div class="recent-avatar">C</div>', 'a DM row\'s avatar is the partner, from where');
    has(r.obs, '<span class="recent-who">Ann: </span>who is in?', 'the preview is who and excerpt');
  },
  recent_doc_event: (r) => { has(r.obs, 'href="/chat/docs/reading-list"', 'a doc row links to its slug'); has(r.obs, '<div class="recent-title">Reading List</div>', 'and is titled by title'); },
  recent_data: (r) => assert.equal(r.mount.querySelectorAll('.recent-tile').length, 2, 'two tiles from the inline JSON'),
  code_entry: (r) => { has(r.obs, 'data-source-id="plans_1"', 'source_id'); has(r.obs, '>zig</div>', 'lang'); has(r.obs, 'const a = 1;', 'body'); has(r.obs, 'href="/chat/c/1_2/plans#msg-plans_1"', 'source_url'); },
  code_data: (r) => assert.equal(r.mount.querySelectorAll('li[data-source-id]').length, 1, 'one entry from the inline JSON'),
  images_entry: (r) => { has(r.obs, 'src="/chat/c/1_2/plans/uploads/a.png"', 'the image'); has(r.obs, 'Sent by Steve', 'from'); },
  images_data: (r) => assert.equal(r.mount.querySelectorAll('li[data-source-id] img').length, 1, 'one image from the inline JSON'),
  docs_posted: (r) => assert.deepEqual(calls(r, 'navigate').map((c) => c.href), ['/chat/c/1_2/plans#msg-plans_5'], 'after a post the page opens the message'),
  page_docs_body: (r) => has(r.obs, '"body":"slug=reading-list"', 'the post names the doc by data-slug'),
  backlog_size: () => {},
};

// ── the tests ──────────────────────────────────────────────────────────────
const tests = [];
const test = (name, f) => tests.push([name, f]);

test('every example has its payload\'s shape (the fixtures match the contract)', () => {
  for (const [name, p] of Object.entries(C.payloads)) {
    assert.ok(p.examples && p.examples.length, `${name}: no examples`);
    p.examples.forEach((e, i) => {
      const errs = validate(p.shape, e, `${name}[${i}]`);
      assert.deepEqual(errs, [], errs.join('\n'));
    });
  }
});

const files = {};
const lineOf = (cite) => { const [f, n] = cite.split(':'); files[f] ??= read(f).split('\n'); return files[f][Number(n) - 1]; };
const camel = (s) => s.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
test('every file:line the contract cites is there and says what it is cited for', () => {
  const bad = [];
  const cite = (c, tokens, what) => {
    if (!/^js\/[\w.]+:\d+(-\d+)?$/.test(c)) { bad.push(`${what}: "${c}" is not js/<file>:<line>`); return; }
    const line = lineOf(c.split('-')[0]);
    if (line === undefined) bad.push(`${what}: ${c} is past the end of the file`);
    else if (tokens.length && !tokens.some((t) => line.includes(t))) bad.push(`${what}: ${c} does not say ${tokens.join(' or ')}: ${line.trim()}`);
  };
  for (const [name, p] of Object.entries(C.payloads)) {
    for (const c of p.shape.read || []) cite(c, [], name);
    for (const { path, field } of fieldPaths(p.shape)) {
      const k = path[path.length - 1];
      for (const c of field.read || []) cite(c, k.startsWith('data-') ? [k, camel(k)] : [k], `${name}.${pathName(path)}`);
    }
  }
  for (const [name, s] of Object.entries(C.streams)) {
    cite(s.opened, ['EventSource'], `stream ${name}`);
    for (const [ev, e] of Object.entries(s.events)) for (const c of e.read) cite(c, ev === 'message' ? ['onmessage'] : [`'${ev}'`], `stream ${name} event ${ev}`);
  }
  for (const r of C.requests) cite(r.sent, [], `request ${r.name}`);
  for (const n of C.navigations) for (const c of n.sent) cite(c, [], `navigation ${n.url}`);
  for (const [g, page] of Object.entries(C.pages)) {
    for (const [id, e] of Object.entries(page.elements || {})) { cite(e.read, [id], `page ${g} #${id}`); if (e.also) cite(e.also, [id], `page ${g} #${id}`); }
    for (const [cls, e] of Object.entries(page.classes || {})) cite(e.read, [cls], `page ${g} .${cls}`);
  }
  for (const m of C.markup.items) for (const c of m.read) cite(c, [], `markup ${m.element}`);
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('every id and data-* attribute the client reads from a page is in the contract', () => {
  const known = new Set([...C.client_made.ids, ...Object.values(C.pages).flatMap((g) => Object.keys(g.elements || {}))]);
  const attrs = new Set([...C.client_made.attributes, ...Object.values(C.payloads).filter((p) => p.carrier.startsWith('the attributes')).flatMap((p) => Object.keys(p.shape.fields))]);
  const bad = [];
  for (const f of read('js/bundles.zig').match(/[\w.]+\.js(?=")/g)) {
    const src = read('js/' + f).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/getElementById\('([\w-]+)'\)/g)) if (!known.has(m[1])) bad.push(`js/${f}: #${m[1]}`);
    for (const m of src.matchAll(/getAttribute\('(data-[\w-]+)'\)/g)) if (!attrs.has(m[1])) bad.push(`js/${f}: ${m[1]}`);
    for (const m of src.matchAll(/\.dataset\.(\w+)/g)) { const a = 'data-' + m[1].replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()); if (!attrs.has(a)) bad.push(`js/${f}: dataset.${m[1]} (${a})`); }
  }
  assert.deepEqual(bad, [], 'not in the contract:\n' + bad.join('\n'));
});

const baselines = {};
for (const [name, p] of Object.entries(C.payloads)) {
  const driver = DRIVERS[name];
  if (!driver) { test(`${name}: has a driver`, () => assert.fail(`no driver runs the client on ${name}`)); continue; }
  test(`${name}: its readers, fed the examples, show what they say`, async () => {
    const r = await driver(clone(p.examples));
    baselines[name] = r;
    if (process.env.CONTRACT_SHOW === name) console.log(r.obs); // what the client did, to read
    allCalls.push(...r.w.calls);
    if (r.rail) allCalls.push(...r.rail.w.calls);
    if (r.first) allCalls.push(...r.first.w.calls);
    if (r.notify) allCalls.push(...r.notify.w.calls);
    for (const s of r.w.sources) listened[s.url] = s.listens();
    assert.deepEqual(r.w.errors, [], `the client failed: ${r.w.errors.join('; ')}`);
    // The rename check below compares runs, so a run must be the same twice.
    assert.equal((await driver(clone(p.examples))).obs, r.obs, 'two runs on the same examples differ');
    await CHECKS[name](r);
  });
  const paths = fieldPaths(p.shape);
  if (paths.length) test(`${name}: every field is read under its name (renaming it changes what the client does)`, async () => {
    const base = baselines[name];
    if (!base) assert.fail('the baseline did not run');
    const unread = [];
    for (const { path } of paths) {
      const e = clone(p.examples);
      const n = e.reduce((k, x) => k + renameAt(x, path, (h) => h + '_renamed'), 0);
      if (!n) { unread.push(`${pathName(path)}: no example carries it`); continue; }
      const r = await driver(e);
      if (r.obs === base.obs) unread.push(`${pathName(path)}: renamed, and nothing changed`);
    }
    assert.deepEqual(unread, [], unread.join('\n'));
  });
}

test('backlog-size: a count ends the backlog after that many frames; anything else stops the topic and says so', async () => {
  const ok = await chatPage({ backlogSize: '3' });
  assert.ok(calls(ok, 'stub').some((c) => c.name === 'pane.endBacklog'), 'the backlog ended');
  const bad = await chatPage({ backlogSize: 'three' });
  assert.ok(calls(bad, 'eventsource-close').length === 1, 'the stream is closed');
  has(serialize(bad.d.querySelector('#chat-notify')), 'did not load right', 'and the page says so');
});

test('the reactions sidecar (GET <session-base>/reactions) is read as the frames are', async () => {
  const lines = ex('reaction_line').map((l) => JSON.stringify(l)).join('\n') + '\n';
  const r = await chatPage({ reactions: [], sidecar: lines });
  CHECKS.reaction_line(r);
});

test('a drag to Pinned asks <conv-base>/<sid>/pin', async () => {
  const r = await sidebarPage({ then: dragToPin });
  allCalls.push(...r.w.calls);
  has(r.obs, '"method":"POST","url":"/chat/c/1_2/ideas/pin"', 'the pin request');
  has(r.obs, '"method":"POST","url":"/chat/c/1_2/plans/unpin"', 'the unpin request');
});

test('each stream is listened to for exactly the events the contract lists', () => {
  const bad = [];
  const page = P();
  for (const [name, s] of Object.entries(C.streams)) {
    const url = s.url.replace('<session-base>', sessionBase(page));
    const got = listened[url];
    if (!got) { bad.push(`${name}: never opened (${url})`); continue; }
    const want = Object.keys(s.events).sort();
    if (JSON.stringify([...new Set(got)].sort()) !== JSON.stringify(want)) bad.push(`${name}: listens for ${[...new Set(got)].sort().join(', ')}, the contract lists ${want.join(', ')}`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

// A contract URL as a pattern: the page's own bases filled in, each other
// placeholder one path segment or query value.
function urlPattern(u) {
  const page = P();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let s = esc(u).replace(esc('<session-base>'), esc(sessionBase(page))).replace(esc('<conv-base>'), '(?:/chat/c/[^/?#]+|/channel/[^/?#]+)');
  s = s.replace(/<q>/g, '[^&#]*').replace(/<[a-z-]+>/g, '[^/?#]+');
  return new RegExp('^' + s + '$');
}
test('every request the client made is in the contract, with its form fields, and each listed request was made', () => {
  const kinds = { fetch: (c) => c.method, xhr: (c) => c.method, eventsource: () => 'GET', 'window-open': () => 'GET', 'link-click': () => 'GET', beacon: () => 'BEACON' };
  const used = new Set();
  const bad = [];
  for (const c of allCalls) {
    if (!kinds[c.kind]) continue;
    const method = kinds[c.kind](c);
    const url = c.url ?? c.href;
    const r = C.requests.find((q) => q.method === method && urlPattern(q.url).test(url));
    if (!r) { bad.push(`${method} ${url}: not in the contract`); continue; }
    used.add(r.name);
    if (r.form && c.kind === 'fetch') {
      const got = [...new URLSearchParams(c.body || '').keys()];
      if (JSON.stringify(got) !== JSON.stringify(r.form)) bad.push(`${r.name}: sends ${got.join(', ')}, the contract lists ${r.form.join(', ')}`);
    }
    if (r.multipart && c.body !== `[FormData ${r.multipart.join(',')}]`) bad.push(`${r.name}: sends ${c.body}, the contract lists ${r.multipart.join(', ')}`);
    for (const [h, v] of Object.entries(r.headers || {})) if (!c.headers || c.headers[h] !== v) bad.push(`${r.name}: no ${h}: ${v}`);
  }
  for (const r of C.requests) if (!used.has(r.name)) bad.push(`${r.name}: listed, never made by the tests`);
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('every navigation the client made is in the contract', () => {
  const urls = C.navigations.filter((n) => n.url !== 'server-made').map((n) => urlPattern(n.url));
  const served = new Set(Object.values(C.payloads).flatMap((p) => p.examples).flatMap(function urls(v) { return v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => typeof x === 'string' && /url$/.test(k) ? [x] : urls(x)) : []; }));
  const bad = allCalls.filter((c) => c.kind === 'navigate').map((c) => c.href).filter((h) => !served.has(h) && !urls.some((p) => p.test(h)));
  assert.deepEqual(bad, [], 'not in the contract: ' + bad.join(', '));
});

test('markup: each class the client styles is in its stylesheet, and each one it routes on is read', async () => {
  const base = baselines.message_frame || await chatPage();
  const bad = [];
  for (const m of C.markup.items) {
    if (m.css && !base.styles.includes(m.css)) bad.push(`${m.element}: js/message.js has no rule for ${m.css}`);
    for (const [from, to] of m.plant || []) {
      const frames = ex('message_frame');
      if (!frames[0].html.includes(from)) { bad.push(`${m.element}: the first example's html has no ${from}`); continue; }
      frames[0].html = frames[0].html.split(from).join(to);
      const r = await chatPage({ frames });
      if (r.obs === base.obs) bad.push(`${m.element}: ${from} made ${to}, and nothing changed`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('CONTRACT.md names every payload, field and citation the JSON has', () => {
  const md = read('CONTRACT.md');
  const cited = (c) => new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![0-9])').test(md);
  const missing = [];
  for (const [name, p] of Object.entries(C.payloads)) {
    if (!md.includes('`' + name + '`')) missing.push(`payload ${name}`);
    for (const { path, field } of fieldPaths(p.shape)) {
      if (!md.includes('`' + path[path.length - 1] + '`')) missing.push(`${name}.${pathName(path)}`);
      for (const c of field.read || []) if (!cited(c)) missing.push(`${name}.${pathName(path)}: ${c}`);
    }
    for (const c of p.shape.read || []) if (!cited(c)) missing.push(`${name}: ${c}`);
  }
  for (const r of C.requests) { if (!md.includes(r.url)) missing.push(`request ${r.method} ${r.url}`); if (!cited(r.sent)) missing.push(`request ${r.name}: ${r.sent}`); }
  for (const [name, s] of Object.entries(C.streams)) for (const ev of Object.keys(s.events)) if (!md.includes('`' + ev + '`')) missing.push(`stream ${name} event ${ev}`);
  for (const [g, page] of Object.entries(C.pages)) for (const id of Object.keys(page.elements || {})) if (!md.includes('#' + id)) missing.push(`page ${g} #${id}`);
  for (const m of C.markup.items) if (m.css && !md.includes(m.css)) missing.push(`markup ${m.css}`);
  assert.deepEqual(missing, [], 'CONTRACT.md lacks:\n' + missing.join('\n'));
});

test('a planted rename of `topics` is caught: by the shape, the reader, and the rename check', async () => {
  const p = C.payloads.sidebar_data;
  if (!p.shape.fields.topics) return; // under --plant of this very field, the check has nothing to plant
  const renamed = clone(p.examples);
  renamed[0].sessions = renamed[0].topics; delete renamed[0].topics;
  const errs = validate(p.shape, renamed[0]);
  assert.ok(errs.some((e) => e.includes('.topics: missing')) && errs.some((e) => e.includes('.sessions: not in the contract')), 'the shape catches it: ' + errs.join('; '));
  const r = await sidebarPage({ data: renamed[0] });
  assert.throws(() => CHECKS.sidebar_data(r), /topics are listed under Sessions/, 'the reader check catches it');
  has(r.obs, 'No sessions yet', 'as production showed it');
});

let failed = 0;
for (const [name, f] of tests) {
  try { await f(); } catch (e) { failed++; console.error(`FAIL ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); }
}
if (failed) { console.error(`${failed} of ${tests.length} contract tests failed`); process.exit(1); }
console.log(`${tests.length} contract tests passed`);
