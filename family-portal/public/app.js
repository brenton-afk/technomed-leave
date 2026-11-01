// Family Calendar — the phone screen.
// Everything shown comes from /api/events, which reads each person's calendar.
// Text from calendars is always inserted as text, never as HTML.

const $ = (id) => document.getElementById(id);
const DAY = 86400000;
const REFRESH_MS = 5 * 60 * 1000;

const state = {
  data: null,
  tz: 'Australia/Hobart',
  view: localGet('fc_view') || 'list',
  hidden: new Set(JSON.parse(localGet('fc_hidden') || '[]')),
  month: null, // 'YYYY-MM'
  selected: null, // 'YYYY-MM-DD'
  listDays: 60,
  loading: false,
};

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- dates, always in the family's home timezone ---------------------------

const fmtCache = new Map();
function fmt(opts) {
  const key = JSON.stringify(opts) + state.tz;
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat('en-AU', { timeZone: state.tz, ...opts }));
  return fmtCache.get(key);
}
const homeDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: state.tz }).format(new Date(ms));
const today = () => homeDate(Date.now());
// Civil-date arithmetic on YYYY-MM-DD strings, done in UTC so nothing shifts.
const toUtc = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => fromUtc(toUtc(d) + n * DAY);
const civil = (d, opts) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', ...opts }).format(new Date(toUtc(d)));
const timeStr = (iso) => fmt({ hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(' ', '').toLowerCase();

// Which home-calendar days an event covers.
function daysOf(ev) {
  let first, last;
  if (ev.allDay) { first = ev.start; last = addDays(ev.end, -1); }
  else { first = homeDate(Date.parse(ev.start)); last = homeDate(Math.max(Date.parse(ev.start), Date.parse(ev.end) - 1)); }
  if (last < first) last = first;
  const out = [];
  for (let d = first; d <= last && out.length < 62; d = addDays(d, 1)) out.push(d);
  return out;
}

function dayLabel(d) {
  const t = today();
  const rel = d === t ? 'Today' : d === addDays(t, 1) ? 'Tomorrow' : d === addDays(t, -1) ? 'Yesterday' : '';
  const main = civil(d, { weekday: 'long', day: 'numeric', month: 'long' });
  return rel ? `<span class="rel">${rel}</span> · ${esc(main)}` : esc(main);
}

// ---- data ------------------------------------------------------------------

function visible(ev) {
  return ev.people.some((p) => !state.hidden.has(p.name));
}

function byDay() {
  const map = new Map();
  for (const ev of state.data.events) {
    if (!visible(ev)) continue;
    for (const d of daysOf(ev)) {
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(ev);
    }
  }
  return map;
}

async function load(force = false) {
  if (state.loading) return;
  state.loading = true;
  $('refresh').classList.add('spin');
  try {
    const res = await fetch(`/api/events${force ? '?refresh=1' : ''}`, { credentials: 'same-origin' });
    if (res.status === 401) return showLogin();
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'The calendar could not be loaded.');
    state.data = body;
    state.tz = body.timezone || state.tz;
    localSet('fc_cache', JSON.stringify(body));
    render();
  } catch (err) {
    const cached = !state.data && localGet('fc_cache');
    if (cached) { state.data = JSON.parse(cached); state.offline = true; render(); }
    $('updated').textContent = navigator.onLine === false
      ? 'Offline — showing the last saved copy'
      : (err.message || 'The calendar could not be loaded.');
  } finally {
    state.loading = false;
    $('refresh').classList.remove('spin');
  }
}

// ---- rendering -------------------------------------------------------------

function render() {
  const d = state.data;
  if (!d) return;
  const name = localGet('fc_name');
  $('greeting').textContent = name ? `Hi ${name}` : 'Family Calendar';
  const at = timeStr(d.fetchedAt);
  $('updated').textContent = `${civil(today(), { weekday: 'long', day: 'numeric', month: 'long' })} · updated ${at}`;

  // One chip per person.
  const people = [];
  for (const s of d.sources) if (!people.some((p) => p.name === s.person)) people.push({ name: s.person, color: s.color });
  $('chips').innerHTML = people.map((p) => `
    <button class="chip ${state.hidden.has(p.name) ? 'off' : ''}" data-person="${esc(p.name)}" aria-pressed="${!state.hidden.has(p.name)}">
      <span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}
    </button>`).join('');

  // Say plainly when a calendar could not be read, rather than just showing less.
  const failed = d.sources.filter((s) => !s.ok);
  $('banners').innerHTML = failed.map((s) =>
    `<div class="banner">${esc(s.person)}’s ${s.label ? esc(s.label) + ' ' : ''}calendar couldn’t be read just now (${esc(s.error)}). Their events may be missing.</div>`).join('');

  $('tab-list').setAttribute('aria-selected', state.view === 'list');
  $('tab-month').setAttribute('aria-selected', state.view === 'month');
  if (state.view === 'month') renderMonth(); else renderList();
}

function eventRow(ev, day) {
  let time;
  if (ev.allDay) time = 'All day';
  else {
    const sDay = homeDate(Date.parse(ev.start));
    const eDay = homeDate(Date.parse(ev.end) - 1);
    if (sDay === day && eDay === day) time = `${timeStr(ev.start)}<small>${timeStr(ev.end)}</small>`;
    else if (sDay === day) time = `${timeStr(ev.start)}<small>onwards</small>`;
    else if (eDay === day) time = `until<small>${timeStr(ev.end)}</small>`;
    else time = 'All day';
  }
  const who = ev.people.map((p) => p.name).join(' & ');
  const meta = [who, ev.location].filter(Boolean).map(esc).join(' · ');
  return `<button class="ev" data-id="${esc(ev.id)}">
    <span class="bars">${ev.people.map((p) => `<span style="background:${esc(p.color)}"></span>`).join('')}</span>
    <span class="time">${time}</span>
    <span class="body"><span class="title">${esc(ev.title)}</span><span class="meta" style="display:block">${meta}</span></span>
  </button>`;
}

function renderList() {
  const map = byDay();
  const start = today();
  let html = '';
  let shown = 0;
  for (let i = 0; i < state.listDays; i++) {
    const d = addDays(start, i);
    const evs = map.get(d);
    if (!evs) continue;
    shown++;
    html += `<section class="day"><h2>${dayLabel(d)}</h2>${evs.map((e) => eventRow(e, d)).join('')}</section>`;
  }
  if (!shown) html = `<div class="empty">Nothing on in the next ${state.listDays} days.</div>`;
  if (state.listDays < 365) html += `<button class="more" id="more">Show further ahead</button>`;
  $('view').innerHTML = html;
}

function renderMonth() {
  const t = today();
  if (!state.month) state.month = t.slice(0, 7);
  if (!state.selected) state.selected = t;
  const first = `${state.month}-01`;
  const dow = (new Date(toUtc(first)).getUTCDay() + 6) % 7; // Monday = 0
  const gridStart = addDays(first, -dow);
  const map = byDay();

  let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => `<div class="wd">${w}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    if (i === 35 && d.slice(0, 7) !== state.month) break; // drop an empty sixth row
    const evs = map.get(d) || [];
    const colours = [];
    for (const e of evs) for (const p of e.people) if (!state.hidden.has(p.name) && colours.length < 6) colours.push(p.color);
    const cls = ['cell', d.slice(0, 7) !== state.month && 'out', d === t && 'today', d === state.selected && 'sel'].filter(Boolean).join(' ');
    cells += `<button class="${cls}" data-day="${d}" aria-label="${esc(civil(d, { weekday: 'long', day: 'numeric', month: 'long' }))}, ${evs.length} events">
      <span class="n">${+d.slice(8)}</span><span class="dots">${colours.map((c) => `<span style="background:${esc(c)}"></span>`).join('')}</span></button>`;
  }
  const sel = state.selected;
  const selEvs = map.get(sel) || [];
  $('view').innerHTML = `
    <div class="mhead">
      <button class="icon-btn" id="prev" aria-label="Previous month">‹</button>
      <h2>${esc(civil(first, { month: 'long', year: 'numeric' }))}</h2>
      <button class="icon-btn" id="next" aria-label="Next month">›</button>
    </div>
    <div class="grid">${cells}</div>
    <section class="day"><h2>${dayLabel(sel)}</h2>
      ${selEvs.length ? selEvs.map((e) => eventRow(e, sel)).join('') : '<div class="empty">Nothing on.</div>'}
    </section>`;
}

function openEvent(id) {
  const ev = state.data.events.find((e) => e.id === id);
  if (!ev) return;
  let when;
  if (ev.allDay) {
    const last = addDays(ev.end, -1);
    when = last === ev.start
      ? `${civil(ev.start, { weekday: 'long', day: 'numeric', month: 'long' })} · all day`
      : `${civil(ev.start, { weekday: 'short', day: 'numeric', month: 'short' })} – ${civil(last, { weekday: 'short', day: 'numeric', month: 'short' })}`;
  } else {
    const s = Date.parse(ev.start); const e = Date.parse(ev.end);
    const dayFmt = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
    when = homeDate(s) === homeDate(e - 1) || e === s
      ? `${dayFmt.format(new Date(s))} · ${timeStr(ev.start)}${e > s ? ` – ${timeStr(ev.end)}` : ''}`
      : `${dayFmt.format(new Date(s))} ${timeStr(ev.start)} – ${dayFmt.format(new Date(e))} ${timeStr(ev.end)}`;
  }
  const maps = ev.location ? `https://maps.apple.com/?q=${encodeURIComponent(ev.location)}` : '';
  const links = (s) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  $('sheet').innerHTML = `<div class="sheet">
    <h3>${esc(ev.title)}</h3>
    <div>${esc(when)}</div>
    <div class="row"><div class="label">Calendar</div>
      ${ev.people.map((p) => `<span class="who"><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}${p.label ? ` (${esc(p.label)})` : ''}</span>`).join('')}</div>
    ${ev.location ? `<div class="row"><div class="label">Where</div><a href="${maps}" target="_blank" rel="noopener noreferrer">${esc(ev.location)}</a></div>` : ''}
    ${ev.notes ? `<div class="row"><div class="label">Notes</div><div class="notes">${links(ev.notes)}</div></div>` : ''}
    <button class="close" id="close-sheet">Close</button>
  </div>`;
  $('sheet').classList.remove('hidden');
}

// ---- sign in / out ---------------------------------------------------------

function showLogin() {
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('name').value = localGet('fc_name') || '';
}

function showApp() {
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  $('login-btn').disabled = true;
  $('login-btn').textContent = 'Signing in…';
  try {
    const name = $('name').value.trim();
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, passcode: $('passcode').value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Couldn’t sign in — please try again.');
    localSet('fc_name', name);
    $('passcode').value = '';
    showApp();
    load();
  } catch (err) {
    $('login-error').textContent = err.message;
  } finally {
    $('login-btn').disabled = false;
    $('login-btn').textContent = 'Sign in';
  }
});

$('signout').addEventListener('click', async () => {
  await fetch('/api/login', { method: 'DELETE' }).catch(() => {});
  try { localStorage.removeItem('fc_cache'); } catch { /* ignore */ }
  state.data = null;
  showLogin();
});

// ---- interaction -----------------------------------------------------------

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, .sheet-bg');
  if (!t) return;
  if (t.id === 'sheet' && e.target === t) return $('sheet').classList.add('hidden');
  if (t.id === 'close-sheet') return $('sheet').classList.add('hidden');
  if (t.id === 'refresh') return load(true);
  if (t.id === 'tab-list' || t.id === 'tab-month') {
    state.view = t.id === 'tab-list' ? 'list' : 'month';
    localSet('fc_view', state.view);
    return render();
  }
  if (t.id === 'more') { state.listDays = Math.min(365, state.listDays + 60); return render(); }
  if (t.id === 'prev' || t.id === 'next') {
    const [y, m] = state.month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + (t.id === 'next' ? 1 : -1), 1));
    state.month = d.toISOString().slice(0, 7);
    state.selected = state.month === today().slice(0, 7) ? today() : `${state.month}-01`;
    return render();
  }
  if (t.dataset.person) {
    const p = t.dataset.person;
    if (state.hidden.has(p)) state.hidden.delete(p); else state.hidden.add(p);
    localSet('fc_hidden', JSON.stringify([...state.hidden]));
    return render();
  }
  if (t.dataset.day) { state.selected = t.dataset.day; return render(); }
  if (t.dataset.id) return openEvent(t.dataset.id);
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('sheet').classList.add('hidden'); });

// Keep it current: every few minutes while open, and straight away when the
// phone comes back to the app.
setInterval(() => { if (document.visibilityState === 'visible' && state.data) load(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.data) load(); });

// Start: try the calendar; a 401 sends us to sign in.
showApp();
load();
