// Review page: resultaat.html?r=<file>[&edit=1]
// Child view shows auto-checked answers + feedback; edit view lets a parent (or Claude, by editing the JSON) grade open questions.
const params = new URLSearchParams(location.search);
const file = params.get('r');
const edit = params.has('edit');
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

let res, test, g;

async function init() {
  res = await (await fetch(`api/results/${encodeURIComponent(file)}`)).json();
  test = await (await fetch(`tests/${res.testId}/test.json`)).json();
  g = gradeTest(test, res.answers);
  document.title = `Resultaat – ${test.title}`;
  $('#title').textContent = edit ? `Nakijken – ${test.title}` : `Resultaat – ${test.title}`;
  render();
}

function effective(q) {
  const m = res.manual?.[q.id];
  const auto = g.per[q.id];
  if (m && m.points !== '' && m.points != null) return +m.points;
  return auto.manual ? null : auto.points;
}

function totals() {
  let p = 0, pending = 0;
  for (const q of allQuestions(test)) { const e = effective(q); if (e == null) pending += g.per[q.id].max; else p += e; }
  return { p: Math.round(p * 10) / 10, pending, max: g.max };
}

function render() {
  const m = $('#main'); m.innerHTML = '';
  const t = totals();
  const head = h('div', { class: 'card center' });
  if (params.has('klaar')) head.append(h('div', { style: 'font-size:54px' }, '🎉'), h('h2', {}, `Goed gedaan${res.student ? ', ' + res.student : ''}! Je toets is ingeleverd.`));
  head.append(h('div', { class: 'big' }, `${t.p} / ${t.max} punten`));
  if (t.pending) head.append(h('p', {}, `⏳ ${t.pending} punten (open vragen en tekeningen) worden nog nagekeken.`));
  else head.append(h('p', { class: 'big', style: 'font-size:24px' }, `Cijfer: ${cijfer(t.p, t.max).toFixed(1).replace('.', ',')}`));
  if (res.manual?._comment) head.append(h('div', { class: 'fb', style: 'text-align:left', html: '💬 ' + res.manual._comment }));
  head.append(h('p', { style: 'font-size:14px;color:#777' }, `Ingeleverd: ${res.submitted || ''}`));
  m.append(head);

  let n = 0;
  test.sections.forEach((s, si) => {
    m.append(h('h2', { style: 'margin:18px 0 8px' }, `Deel ${si + 1} – ${s.title}`));
    s.questions.filter(q => q.type !== 'info').forEach(q => { n++; m.append(renderQ(q, n)); });
  });

  if (edit) {
    m.append(h('div', { class: 'card' }, h('b', {}, `Algemene opmerking voor ${res.student || 'de leerling'}`),
      h('textarea', { id: 'overall', rows: 3 }, res.manual?._comment || '')));
    $('#nav').innerHTML = '';
    $('#nav').append(h('button', { class: 'btn go', onclick: saveGrades }, '💾 Opslaan'),
      h('a', { class: 'btn sec', href: `resultaat.html?r=${encodeURIComponent(file)}`, style: 'text-decoration:none' }, 'Bekijk als leerling'));
  } else {
    $('#nav').innerHTML = '';
    $('#nav').append(h('a', { class: 'btn sec', href: 'index.html', style: 'text-decoration:none' }, '🏠 Terug naar het overzicht'));
  }
}

function tag(q) {
  const e = effective(q), max = g.per[q.id].max;
  if (e == null) return h('span', { class: 'tag wait' }, `wordt nagekeken · ${max} p.`);
  return h('span', { class: 'tag ' + (e >= max ? 'ok' : 'no') }, `${e} / ${max}`);
}

function renderQ(q, n) {
  const a = res.answers[q.id];
  const gr = g.per[q.id];
  const card = h('div', { class: 'card q' },
    h('div', { style: 'position:absolute;right:18px;top:14px' }, tag(q)),
    h('div', { class: 'prompt' }, h('span', { class: 'num' }, `${n}.`), h('span', { html: q.prompt })));
  if (q.type === 'point') {
    const [W, H] = q.size;
    const box = h('div', { class: 'pointmap', style: 'cursor:default;max-width:620px' }, h('img', { src: `tests/${res.testId}/${q.image}` }));
    q.items.forEach((it, i) => {
      const g = gr.items[i];
      if (g.point) box.append(h('div', { class: 'pin' + (g.ok ? ' ok' : ''), style: `left:${g.point[0] / W * 100}%;top:${g.point[1] / H * 100}%` }, String(i + 1)));
      const goal = it.dot ? q.dots[it.dot] : it.at;
      if (!g.ok && goal && test.feedback !== 'none') box.append(h('div', { class: 'pin goal', style: `left:${goal[0] / W * 100}%;top:${goal[1] / H * 100}%` }, String(i + 1)));
    });
    card.append(box, h('div', { style: 'font-size:14px;color:#555;margin:4px 0' }, '🟢 goed · 🔴 jouw antwoord (fout) · ⭕ hier had het moeten zijn'));
  }
  if (!gr.manual) {
    gr.items.forEach((it, i) => {
      const label = it.label ?? (q.type === 'fill' || q.type === 'list' ? `${i + 1}` : '');
      card.append(h('div', { class: 'item ' + (it.ok ? 'res-ok' : 'res-no') },
        it.ok ? '✅ ' : '❌ ',
        label ? h('b', { html: label + ': ' }) : null,
        h('span', {}, it.given || '(leeg)'),
        !it.ok && it.expected && test.feedback !== 'none' ? h('span', { class: 'exp' }, `  →  goed is: `, h('b', {}, it.expected)) : null,
        it.note && !it.ok ? h('span', { class: 'note' }, `  (${it.note})`) : null));
    });
    if (!gr.items.length) card.append(h('div', {}, '(geen antwoord)'));
    if (q.explain && test.feedback !== 'none') card.append(h('div', { class: 'model', html: '💡 ' + q.explain }));
  } else {
    if (q.type === 'draw') card.append(a ? h('img', { src: a, style: 'max-width:100%;border:1px solid #ccc;border-radius:8px' }) : h('p', {}, '(geen tekening)'));
    else card.append(h('div', { class: 'item', style: 'background:#f4f6f9;white-space:pre-wrap' }, a || '(leeg)'));
    const showModel = edit || res.manual?.[q.id]?.points != null;
    if (showModel && q.model) card.append(h('div', { class: 'model', html: '📘 Voorbeeldantwoord: ' + q.model }));
    if (edit && q.rubric) card.append(h('div', { class: 'model', html: '✔️ Punten voor: <ul>' + q.rubric.map(r => `<li>${r}</li>`).join('') + '</ul>' }));
  }
  const m = res.manual?.[q.id];
  if (!edit && m?.comment) card.append(h('div', { class: 'fb', html: '💬 ' + m.comment }));
  if (edit) {
    card.append(h('div', { class: 'grade' },
      h('label', {}, gr.manual ? 'Punten: ' : 'Punten aanpassen: ',
        h('input', { type: 'number', min: 0, max: gr.max, step: 0.5, 'data-q': q.id, value: m?.points ?? '', placeholder: gr.manual ? '' : String(gr.points) })),
      h('span', {}, `/ ${gr.max}`),
      h('textarea', { 'data-c': q.id, rows: 2, placeholder: 'Opmerking (optioneel)', style: 'flex:1;min-width:260px' }, m?.comment || '')));
  }
  return card;
}

async function saveGrades() {
  const manual = {};
  document.querySelectorAll('[data-q]').forEach(i => { manual[i.dataset.q] = { ...(manual[i.dataset.q] || {}), points: i.value === '' ? null : +i.value }; });
  document.querySelectorAll('[data-c]').forEach(t => { manual[t.dataset.c] = { ...(manual[t.dataset.c] || {}), comment: t.value.trim() || undefined }; });
  manual._comment = $('#overall').value.trim() || undefined;
  const pendingManual = allQuestions(test).filter(q => g.per[q.id].manual && (manual[q.id]?.points == null)).length;
  manual._done = pendingManual === 0;
  const post = () => fetch(`api/grade/${encodeURIComponent(file)}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Grade-Key': localStorage.getItem('nakijkcode') || '' }, body: JSON.stringify({ manual }) });
  let resp = await post();
  if (resp.status === 403) {
    const code = prompt('Nakijkcode (staat in grade.key op de server):');
    if (!code) return;
    localStorage.setItem('nakijkcode', code.trim());
    resp = await post();
    if (resp.status === 403) { localStorage.removeItem('nakijkcode'); alert('Die code klopt niet.'); return; }
  }
  res.manual = { ...res.manual, ...manual };
  render();
  alert(manual._done ? 'Opgeslagen – alles is nagekeken! ✅' : `Opgeslagen. Nog ${pendingManual} open vraag/vragen zonder punten.`);
}

init();
