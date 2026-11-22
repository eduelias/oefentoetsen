#!/usr/bin/env node
// What happened in one attempt: score per goal, every wrong item with what was typed, and what still needs marking.
//   node tools/report.js            newest file in results/
//   node tools/report.js <file>     a file name in results/, or a path
const fs = require('fs'), path = require('path');
const g = require('../engine/grade.js');
const ROOT = path.join(__dirname, '..'), RES = path.join(ROOT, 'results');

let file = process.argv[2];
if (!file) file = fs.existsSync(RES) && fs.readdirSync(RES).filter(f => f.endsWith('.json')).sort().pop();
if (!file) { console.error('Geen resultaten in results/.'); process.exit(1); }
const r = JSON.parse(fs.readFileSync(fs.existsSync(file) ? file : path.join(RES, file), 'utf8'));
const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', r.testId, 'test.json'), 'utf8'));
const per = g.gradeTest(t, r.answers || {}).per, manual = r.manual || {};
const plain = s => String(s ?? '').replace(/<span class="frac"><span>(\d+)<\/span><span>(\d+)<\/span><\/span>/g, '$1/$2').replace(/<[^>]+>/g, ' ').trim();
const pts = (q, v) => manual[q.id]?.points ?? v.points; // manual points override auto points, as on the result page

let total = 0, max = 0, waiting = 0;
const goals = {}, wrong = [], open = [];
for (const s of t.sections) for (const q of s.questions) {
  const v = per[q.id]; if (!v) continue;
  const p = pts(q, v), goal = s.goal || s.title;
  goals[goal] ||= { p: 0, max: 0 };
  goals[goal].max += v.max; max += v.max;
  if (p == null) { waiting += v.max; open.push(q); continue; }
  goals[goal].p += p; total += p;
  if (v.manual) { open.push(q); continue; }
  v.items.forEach((it, i) => it.ok || wrong.push(`${q.id}[${i}] ${it.label ? plain(it.label) + ': ' : ''}"${plain(it.given)}"${it.expected != null ? ` → ${plain(it.expected)}` : ''}${it.note ? ` (${it.note})` : ''}`));
}
console.log(`${r.title || r.testId}${r.student ? ' · ' + r.student : ''} · ${r.submitted || 'niet ingeleverd'}`);
console.log(`Totaal ${total}/${max}${waiting ? ` (${waiting} punten wachten op nakijken)` : ` = cijfer ${g.cijfer(total, max)}`}`);
console.log('\nPer doel:');
for (const [k, v] of Object.entries(goals)) console.log(`  ${k}: ${v.p}/${v.max}`);
console.log(`\nFout (${wrong.length}):`);
wrong.forEach(w => console.log('  ' + w));
console.log(`\nOpen vragen (${open.length}):`);
for (const q of open) {
  const a = r.answers?.[q.id], m = manual[q.id];
  console.log(`  ${q.id} (${q.points ?? 1} p) ${m?.points != null ? `nagekeken: ${m.points}` : 'NOG NAKIJKEN'}`);
  console.log(`    vraag:   ${plain(q.prompt)}`);
  console.log(`    antwoord: ${q.type === 'draw' ? (a ? '[tekening, data-URL]' : '') : (a ?? '')}`);
  console.log(`    model:   ${q.model ?? ''}`);
  (q.rubric || []).forEach(x => console.log(`    rubric:  ${x}`));
}
// the lesson log shows what the child believed before the lesson corrected it
const lf = t.lesson && path.join(RES, 'progress', `les-${path.basename(t.lesson, '.html')}.json`);
if (lf && fs.existsSync(lf)) {
  const l = JSON.parse(fs.readFileSync(lf, 'utf8'));
  const hard = Object.entries(l.answers || {}).filter(([, a]) => (a.tries || []).length > 1 || !a.ok);
  console.log(`\nLes ${l.done ? 'af' : 'niet af'} (laatst ${l.updated || '?'}); niet in één keer goed (${hard.length}):`);
  hard.forEach(([id, a]) => console.log(`  ${id}: ${(a.tries || []).join(' → ')}${a.ok ? '' : ' (niet opgelost)'}`));
}
