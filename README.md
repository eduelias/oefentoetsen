# Oefentoetsen

A small self-hosted player for practice lessons and tests for primary-school children (Dutch UI, built for groep 5–8). A test is one JSON file, a lesson is one HTML file. The child works on a tablet or laptop; answers are checked strictly, the way a Dutch school marks them, and stored on your own machine.

No accounts, no cloud, no dependencies: Python 3 standard library for the server, plain JavaScript in the browser.

The companion repo [oefentoetsen-skills](https://github.com/eduelias/oefentoetsen-skills) lets an AI coding agent (Claude Code) write the lessons and tests from your child's school goals and mark the open answers.

## Start

```bash
python3 serve.py
```

Open http://localhost:8765. Two example tests are included: one lesson → test pair, and one test that shows every question type.

For a tablet on the same Wi-Fi:

```bash
python3 serve.py --lan
```

The server prints the address to open on the tablet. On macOS you can double-click `start.command` or `start-tablet.command` instead.

## Layout

| Path | What |
|---|---|
| `index.html` | The child's overview: to do, done (with grade), archive, and a parent corner with the marking links |
| `toets.html?t=<id>` | Test player. Autosaves in the browser and to the server |
| `resultaat.html?r=<file>` | Result for the child. Add `&edit=1` for the marking view |
| `rekenlessen.html` | Overview of stand-alone lessons listed in `lessons/index.json` |
| `engine/` | `grade.js` (shared grading), `player.js`, `review.js`, `lesson.js`, `style.css` |
| `tests/<id>/test.json` | One folder per test; images sit beside it |
| `lessons/<id>.html` | Interactive lesson, usually done before a test |
| `results/` | One JSON per attempt, plus `progress/` for unfinished attempts and lesson logs. Never served, never committed |
| `tools/check.js` | Checks tests and lessons before a child sees them |
| `tools/report.js` | Prints one attempt: score per goal, every wrong item, open answers waiting for marking |

## Writing a test

Copy `tests/voorbeeld-vraagtypen/` and edit `test.json`. Top-level fields: `title` (split at ` – ` into name and subtitle), `subject` (`Rekenen`, `Taal`, `Aardrijkskunde` or anything else, optionally `· detail`), `group`, `emoji`, `intro`, `tips`, `student`, `lesson`, `archived`, `sections[]`. A section has `title`, optional `intro`, optional `goal` (a tag for the learning goal, so results can be scored per goal) and `questions[]`. Every question needs a unique `id`.

| Type | Fields | Notes |
|---|---|---|
| `mc` | `options[]`, `answer` (index) | Optional `image`, `imageWidth`, `optionImages[]` |
| `tf` | `statements[{text, answer}]` | 1 point per statement |
| `fill` | `lines[]` with `___`, `blanks[{answer}]` | `answer` is a string or a list of accepted spellings. Optional `wordbank[]` |
| `match` | `items[{left, answer}]`, `options[]` | `optionStyle: "letters"` shows options as an A–J list |
| `list` | `count`, `accepted[]` | "Noem drie…": each answer counts once |
| `words` | `items[{text, answer}]` | Tap the words; `answer` = word indices |
| `map` | `image`, `items[{label, answer}]` | Optional `groups[{title, labels[]}]` |
| `point` | `image`, `size: [w, h]`, `items[]`, `dots{}` | Tap on the picture. Item `{name, dot}` = nearest dot within `cityRadius`; item `{name, codes, at}` + `grid{cell, cols, rows, data}` = region lookup |
| `open` | `points`, `model`, `rubric[]` | Marked by hand (or by an agent) |
| `draw` | `points`, `model`, `rubric[]` | Canvas drawing, marked by hand. Optional `background` |
| `info` | `html`, `image` | Not graded |

Any auto-checked question may have `explain` (shown after handing in) and `points` (default: one per item).

How typed answers are compared (set on a blank or on the whole question):

- Default: exact, **case-sensitive**. A capital slip scores 0 with the hint "let op de hoofdletter(s)"; one or two wrong letters score 0 with "bijna goed". Use `case: false` where capitals do not matter and `near: false` to switch the spelling hint off.
- `num: true`: compared as a number. `2500` = `2.500` = `2 500`, decimal comma, a trailing unit or € is ignored. `4.25` scores 0 with the hint to write a comma.
- `frac: true`: fractions compared by value. `6/8` = `3/4`, `4/3` = `1 1/3` = `1 en 1/3`.

In prompts, write a fraction as `<span class="frac"><span>3</span><span>4</span></span>`.

## Writing a lesson

Copy `lessons/voorbeeld-kommagetallen.html`. Each `<section class="slide">` is one page; "Volgende" stays locked until every exercise on the page is solved. Link it from a test with `"lesson": "lessons/<id>.html"`: the test then stays locked until the last slide was reached on that device.

```html
<div class="try" id="a2" data-answer="7,85" data-num
     data-fb='{"4,61": "Je zette de 6 onder de 5. Zet komma onder komma."}'
     data-hint="Schrijf 4,25 + 3,60 onder elkaar.">4,25 + 3,6 = ___</div>
```

- `___` becomes an input. Several blanks: split `data-answer` with `;`. Alternatives: `|`.
- `data-num` / `data-frac` compare like the test does. `data-fb` gives feedback for specific wrong answers, `data-hint` shows after two wrong tries, and the answer shows after three.
- `<div class="try pick" data-answer="1"><button>…</button><button>…</button></div>`: choose a button.
- `<div class="try tap" data-words="De soep is heet." data-answer="2 3">`: tap words, like the `words` question.
- On touch screens number exercises get an on-screen keypad, so no keyboard covers the page. Extra keys: `data-keys="/"`.

Every try is logged to `results/progress/les-<lessonId>.json`, so you can see where the child struggled.

## Check before the child sees it

```bash
node tools/check.js
```

It fails when a file is missing, a key does not match its options, or a perfect answer sheet built from the keys does not score full marks. It warns about patterns that were real key mistakes before, such as a `t` on the verb before `jij`.

## Marking

`node tools/report.js` prints the newest attempt: the score per goal, every wrong item with what was typed, and the open answers.

Auto-checked questions are scored when the test is handed in. Open and drawn answers wait for marking in `resultaat.html?r=<file>&edit=1`, or through the API:

```
POST /api/grade/<file>   {"manual": {"<questionId>": {"points": 1, "comment": "…"}, "_comment": "…", "_done": true}}
```

Manual points override auto points for the same question. The grade is `points / max × 9 + 1`. Marking from another device needs the code in `grade.key` (created on first start); requests from the machine itself need none. Do not enter the code on the child's device. The full API is described at the top of `serve.py`.

## Privacy and school material

- `results/` holds a child's answers. It is gitignored and the server refuses to serve it. Keep it off public repos and shared drives.
- The server has no login. Run it on your home network only; do not expose it to the internet.
- Teaching methods are copyrighted. Build your own questions around the *goals* your school works on; do not copy exercises, word lists, maps or pictures from a method into tests you share or publish.

## Optional: Nintendo Switch

The Switch only opens its browser for a Wi-Fi login page. `serve.py --lan --portal-port 80`, together with a DNS rewrite on your own network that points the Switch's connection test at this server, lets a parent switch "lesson mode" on from `rekenlessen.html`. See the notes at the top of `serve.py`. Most families will be better off with a tablet.

## License

MIT, see [LICENSE](LICENSE).
