# oefentoetsen

Public repo (MIT): the player, grading engine and server for practice lessons and tests. Formats and API: `README.md` and the header of `serve.py`.

- Nothing personal goes in here: no child's name, no results, no school name, no material copied from a teaching method. `results/` and `grade.key` are gitignored; keep it that way.
- A family's own tests and lessons live in their own private copy of `tests/` and `lessons/`; only neutral examples (`voorbeeld-*`) belong in this repo.
- After changing `engine/grade.js`, a test or a lesson: `node tools/check.js` must pass.
- No dependencies: Python standard library and plain browser JavaScript.
- The agent skills that write and mark tests are in the sibling repo `oefentoetsen-skills`.
