// Lesson player: a lesson is lessons/<id>.html with <section class="slide"> blocks, shown one at a time.
// Opened as lessons/<id>.html?t=<testId>; the last slide unlocks that test (localStorage "les-done:<testId>").
//
// Practice widgets inside a slide ("Volgende" stays locked until every widget on the slide is solved):
//   <div class="try" id="x" data-answer="5400|5.400" data-num data-hint="…" data-fb='{"6300000":"…"}'>Vraag ___</div>
//       ___ becomes an input; data-num compares as a number (grade.js), data-fb = feedback for specific wrong answers.
//       Several ___ in one .try: data-answer is split per blank with ";" (each part may hold "|" alternatives).
//   <div class="try pick" id="y" data-answer="1"><button data-fb="…">A</button><button>B</button>…</div>
//       data-answer = index of the right button, counted from 0; a wrong button may carry its own feedback in data-fb.
//   <div class="try tap" id="z" data-words="De taart is lekker." data-answer="2 3" data-fb='{"taart is":"…"}'>Tik het gezegde aan.</div>
//       tap words like the test's "words" question; data-answer = word indices (space-separated, "|" alternatives),
//       data-fb keys = the tapped words in sentence order, lowercase, without punctuation.
//   Custom widgets: give the element class "try" and call Les.solve(el) from the lesson's own script.
// Pad mode (iPad/touch screens, Nintendo Switch browser, or ?pad=1): inputs become read-only and one keypad is docked at the
// bottom of the screen (digits, ",", ⌫, Controleer, plus data-keys="./" extras), so no software keyboard is needed.
// body gets class "pad" (bigger text and buttons, see style.css).
// After 2 wrong tries the hint shows; after 3 the answer is shown and she may continue (logged as "shown").
// Every try is logged and sent to POST /api/progress as testId "les-<lessonId>", so the parent/Claude can see it.
// On open, the saved log is fetched first (GET /api/progress/les-<lessonId>) and new tries are added to it, so reopening a
// lesson no longer wipes the earlier log or its done flag (fixed 2026-11-15).
const Les = (() => {
  const params = new URLSearchParams(location.search);
  const testId = params.get('t') || '';
  const lessonId = location.pathname.split('/').pop().replace(/\.html$/, '');
  // Touch-first devices (iPad, tablets) and the Switch get the on-screen keypad: no software keyboard covering half the screen.
  // iPadOS reports itself as "Macintosh", so also check for multi-touch. ?pad=1 forces it on, ?pad=0 off.
  const TOUCH = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const PAD = params.get('pad') === '0' ? false : /Nintendo/i.test(navigator.userAgent) || params.has('pad') || TOUCH;
  const log = {};
  let slides = [], cur = 0, syncT, finished = false;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // load the earlier log before the first sync, then merge it with whatever was tried meanwhile
  const ready = fetch(`../api/progress/les-${lessonId}`).then(r => (r.ok ? r.json() : {})).then(p => {
    for (const [id, a] of Object.entries(p.answers || {})) {
      const now = log[id];
      log[id] = { tries: [...(a.tries || []), ...(now ? now.tries : [])], ok: !!(a.ok || (now && now.ok)) };
    }
    if (p.done) finished = true;
  }).catch(() => {});
  function sync(extra = {}) {
    clearTimeout(syncT);
    syncT = setTimeout(() => ready.then(() => fetch('../api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testId: 'les-' + lessonId, forTest: testId, answers: log, page: cur, done: finished, ...extra }) })).catch(() => {}), 800);
  }
  function record(id, given, ok) {
    (log[id] ||= { tries: [], ok: false }).tries.push(given);
    if (ok) log[id].ok = true;
    sync();
  }

  function correct(el, given, idx) {
    const parts = String(el.dataset.answer).split(';');
    const acc = (parts[idx] ?? parts[0]).split('|');
    if (el.dataset.num !== undefined) return checkNum(given, acc).ok;
    if (el.dataset.frac !== undefined) return checkFrac(given, acc).ok; // by value: 6/8 = 3/4, 1 2/5 = 7/5
    const n = s => String(s).replace(/[’‘`´]/g, "'").trim().replace(/\s+/g, ' ').toLowerCase(); // iPad types curly quotes
    return acc.some(a => n(a) === n(given));
  }
  function feedback(el, msg, good) {
    let fb = $('.fb', el);
    if (!fb) { fb = document.createElement('div'); fb.className = 'fb'; el.append(fb); }
    fb.className = 'fb ' + (good ? 'good' : 'bad');
    fb.innerHTML = msg;
  }
  function solve(el, shown) {
    el.classList.add(shown ? 'shown' : 'solved');
    $$('input,button', el).forEach(b => { if (!b.classList.contains('keep')) b.disabled = true; });
    if (PAD && slides.length) setActive(firstOpenInput(slides[cur]));
    updateNav();
  }
  const praise = ['Goed zo! ✅', 'Precies! ✅', 'Top! ✅', 'Helemaal goed! ✅', 'Yes! ✅'];
  function wrong(el, given, own) {
    const n = (el._wrong = (el._wrong || 0) + 1);
    let fbMap = {};
    try { fbMap = JSON.parse(el.dataset.fb || '{}'); } catch (e) {}
    const key = Object.keys(fbMap).find(k => (el.dataset.num !== undefined ? checkNum(given, [k]).ok : k.toLowerCase() === String(given).replace(/[’‘`´]/g, "'").trim().toLowerCase()));
    let msg = own || (key ? fbMap[key] : 'Nog niet. Probeer het nog eens!');
    if (n >= 2 && el.dataset.hint) msg += `<br>💡 ${el.dataset.hint}`;
    if (n >= 3) {
      if (el.classList.contains('tap')) {
        const want = tapIdx(String(el.dataset.answer).split('|')[0]);
        $$('.wbtn', el).forEach((b, k) => b.classList.toggle('sel', want.includes(k)));
      }
      const ans = el.classList.contains('pick') ? $$('button', el)[+el.dataset.answer].innerHTML
        : el.classList.contains('tap') ? tapText(el, tapIdx(String(el.dataset.answer).split('|')[0]))
        : String(el.dataset.answer).split(';').map(p => p.split('|')[0]).join(' en ');
      msg += `<br>👉 Het antwoord is <b>${ans}</b>. Kijk goed waarom, en ga dan verder.`;
      feedback(el, msg, false);
      solve(el, true);
      return;
    }
    feedback(el, msg, false);
  }

  // what a button says, readable in the log: a fraction button is "3/8", not "38"
  const label = b => b.innerHTML.replace(/<span class="frac"><span>(\d+)<\/span><span>(\d+)<\/span><\/span>/g, '$1/$2').replace(/<[^>]+>/g, '').trim();
  function setupTry(el) {
    if (el.classList.contains('pick')) {
      $$('button', el).forEach((b, i) => b.addEventListener('click', () => {
        const ok = String(i) === el.dataset.answer;
        record(el.id, label(b), ok);
        b.classList.add(ok ? 'right' : 'wrongpick');
        if (ok) { feedback(el, (el.dataset.ok || praise[Math.floor(Math.random() * praise.length)]), true); solve(el); }
        else wrong(el, label(b), b.dataset.fb);
      }));
      return;
    }
    if (el.classList.contains('tap')) return setupTap(el);
    if (el.dataset.answer === undefined) return; // custom widget
    // turn ___ into inputs
    el.innerHTML = el.innerHTML.replace(/___/g, '<input class="txt small" autocomplete="off" spellcheck="false" autocapitalize="off">');
    const inputs = $$('input', el);
    const btn = document.createElement('button');
    btn.className = 'btn small'; btn.textContent = 'Controleer';
    el.append(btn);
    const check = () => {
      const vals = inputs.map(i => i.value);
      if (vals.some(v => !v.trim())) return feedback(el, 'Vul eerst alles in.', false);
      const ok = vals.every((v, i) => correct(el, v, i));
      record(el.id, vals.join(' ; '), ok);
      inputs.forEach((inp, i) => inp.classList.toggle('bad', !correct(el, inp.value, i)));
      if (ok) { feedback(el, el.dataset.ok || praise[Math.floor(Math.random() * praise.length)], true); solve(el); }
      else wrong(el, vals.length === 1 ? vals[0] : vals.find((v, i) => !correct(el, v, i)));
    };
    btn.addEventListener('click', check);
    inputs.forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') check(); }));
    // keypad only for number answers (data-num) or explicit extra keys (fractions "/"); words keep the normal keyboard
    if (PAD && (el.dataset.num !== undefined || el.dataset.keys)) addPad(el, inputs, btn);
  }

  // tap-the-words widget (same look as the test's "words" question)
  const tapWords = el => el.dataset.words.split(' ');
  const tapText = (el, idx) => idx.map(k => tapWords(el)[k].replace(/[.,!?;:]+$/, '')).join(' ');
  const tapIdx = a => a.trim().split(/\s+/).map(Number).sort((x, y) => x - y);
  function setupTap(el) {
    const sel = new Set();
    const row = document.createElement('div'); row.className = 'wordrow';
    tapWords(el).forEach((w, k) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'wbtn'; b.textContent = w;
      b.addEventListener('click', () => { sel.has(k) ? sel.delete(k) : sel.add(k); b.classList.toggle('sel'); });
      row.append(b);
    });
    const btn = document.createElement('button');
    btn.className = 'btn small'; btn.textContent = 'Controleer';
    btn.addEventListener('click', () => {
      if (!sel.size) return feedback(el, 'Tik eerst de woorden aan.', false);
      const idx = [...sel].sort((a, b) => a - b);
      const ok = String(el.dataset.answer).split('|').some(a => tapIdx(a).join(' ') === idx.join(' '));
      const given = tapText(el, idx).toLowerCase();
      record(el.id, given, ok);
      if (ok) { feedback(el, el.dataset.ok || praise[Math.floor(Math.random() * praise.length)], true); solve(el); }
      else wrong(el, given);
    });
    el.append(row, btn);
  }

  // On-screen keypad (pad mode): ONE keypad docked at the bottom, like a calculator. Tap a box to select it, then tap keys.
  // Inputs are read-only so no software keyboard opens. Extra keys per question via data-keys (e.g. "." or "/").
  let active = null, dock = null;
  function setActive(inp) {
    active = inp;
    $$('.try input.act').forEach(i => i.classList.remove('act'));
    if (inp) inp.classList.add('act');
    renderDock();
  }
  function renderDock() {
    if (!dock) {
      dock = document.createElement('div');
      dock.className = 'keydock';
      document.body.append(dock);
    }
    const t = active && active.closest('.try');
    if (!t || t.classList.contains('solved') || t.classList.contains('shown')) { dock.classList.remove('on'); document.body.classList.remove('dock-on'); return; }
    const base = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', ','];
    const keys = base.concat((t.dataset.keys || '').split('').filter(k => k && !base.includes(k)), ['⌫']); // data-keys="," only turns the pad on
    dock.innerHTML = '';
    keys.forEach(k => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = k; if (k === '⌫') b.className = 'back';
      b.addEventListener('click', () => {
        if (!active) return;
        active.value = k === '⌫' ? active.value.slice(0, -1) : active.value + k;
        active.classList.remove('bad');
      });
      dock.append(b);
    });
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'ok'; ok.textContent = 'Controleer ✔';
    ok.addEventListener('click', () => { const c = $('.check', t); if (c) c.click(); });
    dock.append(ok);
    dock.classList.add('on'); document.body.classList.add('dock-on');
  }
  function firstOpenInput(slide) {
    const t = $$('.try', slide).find(x => !x.classList.contains('solved') && !x.classList.contains('shown') && $('input[readonly]', x));
    return t ? ($$('input', t).find(i => !i.value) || $('input', t)) : null;
  }
  function addPad(el, inputs, btn) {
    // two box sizes only (short or long answer), so the box doesn't give away the length of the answer
    const parts = String(el.dataset.answer).split(';');
    inputs.forEach((i, k) => { if (Math.max(...(parts[k] ?? parts[0]).split('|').map(a => a.length)) <= 3) i.classList.add('short'); });
    inputs.forEach(i => {
      i.readOnly = true; i.setAttribute('inputmode', 'none');
      i.addEventListener('click', () => setActive(i));
    });
    btn.classList.add('check');
  }
  // A physical keyboard keeps working in pad mode. A browser cannot tell whether one is attached, so the boxes stay
  // read-only (no software keyboard opens) and real key presses go to the selected box, like taps on the keypad.
  if (PAD) document.addEventListener('keydown', e => {
    if (!active || e.ctrlKey || e.metaKey || e.altKey || e.target.matches?.('input:not([readonly]), textarea')) return;
    if (e.key === 'Enter') { if (e.target.tagName !== 'INPUT') $('.check', active.closest('.try'))?.click(); return; } // a focused box has its own Enter handler
    if (e.key === 'Backspace') active.value = active.value.slice(0, -1);
    else if (e.key.length === 1) active.value += e.key;
    else return;
    active.classList.remove('bad');
    e.preventDefault();
  });

  function updateNav() {
    const s = slides[cur];
    const open = $$('.try', s).filter(t => !t.classList.contains('solved') && !t.classList.contains('shown'));
    const next = $('#les-next');
    next.disabled = open.length > 0;
    next.title = open.length ? 'Los eerst de opdracht(en) op deze pagina op' : '';
    $('#les-todo').textContent = open.length ? `Nog ${open.length} opdracht${open.length > 1 ? 'en' : ''} op deze pagina` : '';
  }
  function show(i) {
    cur = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, j) => s.classList.toggle('on', j === cur));
    $('#bar').style.width = `${((cur + 1) / slides.length) * 100}%`;
    $('#les-prev').style.visibility = cur ? 'visible' : 'hidden';
    const last = cur === slides.length - 1;
    $('#les-next').style.display = last ? 'none' : '';
    if (last) finish();
    updateNav();
    if (PAD) setActive(firstOpenInput(slides[cur]));
    slides[cur].dispatchEvent(new Event('show'));
    scrollTo(0, 0);
    sync();
  }
  function finish() {
    if (testId) localStorage.setItem('les-done:' + testId, new Date().toISOString());
    finished = true; // every later sync keeps done:true (a debounced sync used to drop it)
    const go = $('#les-go');
    if (go && !go.dataset.keep) go.href = testId ? `../toets.html?t=${encodeURIComponent(testId)}` : '../index.html';
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (PAD) document.body.classList.add('pad');
    slides = $$('.slide');
    $$('.try').forEach(setupTry);
    $('#les-prev').addEventListener('click', () => show(cur - 1));
    $('#les-next').addEventListener('click', () => show(cur + 1));
    show(0);
  });
  return { solve: el => { solve(el); record(el.id, 'ok', true); }, record, feedback, show };
})();
