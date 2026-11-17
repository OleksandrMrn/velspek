// Tests of the velspek CLI: node --test test/cli.test.mjs

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { install, uninstall } from '../bin/velspek.mjs';
import { check } from '../template/docs/specs/_tools/check.mjs';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(KIT, 'bin/velspek.mjs');
const KIT_SETTINGS = JSON.parse(readFileSync(join(KIT, 'template/claude/settings.json'), 'utf8')).permissions;

// Runs `body` in an empty directory with helpers to read and write its files.
function inProject(body) {
  const root = mkdtempSync(join(tmpdir(), 'velspek-'));
  const read = (path) => readFileSync(join(root, path), 'utf8');
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  try {
    body({ root, read, write, has: (path) => existsSync(join(root, path)) });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const reports = (report, fragment) => assert.ok(report.some((line) => line.includes(fragment)), `no line with '${fragment}' in ${JSON.stringify(report)}`);
const count = (text, part) => text.split(part).length - 1;
const sha = (text) => createHash('sha256').update(text).digest('hex');

// `text` with each `from` replaced by its `to`; a `from` that is absent fails the test.
function edit(text, ...pairs) {
  for (const [from, to] of pairs) {
    assert.ok(text.includes(from), `the text has no '${from}'`);
    text = text.replace(from, to);
  }
  return text;
}

test('init installs the rules, both sets of skills, the docs and a manifest', () => {
  inProject(({ root, read, has }) => {
    install(root);
    assert.equal(count(read('AGENTS.md'), '<!-- velspek:start'), 1);
    assert.match(read('AGENTS.md'), /<!-- velspek:end -->\n\n## 9\. Project-specific/);
    const claude = read('.claude/skills/spec/SKILL.md');
    const codex = read('.agents/skills/spec/SKILL.md');
    assert.match(claude, /^disable-model-invocation: true$/m);
    assert.equal(codex, claude.replace(/^(argument-hint|disable-model-invocation):.*\n/gm, ''));
    assert.equal(count(codex, '\n---\n'), 1);
    assert.equal(read('.agents/skills/spec/agents/openai.yaml'), 'policy:\n  allow_implicit_invocation: false\n');
    for (const path of ['docs/specs/README.md', 'docs/specs/_template/spec.md', 'docs/specs/_tools/check.mjs', 'docs/adr/_template.md', 'docs/investigations/_template/roadmap.md', '.gitignore', '.claude/settings.json']) {
      assert.ok(has(path), path);
    }
    assert.ok(!has('docs/specs/_tools/check.test.mjs'));
    assert.deepEqual(JSON.parse(read('.velspek.json')).tools, ['claude', 'codex']);
    assert.deepEqual(check(root), []);
  });
});

test('a second run changes nothing, and a dry run writes nothing', () => {
  inProject(({ root }) => {
    reports(install(root, { dryRun: true }), 'AGENTS.md');
    assert.deepEqual(readdirSync(root), []);
    install(root);
    assert.deepEqual(install(root), []);
  });
});

test('an existing AGENTS.md keeps its text and gets the block and section 9 once', () => {
  inProject(({ root, read, write }) => {
    write('AGENTS.md', '# Our rules\n\nUse tabs.\n');
    reports(install(root), 'the block and section 9 were appended');
    const agents = read('AGENTS.md');
    assert.ok(agents.startsWith('# Our rules\n\nUse tabs.\n\n<!-- velspek:start'));
    assert.match(agents, /## 9\. Project-specific/);
    install(root);
    assert.equal(count(read('AGENTS.md'), '<!-- velspek:start'), 1);
  });
});

test('update replaces the block and leaves section 9 alone', () => {
  inProject(({ root, read, write }) => {
    install(root);
    write('AGENTS.md', edit(read('AGENTS.md'), ['- Chat language (section 7):', '- Chat language (section 7): Ukrainian'], ["## 1. Core rule: ask, don't assume", '## 1. An older rule']));
    reports(install(root), 'updated  AGENTS.md');
    assert.match(read('AGENTS.md'), /## 1\. Core rule: ask, don't assume/);
    assert.match(read('AGENTS.md'), /- Chat language \(section 7\): Ukrainian/);
  });
});

test('a kit file changed locally is kept unless forced', () => {
  inProject(({ root, read, write }) => {
    install(root);
    write('docs/specs/README.md', 'our own process\n');
    reports(install(root), 'kept     docs/specs/README.md');
    assert.equal(read('docs/specs/README.md'), 'our own process\n');
    reports(install(root, { force: true }), 'updated  docs/specs/README.md');
    assert.notEqual(read('docs/specs/README.md'), 'our own process\n');
    assert.deepEqual(install(root), []);
  });
});

test('a file the kit no longer ships is removed, unless it was changed', () => {
  inProject(({ root, read, write, has }) => {
    install(root);
    const manifest = JSON.parse(read('.velspek.json'));
    write('docs/specs/_template/plan.md', 'old\n');
    write('docs/old/guide.md', 'edited\n');
    manifest.files['docs/specs/_template/plan.md'] = sha('old\n');
    manifest.files['docs/old/guide.md'] = sha('as installed\n');
    write('.velspek.json', JSON.stringify(manifest));
    const report = install(root);
    reports(report, 'removed  docs/specs/_template/plan.md');
    reports(report, 'kept     docs/old/guide.md (no longer in the kit');
    assert.ok(!has('docs/specs/_template/plan.md') && has('docs/specs/_template/spec.md'));
    assert.equal(read('docs/old/guide.md'), 'edited\n');
    assert.ok(!('docs/old/guide.md' in JSON.parse(read('.velspek.json')).files));
  });
});

test('permission rules are merged into existing settings and taken out again', () => {
  inProject(({ root, read, write }) => {
    write('.claude/settings.json', JSON.stringify({ model: 'x', permissions: { allow: ['Bash(npm test)', KIT_SETTINGS.allow[0]] } }));
    install(root);
    const merged = JSON.parse(read('.claude/settings.json'));
    assert.equal(merged.model, 'x');
    assert.equal(merged.permissions.allow[0], 'Bash(npm test)');
    assert.equal(count(JSON.stringify(merged.permissions.allow), JSON.stringify(KIT_SETTINGS.allow[0])), 1);
    assert.deepEqual(merged.permissions.deny, KIT_SETTINGS.deny);
    uninstall(root);
    assert.deepEqual(JSON.parse(read('.claude/settings.json')), { model: 'x', permissions: { allow: ['Bash(npm test)', KIT_SETTINGS.allow[0]], deny: [] } });
  });
});

test('settings that are not JSON stop the run before anything is written', () => {
  inProject(({ root, write }) => {
    write('.claude/settings.json', '{ // comment\n}');
    assert.throws(() => install(root), /not valid JSON/);
    assert.deepEqual(readdirSync(root), ['.claude']);
  });
});

test('--only codex installs no Claude files, and a later update keeps that choice', () => {
  inProject(({ root, has }) => {
    install(root, { only: 'codex' });
    assert.ok(has('.agents/skills/implement/SKILL.md'));
    assert.ok(!has('.claude'));
    assert.deepEqual(install(root), []);
    reports(install(root, { only: 'claude' }), 'removed  .agents/skills/implement/SKILL.md');
    assert.ok(!has('.agents'));
    assert.ok(has('.claude/settings.json'));
  });
});

test('.gitignore gets the missing lines only', () => {
  inProject(({ root, read, write }) => {
    write('.gitignore', 'node_modules/\n.env\n');
    install(root);
    assert.equal(read('.gitignore'), 'node_modules/\n.env\n.DS_Store\n.env.*\n!.env.example\n.claude/settings.local.json\nCLAUDE.local.md\n');
  });
});

test('uninstall removes the kit and keeps what the project wrote', () => {
  inProject(({ root, read, write, has }) => {
    install(root);
    write('AGENTS.md', read('AGENTS.md').replace('- Stack and versions:', '- Stack and versions: Go 1.23'));
    write('docs/specs/ABC-1-first.md', 'ours\n');
    write('docs/investigations/README.md', 'changed\n');
    reports(uninstall(root), 'kept     docs/investigations/README.md');
    assert.equal(read('docs/specs/ABC-1-first.md'), 'ours\n');
    assert.ok(!has('docs/specs/README.md') && !has('docs/adr') && !has('.claude') && !has('.agents') && !has('.velspek.json'));
    assert.ok(has('docs/investigations/README.md') && has('.gitignore'));
    assert.ok(!read('AGENTS.md').includes('<!-- velspek'));
    assert.match(read('AGENTS.md'), /^# AGENTS\.md — Rules for AI agents\n\n## 9\. Project-specific\n/);
    assert.match(read('AGENTS.md'), /- Stack and versions: Go 1\.23/);
  });
});

test('uninstall of an untouched install leaves only .gitignore', () => {
  inProject(({ root }) => {
    install(root);
    uninstall(root);
    assert.deepEqual(readdirSync(root), ['.gitignore']);
    assert.throws(() => uninstall(root), /not installed/);
  });
});

test('the command line installs, checks and reports errors', () => {
  inProject(({ root }) => {
    const failed = spawnSync(process.execPath, [CLI, 'update', root], { encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /run "npx velspek init" first/);
    assert.match(execFileSync(process.execPath, [CLI, 'init', root], { encoding: 'utf8' }), /installed\n\nNext:/);
    assert.match(execFileSync(process.execPath, [CLI, 'update', root], { encoding: 'utf8' }), /already up to date/);
    assert.equal(execFileSync(process.execPath, [join(root, 'docs/specs/_tools/check.mjs')], { encoding: 'utf8' }), 'ok\n');
    assert.equal(spawnSync(process.execPath, [CLI, 'init', root, '--only', 'cursor'], { encoding: 'utf8' }).status, 1);
    assert.equal(spawnSync(process.execPath, [CLI, 'sync'], { encoding: 'utf8' }).status, 1);
  });
});
