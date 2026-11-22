#!/usr/bin/env node
// Checks tests and their lessons before a child sees them.
//   node tools/check.js            all tests
//   node tools/check.js <testId>   one or more tests
// Errors (exit 1): broken structure, or a perfect answer sheet that does not score full marks.
// Warnings: things that were real answer-key bugs before; read each one.
const fs = require('fs'), path = require('path');
const g = require('../engine/grade.js');
const ROOT = path.join(__dirname, '..');
const first = a => [].concat(a)[0];

// The sheet a pupil with every answer right would hand in, built from the keys.
function perfect(q) {
  switch (q.type) {
    case 'mc': return q.answer;
    case 'tf': return q.statements.map(s => s.answer);
    case 'fill': return q.blanks.map(b => first(b.answer));
    case 'match': return q.items.map(it => it.answer);
    case 'map': return Object.fromEntries(q.items.map(it => [it.label, first(it.answer)]));
    case 'list': return q.accepted.slice(0, q.count).map(first);
    case 'words': return q.items.map(it => it.answer);
    case 'point': return Object.fromEntries(q.items.map(it => [it.name, it.dot ? q.dots?.[it.dot] : it.at]));
  }
}

function checkTest(id) {
  const dir = path.join(ROOT, 'tests', id), err = [], warn = [];
  let t;
  try { t = JSON.parse(fs.readFileSync(path.join(dir, 'test.json'), 'utf8')); } catch (e) { return { err: [`test.json: ${e.message}`], warn }; }
  const file = (p, where) => { if (p && !/^(https?:|data:|\/)/.test(p) && !fs.existsSync(path.join(dir, p))) err.push(`${where}: bestand ${p} ontbreekt`); };
  const ids = new Set(), sheet = {};
  for (const s of t.sections || []) for (const q of s.questions || []) {
    const w = `${q.id} (${q.type})`;
    if (!q.id || ids.has(q.id)) err.push(`${w}: id ontbreekt of is dubbel`);
    ids.add(q.id);
    [q.image, q.background, ...(q.optionImages || [])].forEach(p => file(p, w));
    if (q.type === 'info') continue;
    if (q.type === 'open' || q.type === 'draw') { if (q.points == null || !q.model || !q.rubric) warn.push(`${w}: points, model en rubric horen erbij (nakijken)`); continue; }
    if (q.type === 'mc' && !(q.answer >= 0 && q.answer < q.options.length)) err.push(`${w}: answer is geen index van options`);
    if (q.type === 'match') q.items.forEach(it => q.options.includes(it.answer) || err.push(`${w}: "${it.answer}" staat niet in options`));
    if (q.type === 'list' && q.accepted.length < q.count) err.push(`${w}: minder goede antwoorden dan count`);
    if (q.type === 'words') q.items.forEach(it => it.answer.every(k => k >= 0 && k < it.text.split(' ').length) || err.push(`${w}: woordindex buiten de zin "${it.text}"`));
    if (q.type === 'point') q.items.forEach(it => (it.dot ? q.dots?.[it.dot] : it.at && it.codes && q.grid) || err.push(`${w}: "${it.name}" heeft geen dot of codes+at+grid`));
    if (q.type === 'fill') {
      const lines = q.lines || [q.text], n = lines.join('').split('___').length - 1;
      if (n !== q.blanks.length) err.push(`${w}: ${n} hokjes maar ${q.blanks.length} blanks`);
      let i = 0;
      for (const line of lines) for (const m of line.matchAll(/___(\s+(jij|je)\b)?/g)) {
        const b = q.blanks[i++]; if (!b) break;
        const a = String(first(b.answer));
        // "Elke dag ___ jij" was once keyed "komt"; after the persoonsvorm jij/je drops the t (kom jij), unless the stem ends in t (eet jij)
        if (m[1] && /t$/.test(a)) warn.push(`${w}: "${line}" → "${a}": jij/je ná de persoonsvorm, klopt die t?`);
        if (/^[\d.,\s]+$/.test(a) && !(b.num ?? q.num) && !(b.frac ?? q.frac) && (b.near ?? q.near) !== false) warn.push(`${w}: "${a}" is een getal zonder num:true`);
      }
    }
    sheet[q.id] = perfect(q);
  }
  if (t.lesson) err.push(...checkLesson(t.lesson));
  if (!err.length) {
    const full = g.gradeTest(t, sheet).auto, none = g.gradeTest(t, {}).auto;
    if (full.points !== full.max) {
      const per = g.gradeTest(t, sheet).per;
      Object.entries(per).filter(([, v]) => !v.manual && v.points !== v.max).forEach(([k, v]) => err.push(`${k}: perfect blad scoort ${v.points}/${v.max} (sleutel klopt niet met zichzelf)`));
    }
    if (none.points !== 0) err.push(`leeg blad scoort ${none.points} punten`);
    return { err, warn, max: g.gradeTest(t, {}).max, auto: full.max };
  }
  return { err, warn };
}

// Lessons are HTML; a few regex checks catch what breaks the lesson player.
function checkLesson(rel) {
  const p = path.join(ROOT, rel), err = [];
  if (!fs.existsSync(p)) return [`les ${rel} ontbreekt`];
  const html = fs.readFileSync(p, 'utf8'), ids = new Set();
  for (const need of ['id="les-prev"', 'id="les-next"', 'id="les-todo"', 'id="les-go"', 'id="bar"', 'engine/grade.js', 'engine/lesson.js', 'class="slide'])
    if (!html.includes(need)) err.push(`${rel}: ${need} ontbreekt`);
  for (const [tag] of html.matchAll(/<div class="try[^>]*>/g)) {
    const id = tag.match(/ id="([^"]+)"/)?.[1];
    if (!id || ids.has(id)) err.push(`${rel}: opdracht zonder id of met dubbel id: ${tag.slice(0, 60)}`);
    ids.add(id);
    const fb = tag.match(/data-fb='([^']*)'/)?.[1];
    if (fb) try { JSON.parse(fb); } catch (e) { err.push(`${rel}: data-fb van ${id} is geen geldige JSON`); }
  }
  return err;
}

const all = fs.readdirSync(path.join(ROOT, 'tests')).filter(d => fs.existsSync(path.join(ROOT, 'tests', d, 'test.json')));
let bad = 0;
for (const id of process.argv.length > 2 ? process.argv.slice(2) : all) {
  const r = checkTest(id);
  console.log(`${r.err.length ? '✗' : '✓'} ${id}${r.max != null ? `  ${r.auto} auto + ${r.max - r.auto} handmatig = ${r.max} punten` : ''}`);
  r.err.forEach(e => console.log(`    FOUT  ${e}`));
  r.warn.forEach(e => console.log(`    let op  ${e}`));
  if (r.err.length) bad++;
}
process.exit(bad ? 1 : 0);
