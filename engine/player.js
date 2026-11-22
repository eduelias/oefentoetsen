// Test player: renders tests/<id>/test.json section by section, autosaves, submits to the server.
const params = new URLSearchParams(location.search);
const testId = params.get('t');
const base = `tests/${testId}/`;
const $ = s => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  kids.flat().forEach(k => k != null && e.append(k.nodeType ? k : document.createTextNode(k)));
  return e;
};
const src = p => (/^(https?:|data:|\/)/.test(p) ? p : base + p);

let test, answers = {}, page = -1, qnum = 0;
const KEY = () => `oefentoets:${testId}`;
let syncT;
// Autosave locally, and (debounced) send a copy to the server so a parent can see progress before "Inleveren".
const sync = data => fetch('api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ testId, student: test?.student, ...data }) }).catch(() => {});
const save = () => {
  const data = { answers, page, started: state.started };
  localStorage.setItem(KEY(), JSON.stringify(data));
  clearTimeout(syncT);
  syncT = setTimeout(() => sync(data), 1500);
};
const state = { started: null };

async function init() {
  if (!testId) { location.href = 'index.html'; return; }
  test = await (await fetch(base + 'test.json')).json();
  document.title = test.title;
  $('#title').textContent = test.title;
  $('#who').textContent = test.student ? `👋 ${test.student}` : '';
  const saved = JSON.parse(localStorage.getItem(KEY()) || 'null');
  if (saved) { answers = saved.answers || {}; state.started = saved.started; }
  if (saved) sync(saved);
  renderStart(saved);
}

function renderStart(saved) {
  page = -1; progress();
  const nQ = allQuestions(test).length, max = gradeTest(test, {}).max;
  const m = $('#main'); m.innerHTML = '';
  m.append(h('div', { class: 'card center' },
    h('div', { style: 'font-size:54px' }, test.emoji || '📝'),
    h('h2', {}, test.title),
    h('p', { class: 'lead', html: test.intro || '' }),
    h('p', {}, `${test.sections.length} delen · ${nQ} vragen · ${max} punten`),
    test.tips ? h('div', { class: 'hint', style: 'text-align:left', html: test.tips }) : null,
    lessonBlock(),
    h('p', {}, h('button', { class: 'btn go', disabled: lessonOpen() || false, onclick: () => { state.started ||= new Date().toISOString(); go(saved?.page > 0 ? saved.page : 0); } },
      saved ? 'Verder gaan ▶' : 'Start de toets ▶')),
    saved ? h('p', {}, h('button', { class: 'btn sec', onclick: () => { if (confirm('Alles wissen en opnieuw beginnen?')) { localStorage.removeItem(KEY()); location.reload(); } } }, 'Opnieuw beginnen')) : null));
  $('#nav').innerHTML = '';
}

// A test may have "lesson": "lessons/<id>.html". The start button stays locked until that lesson was finished on this device.
const lessonOpen = () => !!test.lesson && !localStorage.getItem('les-done:' + testId);
function lessonBlock() {
  if (!test.lesson) return null;
  const url = `${test.lesson}?t=${encodeURIComponent(testId)}`;
  return lessonOpen()
    ? h('div', { class: 'idea', style: 'text-align:center' }, h('p', { html: '📖 <b>Eerst de les!</b> Daarna gaat de toets open.' }),
        h('a', { class: 'btn', href: url }, 'Naar de les ▶'))
    : h('p', {}, h('a', { href: url }, '📖 Les nog een keer bekijken'));
}

function progress() {
  const n = test.sections.length;
  $('#bar').style.width = page < 0 ? '0%' : `${((page + 1) / n) * 100}%`;
}

function go(p) {
  page = p; save(); progress();
  const s = test.sections[p];
  const m = $('#main'); m.innerHTML = '';
  m.append(h('div', { class: 'card' }, h('h2', {}, `Deel ${p + 1} – ${s.title}`), s.intro ? h('p', { class: 'lead', html: s.intro }) : null));
  qnum = test.sections.slice(0, p).reduce((a, x) => a + x.questions.filter(q => q.type !== 'info').length, 0);
  s.questions.forEach(q => m.append(renderQ(q)));
  const last = p === test.sections.length - 1;
  $('#nav').innerHTML = '';
  $('#nav').append(
    h('button', { class: 'btn sec', onclick: () => (p === 0 ? renderStart(true) : go(p - 1)) }, '◀ Vorige'),
    last ? h('button', { class: 'btn go', onclick: submit }, 'Inleveren ✔') : h('button', { class: 'btn', onclick: () => go(p + 1) }, 'Volgende ▶'));
  scrollTo(0, 0);
}

function set(id, v) { answers[id] = v; save(); }

function renderQ(q) {
  if (q.type === 'info') return h('div', { class: 'card' }, h('div', { html: q.html || '' }), q.image ? h('img', { class: 'fig', src: src(q.image) }) : null);
  qnum++;
  const max = maxPoints(q);
  const card = h('div', { class: 'card q' },
    h('span', { class: 'pts' }, `${max} ${max === 1 ? 'punt' : 'punten'}`),
    h('div', { class: 'prompt' }, h('span', { class: 'num' }, `${qnum}.`), h('span', { html: q.prompt })));
  if (q.image && q.type !== 'map' && q.type !== 'draw') card.append(h('img', { class: 'fig', src: src(q.image), style: q.imageWidth ? `width:${q.imageWidth}px` : '' }));
  if (q.hint) card.append(h('div', { class: 'hint', html: q.hint }));
  card.append((R[q.type] || (() => h('p', {}, `Onbekend vraagtype: ${q.type}`)))(q));
  return card;
}

const R = {
  mc(q) {
    const wrap = h('div', { class: 'opts' + (q.optionImages ? ' grid' : '') });
    q.options.forEach((o, i) => {
      const lab = h('label', { class: 'opt' + (answers[q.id] === i ? ' sel' : '') },
        h('input', { type: 'radio', name: q.id, checked: answers[q.id] === i ? '' : false, onchange: () => { set(q.id, i); wrap.querySelectorAll('.opt').forEach((x, j) => x.classList.toggle('sel', j === i)); } }),
        q.optionImages ? h('div', {}, h('img', { src: src(q.optionImages[i]) }), h('div', { html: o })) : h('span', { html: o }));
      wrap.append(lab);
    });
    return wrap;
  },
  tf(q) {
    const a = answers[q.id] || {};
    const t = h('table', { class: 'tf' });
    q.statements.forEach((s, i) => {
      const bw = h('button', { class: 'tfbtn' + (a[i] === true ? ' sel' : '') }, 'waar');
      const bn = h('button', { class: 'tfbtn' + (a[i] === false ? ' sel' : '') }, 'niet waar');
      const pick = v => { a[i] = v; set(q.id, a); bw.classList.toggle('sel', v); bn.classList.toggle('sel', !v); };
      bw.onclick = () => pick(true); bn.onclick = () => pick(false);
      t.append(h('tr', {}, h('td', { html: `${String.fromCharCode(97 + i)}. ${s.text}` }), h('td', { class: 'c' }, bw, bn)));
    });
    return t;
  },
  fill(q) {
    const a = answers[q.id] || [];
    const out = h('div');
    if (q.wordbank) out.append(h('div', { class: 'wordbank' }, q.wordbank.map(w => h('span', {}, w))));
    (q.lines || [q.text]).forEach((line, li) => {
      const p = h('div', { class: 'fill' });
      const parts = line.split('___');
      parts.forEach((part, j) => {
        p.append(h('span', { html: part }));
        if (j < parts.length - 1) {
          const idx = (q.lines || [q.text]).slice(0, li).reduce((n, l) => n + l.split('___').length - 1, 0) + j;
          const isNum = q.blanks?.[idx] && (q.blanks[idx].num ?? q.num);
          p.append(h('input', { class: 'txt', value: a[idx] || '', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
            inputmode: isNum ? 'decimal' : null,  // iPad: number keyboard (with comma) for number answers
            oninput: e => { a[idx] = e.target.value; set(q.id, a); } }));
        }
      });
      out.append(p);
    });
    return out;
  },
  match(q) {
    const a = answers[q.id] || [];
    const out = h('div');
    const letters = q.optionStyle === 'letters';
    if (letters) out.append(h('ul', { class: 'letters' }, q.options.map((o, i) => h('li', {}, h('b', {}, String.fromCharCode(65 + i)), h('span', { html: o })))));
    q.items.forEach((it, i) => {
      const sel = h('select', { class: 'txt', onchange: e => { a[i] = e.target.value || null; set(q.id, a); } },
        h('option', { value: '' }, letters ? '–' : 'kies…'),
        q.options.map((o, j) => h('option', { value: o, selected: a[i] === o ? '' : false }, letters ? String.fromCharCode(65 + j) : o)));
      out.append(h('div', { class: 'matchrow' }, h('span', { class: 'l', html: it.left }), sel));
    });
    return out;
  },
  list(q) {
    const a = answers[q.id] || [];
    return h('div', {}, Array.from({ length: q.count }, (_, i) =>
      h('div', { class: 'maprow' }, h('span', { class: 'lab' }, `${i + 1}.`),
        h('input', { class: 'txt', value: a[i] || '', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', oninput: e => { a[i] = e.target.value; set(q.id, a); } }))));
  },
  map(q) {
    const a = answers[q.id] || {};
    const groups = q.groups || [{ title: '', labels: q.items.map(i => i.label) }];
    const byLabel = Object.fromEntries(q.items.map(i => [i.label, i]));
    return h('div', { class: 'mapwrap' },
      h('img', { src: src(q.image) }),
      h('div', { class: 'mapgroups' }, groups.map(g => h('div', {}, g.title ? h('h4', {}, g.title) : null,
        g.labels.map(l => h('div', { class: 'maprow' }, h('span', { class: 'lab' }, l + (byLabel[l]?.plus ? ' +' : '')),
          h('input', { class: 'txt', value: a[l] || '', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', oninput: e => { a[l] = e.target.value; set(q.id, a); } })))))));
  },
  words(q) {
    // tap words to select them (like underlining); tap again to deselect
    const a = answers[q.id] || {};
    return h('div', {}, q.items.map((it, i) => {
      const sel = new Set(a[i] || []);
      const row = h('div', { class: 'wordrow' }, h('span', { class: 'wnr' }, `${String.fromCharCode(97 + i)}.`));
      it.text.split(' ').forEach((w, k) => {
        const b = h('button', { type: 'button', class: 'wbtn' + (sel.has(k) ? ' sel' : '') }, w);
        b.onclick = () => { sel.has(k) ? sel.delete(k) : sel.add(k); b.classList.toggle('sel'); a[i] = [...sel]; set(q.id, a); };
        row.append(b);
      });
      return row;
    }));
  },
  point(q) {
    const a = answers[q.id] || {};
    const [W, H] = q.size;
    let active = q.items.find(it => !a[it.name])?.name || q.items[0].name;
    const box = h('div', { class: 'pointmap' }, h('img', { src: src(q.image), draggable: 'false' }));
    const list = h('div', { class: 'pointlist' });
    const draw = () => {
      box.querySelectorAll('.pin').forEach(p => p.remove());
      q.items.forEach((it, i) => {
        const p = a[it.name]; if (!p) return;
        box.append(h('div', { class: 'pin' + (it.name === active ? ' act' : ''), style: `left:${(p[0] / W) * 100}%;top:${(p[1] / H) * 100}%` }, String(i + 1)));
      });
      list.innerHTML = '';
      q.items.forEach((it, i) => list.append(h('button', { class: 'pbtn' + (it.name === active ? ' act' : '') + (a[it.name] ? ' done' : ''),
        onclick: () => { active = it.name; draw(); } }, h('b', {}, `${i + 1}`), ' ', it.name, a[it.name] ? ' ✓' : '')));
      const cur = q.items.findIndex(it => it.name === active);
      hint.innerHTML = `👉 Tik op de kaart: waar ligt <b>${active}</b>? <span style="color:#666">(nummer ${cur + 1})</span>`;
    };
    const hint = h('div', { class: 'hint' });
    box.addEventListener('click', e => {
      const r = box.querySelector('img').getBoundingClientRect();
      a[active] = [Math.round((e.clientX - r.left) * W / r.width), Math.round((e.clientY - r.top) * H / r.height)];
      set(q.id, a);
      active = q.items.find(it => !a[it.name])?.name || active;
      draw();
    });
    draw();
    return h('div', {}, hint, h('div', { class: 'pointwrap' }, box, list));
  },
  open(q) {
    return h('textarea', { rows: q.rows || 4, spellcheck: 'false', placeholder: q.placeholder || 'Typ hier je antwoord…', oninput: e => set(q.id, e.target.value) }, answers[q.id] || '');
  },
  draw(q) {
    const W = q.width || 640, H = q.height || 340;
    const c = h('canvas', { width: W, height: H });
    const ctx = c.getContext('2d');
    let color = '#000', size = 4, erasing = false, drawing = false, last;
    const bg = q.background ? Object.assign(new Image(), { src: src(q.background) }) : null;
    const paint = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); if (bg?.complete) ctx.drawImage(bg, 0, 0, W, H); };
    const restore = () => { paint(); if (answers[q.id]) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0); im.src = answers[q.id]; } };
    if (bg) bg.onload = restore; restore();
    const pos = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
    c.onpointerdown = e => { drawing = true; last = pos(e); c.setPointerCapture(e.pointerId); };
    c.onpointermove = e => {
      if (!drawing) return; const p = pos(e);
      ctx.strokeStyle = erasing ? '#fff' : color; ctx.lineWidth = erasing ? 22 : size; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p;
    };
    c.onpointerup = () => { if (drawing) { drawing = false; set(q.id, c.toDataURL('image/png')); } };
    const tools = h('div', { class: 'tools' });
    const colors = q.colors || [['zwart', '#000'], ['grijs', '#888'], ['blauw', '#1e63c6'], ['geel', '#f4c20d'], ['rood', '#d32f2f'], ['groen', '#2e7d32']];
    const btns = [];
    colors.forEach(([n, col]) => { const b = h('button', { onclick: () => { color = col; erasing = false; sel(b); } }, h('span', { class: 'sw', style: `background:${col}` }), ' ', n); btns.push(b); tools.append(b); });
    const er = h('button', { onclick: () => { erasing = true; sel(er); } }, '🧽 gum'); btns.push(er); tools.append(er);
    tools.append(h('button', { onclick: () => { size = size === 4 ? 10 : 4; } }, '✏️ dun/dik'));
    tools.append(h('button', { onclick: () => { if (confirm('Tekening wissen?')) { paint(); set(q.id, null); } } }, '🗑️ alles wissen'));
    const sel = b => btns.forEach(x => x.classList.toggle('sel', x === b));
    sel(btns[0]);
    return h('div', { class: 'draw' }, tools, c);
  },
};

async function submit() {
  const g = gradeTest(test, answers);
  const empty = allQuestions(test).filter(q => {
    const a = answers[q.id];
    return a == null || a === '' || (Array.isArray(a) && !a.some(Boolean)) || (typeof a === 'object' && !Array.isArray(a) && !Object.values(a).some(v => v !== '' && v != null));
  }).length;
  if (!confirm(empty ? `Je hebt nog ${empty} vraag/vragen niet (helemaal) ingevuld. Toch inleveren?` : 'Weet je zeker dat je wilt inleveren?')) return;
  const result = {
    testId, title: test.title, student: test.student, started: state.started, finished: new Date().toISOString(),
    answers, auto: g.auto, max: g.max, manualMax: g.manualMax,
    perQuestion: Object.fromEntries(Object.entries(g.per).map(([k, v]) => [k, { points: v.points, max: v.max, manual: v.manual }])),
    manual: {},
  };
  clearTimeout(syncT); // otherwise a pending autosave re-creates results/progress/<id>.json after submitting
  try {
    const r = await (await fetch('api/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) })).json();
    localStorage.removeItem(KEY());
    location.href = `resultaat.html?r=${encodeURIComponent(r.file)}&klaar=1`;
  } catch (e) {
    alert('Opslaan lukte niet. Draait de server (start.command)? Je antwoorden zijn bewaard, probeer het zo nog eens.');
  }
}

init();
