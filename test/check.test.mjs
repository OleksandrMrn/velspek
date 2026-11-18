// Tests of the check the kit installs: node --test test/check.test.mjs

import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { check } from '../template/docs/specs/_tools/check.mjs';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../template');
const SPEC = 'docs/specs/ABC-123-limit_login_attempts.md';
const EXAMPLE = readFileSync(join(KIT, 'docs/specs/_example/ABC-123-limit_login_attempts.md'), 'utf8');
const INVESTIGATION = readFileSync(join(KIT, 'docs/investigations/_template/investigation.md'), 'utf8');

// The problems of a copy of the kit's docs with `files` added.
function problems(files) {
  const root = mkdtempSync(join(tmpdir(), 'kit-check-'));
  try {
    cpSync(join(KIT, 'docs'), join(root, 'docs'), { recursive: true });
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// `text` with each `from`, a string or a pattern, replaced by its `to`; a `from` that is absent fails the test.
function edit(text, ...pairs) {
  for (const [from, to] of pairs) {
    assert.ok(typeof from === 'string' ? text.includes(from) : text.search(from) >= 0, `the text has no '${from}'`);
    text = text.replace(from, to);
  }
  return text;
}

const spec = (...pairs) => problems({ [SPEC]: edit(EXAMPLE, ...pairs) });

function reports(found, fragment) {
  assert.ok(found.some((problem) => problem.includes(fragment)), `no problem with '${fragment}' in ${JSON.stringify(found)}`);
}

const adr = (id, status, supersedes = '') => `---\nid: ${id}\ntitle: A decision\nstatus: ${status}\ndate: 2026-10-01\nsupersedes: ${supersedes}\n---\n\n# ADR-${id}: A decision\n`;

function investigation(...pairs) {
  return edit(INVESTIGATION, ['slug: <slug>', 'slug: shop'], ...pairs);
}

const READY = [
  ['status: draft', 'status: ready'],
  ['date:', 'date: 2026-10-02'],
  [/\| open \|/g, '| covered |'],
  ['- D1 (<date>).', '- D1 (2026-10-01).'],
];

test('the kit as shipped has no problems', () => {
  assert.deepEqual(check(KIT), []);
});

test('a spec through its lifecycle has no problems', () => {
  const requirementsOnly = edit(EXAMPLE.slice(0, EXAMPLE.indexOf('## Constraints')), ['status: implemented', 'status: draft'], ['approved_by: R. Reviewer', 'approved_by:'], ['date: 2026-10-05', 'date:']);
  assert.deepEqual(problems({ [SPEC]: requirementsOnly }), []);
  assert.deepEqual(spec(['status: implemented', 'status: approved'], ['- [x] T3', '- [ ] T3'], ['- [x] T4', '- [ ] T4'], ['Checked: R. Reviewer, 2026-10-07', 'Checked:']), []);
  assert.deepEqual(spec(), []);
  assert.deepEqual(spec(['status: implemented', 'status: approved'], ['- [x] T2', '- [ ] T2'], ['Checked: R. Reviewer, 2026-10-08', 'Checked:']), []);
});

test('front matter follows the template', () => {
  reports(spec(['status: implemented', 'status: done']), "status 'done' is not one of");
  reports(spec(['approved_by: R. Reviewer\n', '']), 'front matter keys');
  reports(spec(['status: implemented', 'status: "implemented"']), 'is quoted');
  reports(spec(['title: Limit', '  title: Limit']), "is not 'key: value'");
  reports(problems({ [SPEC]: EXAMPLE.replace('---\n', '') }), 'no front matter');
});

test('CRLF line endings change nothing', () => {
  const crlf = (text) => text.replace(/\n/g, '\r\n');
  const folder = 'docs/investigations/shop';
  assert.deepEqual(problems({ [SPEC]: crlf(EXAMPLE), [`${folder}/investigation.md`]: crlf(investigation(...READY)), [`${folder}/roadmap.md`]: '- S1. Check the payment API.\r\n' }), []);
});

test('a front matter key is given once', () => {
  reports(spec(['approved_by:', 'status: draft\napproved_by:']), 'front matter key status is given twice');
});

test('a spec is named after its ticket, one per ticket', () => {
  reports(spec(['ticket: ABC-123', 'ticket: ABC-999']), "the file name must be 'ABC-999-<slug>.md'");
  reports(problems({ [SPEC]: EXAMPLE, 'docs/specs/ABC-123-again.md': EXAMPLE }), 'ticket ABC-123 has several specs');
});

test('approval needs a name, a date and tasks', () => {
  reports(spec(['approved_by: R. Reviewer', 'approved_by:']), 'needs approved_by and date');
  reports(spec(['date: 2026-10-05', 'date: October']), 'needs approved_by and date');
  reports(problems({ [SPEC]: edit(EXAMPLE.slice(0, EXAMPLE.indexOf('## Tasks')), ['status: implemented', 'status: approved']) }), 'needs tasks');
});

test('tasks and sessions are numbered in order, every task in a session', () => {
  reports(spec(['- [x] T3', '- [x] T5']), 'the tasks must be T1, T2, … in order');
  reports(spec(['### S2:', '### S3:']), 'the sessions must be S1, S2, … in order');
  reports(spec(['### S1:', '#### S1:']), 'T1 is in no session');
  reports(spec(['- [x] T3', '- T3'], ['- [x] T4', '- T4']), 'S2 has no task');
});

test('a checkbox under Tasks is a task', () => {
  reports(spec(['- [x] T4', '- [ ] t4']), "'- [ ] t4 (R1, R5): events");
  reports(spec(['- [x] T4', '- [X] T4']), "is not a task like '- [ ] T1 (R1): <task>'");
  reports(spec(['- [x] T4', '- [x] Task 4']), 'is not a task like');
  assert.deepEqual(spec(['- Check: the checks of R1', '  - [ ] a step of the person\n- Check: the checks of R1']), []);
});

test("a session has one 'Check' and one 'Checked', filled only when its tasks are ticked", () => {
  reports(spec(['- Check: `npm test', '- Note: `npm test']), "S1 needs exactly one 'Check' line");
  reports(spec(['- Checked: R. Reviewer, 2026-10-07', '']), "S2 needs exactly one 'Checked' line");
  reports(spec(['Checked: R. Reviewer, 2026-10-07', 'Checked: yes']), "'Checked' of S2 must be");
  reports(spec(['status: implemented', 'status: approved'], ['- [x] T4', '- [ ] T4']), 'S2 is checked but has an unticked task');
});

test('an implemented spec has every task ticked and a log entry', () => {
  reports(spec(['- [x] T4', '- [ ] T4']), 'implemented but has unticked tasks');
  reports(problems({ [SPEC]: EXAMPLE.slice(0, EXAMPLE.indexOf('## Log')) }), "'Log' has no entry");
});

test('ADRs are numbered files whose ids and supersedes match', () => {
  assert.deepEqual(problems({ 'docs/adr/0001-old.md': adr('0001', 'superseded'), 'docs/adr/0002-new.md': adr('0002', 'accepted', '0001') }), []);
  reports(problems({ 'docs/adr/first.md': adr('0001', 'accepted') }), "the name must be '0001-<slug>.md'");
  reports(problems({ 'docs/adr/0001-a.md': adr('0002', 'accepted') }), 'differs from the number in the file name');
  reports(problems({ 'docs/adr/0001-a.md': adr('0001', 'final') }), "status 'final' is not one of");
  reports(problems({ 'docs/adr/0001-a.md': adr('0001', 'accepted'), 'docs/adr/0001-b.md': adr('0001', 'accepted') }), 'number 0001 is also used');
  reports(problems({ 'docs/adr/0002-new.md': adr('0002', 'accepted', '0001') }), "supersedes '0001', which does not exist");
  reports(problems({ 'docs/adr/0001-old.md': adr('0001', 'accepted'), 'docs/adr/0002-new.md': adr('0002', 'accepted', '0001') }), 'its status must be superseded');
});

test('an investigation matches its folder and is ready only when complete', () => {
  const folder = 'docs/investigations/shop';
  const roadmap = '---\nslug: shop\ninvestigation: ./investigation.md\n---\n\n- S1. Check the payment API.\n';
  assert.deepEqual(problems({ [`${folder}/investigation.md`]: investigation() }), []);
  assert.deepEqual(problems({ [`${folder}/investigation.md`]: investigation(...READY), [`${folder}/roadmap.md`]: roadmap }), []);
  reports(problems({ 'docs/investigations/other/investigation.md': investigation() }), "differs from the folder name 'other'");
  reports(problems({ [`${folder}/investigation.md`]: investigation(...READY) }), 'roadmap.md has no step');
  const open = problems({ [`${folder}/investigation.md`]: investigation(READY[0]), [`${folder}/roadmap.md`]: roadmap });
  reports(open, 'needs date');
  reports(open, "'Coverage' has an open area");
  reports(open, "'Decisions' has no entry");
});
