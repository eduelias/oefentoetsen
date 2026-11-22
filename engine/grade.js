// Shared grading logic for player and review page.
// Every question gets {max, points, manual, items:[{ok, given, expected, note}]}.

const norm = s => String(s ?? '').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();

function lev(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

// Compare one typed answer with a list of accepted spellings.
// opts.case (default true): capitals must match. opts.near:false = no "bijna goed" spelling hint (maths answers).
function checkText(given, accepted, opts = {}) {
  const caseSensitive = opts.case !== false;
  const g = norm(given);
  const acc = [].concat(accepted).map(norm);
  if (!g) return { ok: false, note: 'niet ingevuld' };
  if (acc.some(a => (caseSensitive ? a === g : a.toLowerCase() === g.toLowerCase()))) return { ok: true };
  if (acc.some(a => a.toLowerCase() === g.toLowerCase())) return { ok: false, note: 'let op de hoofdletter(s)' };
  const best = Math.min(...acc.map(a => lev(a.toLowerCase(), g.toLowerCase())));
  if (opts.near !== false && best <= 2) return { ok: false, note: 'bijna goed – kijk naar de spelling' };
  return { ok: false };
}

// Numbers (blank or question with num:true): 2500 = 2.500 = 2 500, decimal comma, a trailing unit or € is ignored.
// A decimal point ("4.25") is not accepted, but gets a hint, because the school writes a comma.
function parseNum(s) {
  const t = norm(s).replace(/€/g, '').replace(/\s+/g, '').replace(/[a-zA-Z²³]+$/, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return { v: +t.replace(/\./g, '').replace(',', '.') };
  if (/^-?\d+(,\d+)?$/.test(t)) return { v: +t.replace(',', '.') };
  if (/^-?\d+\.\d+$/.test(t)) return { v: NaN, dot: +t };
  return { v: NaN };
}
function checkNum(given, accepted) {
  if (!norm(given)) return { ok: false, note: 'niet ingevuld' };
  const g = parseNum(given), acc = [].concat(accepted).map(a => parseNum(a).v);
  if (acc.some(a => Math.abs(a - g.v) < 1e-9)) return { ok: true };
  if (g.dot != null && acc.some(a => Math.abs(a - g.dot) < 1e-9)) return { ok: false, note: 'goed getal, maar schrijf een komma in plaats van een punt' };
  if (isNaN(g.v) && g.dot == null) return { ok: false, note: 'typ alleen een getal' };
  return { ok: false };
}

// Fractions (blank or question with frac:true, lesson data-frac): compared by VALUE, so 3/4 = 6/8 and
// 10/6 = 5/3 = 1 4/6 = "1 en 4/6" = "1 hele en 2/3"; spaces around "/" are fine. Returns [teller, noemer] or null.
function parseFrac(s) {
  const t = norm(s).toLowerCase().replace(/\s*\/\s*/g, '/').replace(/\b(hele|heel)\b/g, ' ').replace(/\ben\b/g, ' ').replace(/\s+/g, ' ').trim();
  let m;
  if ((m = t.match(/^(\d+)$/))) return [+m[1], 1];
  if ((m = t.match(/^(\d+)\/(\d+)$/)) && +m[2] > 0) return [+m[1], +m[2]];
  if ((m = t.match(/^(\d+) (\d+)\/(\d+)$/)) && +m[3] > 0) return [+m[1] * +m[3] + +m[2], +m[3]];
  return null;
}
function checkFrac(given, accepted) {
  if (!norm(given)) return { ok: false, note: 'niet ingevuld' };
  const g = parseFrac(given);
  if (!g) return { ok: false, note: 'typ een breuk, bijvoorbeeld 3/4 of 1 2/5' };
  const ok = [].concat(accepted).map(parseFrac).some(a => a && a[0] * g[1] === g[0] * a[1]);
  return { ok };
}

// Map pointing: cities = nearest dot within radius; regions = grid lookup with a small tolerance (cells).
function codeAt(grid, x, y) {
  const c = Math.floor(x / grid.cell), r = Math.floor(y / grid.cell);
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return '.';
  return grid.data[r * grid.cols + c];
}
function checkPoint(q, it, [x, y]) {
  const dots = q.dots || {};
  const nearest = Object.entries(dots).map(([n, [dx, dy]]) => [n, Math.hypot(dx - x, dy - y)]).sort((a, b) => a[1] - b[1])[0];
  if (it.dot) {
    const ok = nearest && nearest[0] === it.dot && nearest[1] <= (q.cityRadius || 45);
    return { ok, hit: !ok && nearest && nearest[1] <= (q.cityRadius || 45) ? nearest[0] : null };
  }
  const tol = q.tolerance ?? 2, g = q.grid;
  const here = codeAt(g, x, y);
  let ok = it.codes.includes(here);
  for (let dr = -tol; !ok && dr <= tol; dr++) for (let dc = -tol; !ok && dc <= tol; dc++)
    if (it.codes.includes(codeAt(g, x + dc * g.cell, y + dr * g.cell))) ok = true;
  return { ok, hit: ok ? null : (q.codeNames?.[here] || null) };
}

const MANUAL = new Set(['open', 'draw']);

function maxPoints(q) {
  if (q.points != null) return q.points;
  switch (q.type) {
    case 'tf': return q.statements.length;
    case 'fill': return q.blanks.length;
    case 'match': return q.items.length;
    case 'map': return q.items.length;
    case 'list': return q.count;
    case 'point': return q.items.length;
    case 'words': return q.items.length;
    default: return 1;
  }
}

function gradeQuestion(q, a) {
  const max = maxPoints(q);
  if (MANUAL.has(q.type)) return { max, manual: true, points: null, items: [] };
  const items = [];
  switch (q.type) {
    case 'mc':
      items.push({ ok: a === q.answer, given: a == null ? '' : q.options[a], expected: q.options[q.answer] });
      break;
    case 'tf':
      q.statements.forEach((s, i) => {
        const v = a?.[i];
        items.push({ ok: v === s.answer, given: v == null ? '' : v ? 'waar' : 'niet waar', expected: s.answer ? 'waar' : 'niet waar', label: s.text });
      });
      break;
    case 'fill':
      q.blanks.forEach((b, i) => {
        const r = (b.frac ?? q.frac) ? checkFrac(a?.[i], b.answer) : (b.num ?? q.num) ? checkNum(a?.[i], b.answer) : checkText(a?.[i], b.answer, { case: b.case ?? q.case, near: b.near ?? q.near });
        items.push({ ...r, given: a?.[i] ?? '', expected: [].concat(b.answer)[0] });
      });
      break;
    case 'match':
      q.items.forEach((it, i) => items.push({ ok: a?.[i] === it.answer, given: a?.[i] ?? '', expected: it.answer, label: it.left }));
      break;
    case 'map':
      q.items.forEach(it => {
        const r = checkText(a?.[it.label], it.answer, { case: q.case });
        items.push({ ...r, given: a?.[it.label] ?? '', expected: [].concat(it.answer)[0], label: it.label });
      });
      break;
    case 'point':
      q.items.forEach(it => {
        const p = a?.[it.name];
        if (!p) { items.push({ ok: false, given: '', label: it.name, note: 'niet aangewezen' }); return; }
        const r = checkPoint(q, it, p);
        items.push({ ok: r.ok, given: r.ok ? 'goed aangewezen' : (r.hit ? `je wees ${r.hit} aan` : 'net ernaast'), label: it.name, point: p });
      });
      break;
    case 'words': // tap the words that belong together (e.g. the naamwoordelijk gezegde); item.answer = word indices
      q.items.forEach((it, i) => {
        const words = it.text.split(' ');
        const sel = [...(a?.[i] || [])].sort((x, y) => x - y);
        const exp = [...it.answer].sort((x, y) => x - y);
        const clean = idx => idx.map(k => words[k].replace(/[.,!?;:]+$/, '')).join(' ');
        items.push({ ok: sel.length === exp.length && sel.every((v, k) => v === exp[k]), given: clean(sel), expected: clean(exp), label: it.text });
      });
      break;
    case 'list': {
      const used = new Set();
      for (let i = 0; i < q.count; i++) {
        const g = a?.[i];
        let hit = null, note;
        for (const acc of q.accepted) {
          const r = checkText(g, acc, { case: q.case });
          const key = [].concat(acc)[0];
          if (r.ok && !used.has(key)) { hit = key; break; }
          if (r.ok && used.has(key)) note = 'dit had je al';
          else if (!note && r.note && r.note !== 'niet ingevuld') note = r.note;
        }
        if (hit) used.add(hit);
        items.push({ ok: !!hit, given: g ?? '', note: hit ? undefined : (g ? note : 'niet ingevuld') });
      }
      break;
    }
  }
  const per = max / Math.max(1, items.length);
  const points = Math.round(items.filter(i => i.ok).length * per * 10) / 10;
  return { max, manual: false, points, items };
}

function allQuestions(test) {
  const out = [];
  test.sections.forEach((s, si) => s.questions.forEach(q => { if (q.type !== 'info') out.push({ ...q, section: si }); }));
  return out;
}

function gradeTest(test, answers) {
  const per = {};
  let auto = 0, autoMax = 0, manualMax = 0;
  for (const q of allQuestions(test)) {
    const g = gradeQuestion(q, answers[q.id]);
    per[q.id] = g;
    if (g.manual) manualMax += g.max; else { auto += g.points; autoMax += g.max; }
  }
  return { per, auto: { points: Math.round(auto * 10) / 10, max: autoMax }, manualMax, max: autoMax + manualMax };
}

const cijfer = (p, max) => Math.round(((p / max) * 9 + 1) * 10) / 10;

if (typeof module !== 'undefined') module.exports = { checkText, checkNum, checkFrac, parseFrac, checkPoint, gradeQuestion, gradeTest, allQuestions, maxPoints, cijfer };
