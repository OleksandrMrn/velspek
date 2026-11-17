// Structural check of the specs, ADRs and investigations of a repository.
// Usage: node docs/specs/_tools/check.mjs [repository root]
// Prints every problem and exits with 1, or prints "ok". The rules are in docs/specs/README.md, "Tooling".

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Front matter is one unindented `key: value` per line, the value plain text up to an optional ` #` comment.
function read(root, path, problems) {
  if (!existsSync(join(root, path))) return void problems.push(`${path}: missing`);
  const lines = readFileSync(join(root, path), 'utf8').split('\n');
  const end = lines.indexOf('---', 1);
  if (lines[0] !== '---' || end < 0) return void problems.push(`${path}: no front matter between two '---' lines`);
  const doc = { path, fields: {}, statuses: [], body: lines.slice(end + 1) };
  for (const line of lines.slice(1, end)) {
    const match = /^([\w-]+):(.*)$/.exec(line);
    if (!match) {
      problems.push(`${path}: front matter line '${line}' is not 'key: value'`);
      continue;
    }
    const [value, comment = ''] = match[2].split(/ #(.*)/);
    if (/^(["']).*\1$/.test(value.trim())) problems.push(`${path}: the value of ${match[1]} is quoted; write it as plain text`);
    doc.fields[match[1]] = value.trim();
    if (match[1] === 'status') doc.statuses = comment.split('|').map((status) => status.trim());
  }
  return doc;
}

// The lines under a `## ` heading, up to the next one.
function section(doc, heading) {
  const start = doc.body.indexOf(heading);
  if (start < 0) return [];
  const rest = doc.body.slice(start + 1);
  const next = rest.findIndex((line) => line.startsWith('## '));
  return next < 0 ? rest : rest.slice(0, next);
}

// The keys and the status of a document are the ones its template lists.
function checkFrontMatter(doc, template, problems) {
  const keys = (document) => Object.keys(document.fields).sort().join(', ');
  if (keys(doc) !== keys(template)) problems.push(`${doc.path}: front matter keys ${keys(doc)}; expected ${keys(template)}`);
  if (!template.statuses.includes(doc.fields.status)) problems.push(`${doc.path}: status '${doc.fields.status}' is not one of ${template.statuses.join(', ')}`);
}

function names(root, dir, keep) {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir), { withFileTypes: true }).filter(keep).map((entry) => entry.name).sort();
}

const isDocument = (entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_') && entry.name !== 'README.md';
const isFolder = (entry) => entry.isDirectory() && !entry.name.startsWith('_');

function checkSpec(doc, problems) {
  const say = (text) => problems.push(`${doc.path}: ${text}`);
  const { ticket, status } = doc.fields;
  if (!ticket || !basename(doc.path).startsWith(`${ticket}-`)) say(`the file name must be '${ticket || '<ticket>'}-<slug>.md'`);
  const approved = status === 'approved' || status === 'implemented';
  if (approved && !(doc.fields.approved_by && DATE.test(doc.fields.date))) say(`an ${status} spec needs approved_by and date (YYYY-MM-DD)`);
  const tasks = [];
  const sessions = [];
  for (const line of section(doc, '## Tasks')) {
    let match;
    if ((match = /^### S(\d+):/.exec(line))) {
      sessions.push({ number: Number(match[1]), tasks: [], check: [], checked: [] });
    } else if ((match = /^- \[([ x])\] T(\d+)\b/.exec(line))) {
      const task = { number: Number(match[2]), ticked: match[1] === 'x' };
      tasks.push(task);
      if (sessions.length) sessions.at(-1).tasks.push(task);
      else say(`T${task.number} is in no session`);
    } else if (sessions.length && (match = /^- Check:(.*)$/.exec(line))) {
      sessions.at(-1).check.push(match[1].trim());
    } else if (sessions.length && (match = /^- Checked:(.*)$/.exec(line))) {
      sessions.at(-1).checked.push(match[1].trim());
    }
  }
  if (tasks.some((task, index) => task.number !== index + 1)) say('the tasks must be T1, T2, … in order');
  if (sessions.some((session, index) => session.number !== index + 1)) say('the sessions must be S1, S2, … in order');
  for (const session of sessions) {
    const name = `S${session.number}`;
    if (!session.tasks.length) say(`${name} has no task`);
    if (session.check.length !== 1 || !session.check[0]) say(`${name} needs exactly one 'Check' line with text`);
    if (session.checked.length !== 1) say(`${name} needs exactly one 'Checked' line`);
    else if (session.checked[0]) {
      if (!/^.+, \d{4}-\d{2}-\d{2}$/.test(session.checked[0])) say(`'Checked' of ${name} must be '<name>, <YYYY-MM-DD>'`);
      if (session.tasks.some((task) => !task.ticked)) say(`${name} is checked but has an unticked task`);
    }
  }
  if (approved && !tasks.length) say(`an ${status} spec needs tasks like '- [ ] T1 (R1): <task>'`);
  if (status === 'implemented') {
    if (tasks.some((task) => !task.ticked)) say('the spec is implemented but has unticked tasks');
    if (!section(doc, '## Log').some((line) => /^- \[\d{4}-\d{2}-\d{2}\] /.test(line))) say("the spec is implemented but 'Log' has no entry like '- [<YYYY-MM-DD>] S1 (T1–T2): <results>'");
  }
}

function checkSpecs(root, problems) {
  const template = read(root, 'docs/specs/_template/spec.md', problems);
  if (!template) return;
  for (const dir of ['docs/specs', 'docs/specs/_example']) {
    const byTicket = new Map();
    for (const name of names(root, dir, isDocument)) {
      const doc = read(root, `${dir}/${name}`, problems);
      if (!doc) continue;
      checkFrontMatter(doc, template, problems);
      checkSpec(doc, problems);
      byTicket.set(doc.fields.ticket, [...(byTicket.get(doc.fields.ticket) ?? []), name]);
    }
    for (const [ticket, files] of byTicket) {
      if (ticket && files.length > 1) problems.push(`${dir}: ticket ${ticket} has several specs: ${files.join(', ')}`);
    }
  }
}

function checkAdrs(root, problems) {
  const template = read(root, 'docs/adr/_template.md', problems);
  if (!template) return;
  const adrs = new Map();
  for (const name of names(root, 'docs/adr', isDocument)) {
    const path = `docs/adr/${name}`;
    const number = /^(\d{4})-.+\.md$/.exec(name)?.[1];
    if (!number) {
      problems.push(`${path}: the name must be '0001-<slug>.md'`);
      continue;
    }
    const doc = read(root, path, problems);
    if (!doc) continue;
    checkFrontMatter(doc, template, problems);
    if (doc.fields.id !== number) problems.push(`${path}: id '${doc.fields.id}' differs from the number in the file name`);
    if (adrs.has(number)) problems.push(`${path}: number ${number} is also used by ${adrs.get(number).path}`);
    else adrs.set(number, doc);
  }
  for (const doc of adrs.values()) {
    const old = doc.fields.supersedes;
    if (!old) continue;
    if (!adrs.has(old)) problems.push(`${doc.path}: supersedes '${old}', which does not exist`);
    else if (doc.fields.status === 'accepted' && adrs.get(old).fields.status !== 'superseded') problems.push(`${adrs.get(old).path}: superseded by ${doc.path}, so its status must be superseded`);
  }
}

function checkInvestigations(root, problems) {
  const dir = 'docs/investigations';
  const template = read(root, `${dir}/_template/investigation.md`, problems);
  if (!template) return;
  for (const slug of names(root, dir, isFolder)) {
    const doc = read(root, `${dir}/${slug}/investigation.md`, problems);
    if (!doc) continue;
    const say = (text) => problems.push(`${doc.path}: ${text}`);
    checkFrontMatter(doc, template, problems);
    if (doc.fields.slug !== slug) say(`slug '${doc.fields.slug}' differs from the folder name '${slug}'`);
    if (doc.fields.status !== 'ready') continue;
    if (!DATE.test(doc.fields.date)) say('a ready investigation needs date (YYYY-MM-DD)');
    if (section(doc, '## Coverage').some((line) => /^\|[^|]*\|\s*open\s*\|/.test(line))) say("the investigation is ready but 'Coverage' has an open area");
    if (!section(doc, '## Decisions').some((line) => /^- D\d+ \(\d{4}-\d{2}-\d{2}\)/.test(line))) say("the investigation is ready but 'Decisions' has no entry like '- D1 (<YYYY-MM-DD>). <question>'");
    const roadmap = join(root, dir, slug, 'roadmap.md');
    if (!existsSync(roadmap) || !/^- S\d+\. [^<]/m.test(readFileSync(roadmap, 'utf8'))) say("the investigation is ready but roadmap.md has no step like '- S1. <step>'");
  }
}

export function check(root) {
  const problems = [];
  checkSpecs(root, problems);
  checkAdrs(root, problems);
  checkInvestigations(root, problems);
  return problems;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '../../..'));
  const problems = check(root);
  for (const problem of problems) console.log(problem);
  console.log(problems.length ? `${problems.length} problem(s)` : 'ok');
  process.exit(problems.length ? 1 : 0);
}
