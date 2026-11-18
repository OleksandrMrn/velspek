// Tests of the velspek CLI: node --test test/cli.test.mjs

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// Every file under `root`, by its path with forward slashes.
function walk(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(root, `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]));
}

const snapshot = (root) => Object.fromEntries(walk(root).sort().map((path) => [path, readFileSync(join(root, path), 'utf8')]));
const crlf = (text) => text.replace(/\r?\n/g, '\r\n');
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

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

test('.gitignore gets the missing lines only, above the lines of the project', () => {
  inProject(({ root, read, write }) => {
    write('.gitignore', 'node_modules/\n.env\n');
    install(root);
    assert.equal(read('.gitignore'), '.DS_Store\n.env.*\n!.env.example\n.claude/settings.local.json\nCLAUDE.local.md\nnode_modules/\n.env\n');
    assert.deepEqual(install(root), []);
  });
});

test('the ignore rules of the project keep the last word', () => {
  for (const own of ['.env*\n!.env.sample\n!.env.example\n', '.env\n!.env.example\n']) {
    inProject(({ root, read, write }) => {
      execFileSync('git', ['init', '-q', root]);
      write('.gitignore', own);
      install(root);
      const ignored = (path) => spawnSync('git', ['-C', root, 'check-ignore', '-q', path]).status === 0;
      assert.ok(ignored('.env') && ignored('.env.local') && ignored('CLAUDE.local.md'), own);
      assert.ok(!ignored('.env.example'), own);
      assert.equal(ignored('.env.sample'), !own.includes('.env.sample'), own);
      assert.ok(read('.gitignore').endsWith(own));
    });
  }
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

test('a checkout with CRLF line endings is the same kit', () => {
  inProject(({ root, read, write }) => {
    install(root);
    write('AGENTS.md', edit(read('AGENTS.md'), ['<!-- velspek:start', 'Our own rule.\n\n<!-- velspek:start']));
    for (const path of walk(root)) write(path, crlf(read(path)));
    assert.deepEqual(check(root), []);
    assert.deepEqual(install(root), []);
    write('AGENTS.md', edit(read('AGENTS.md'), ["## 1. Core rule: ask, don't assume", '## 1. An older rule']));
    write('.gitignore', edit(read('.gitignore'), ['.DS_Store\r\n', '']));
    assert.deepEqual(install(root), ['updated  AGENTS.md', 'updated  .gitignore']);
    assert.match(read('AGENTS.md'), /## 1\. Core rule: ask, don't assume\r\n/);
    assert.ok(read('.gitignore').startsWith('.DS_Store\r\n.env\r\n'));
    for (const path of ['AGENTS.md', '.gitignore']) assert.doesNotMatch(read(path), /[^\r]\n/, path);
    write('docs/specs/README.md', `${read('docs/specs/README.md')}ours\r\n`);
    const report = uninstall(root);
    assert.deepEqual(report.filter((line) => line.startsWith('kept')), ['kept     docs/specs/README.md (changed locally; --force removes it)']);
    assert.deepEqual(walk(root).sort(), ['.gitignore', 'AGENTS.md', 'docs/specs/README.md']);
    assert.ok(read('AGENTS.md').startsWith('# AGENTS.md — Rules for AI agents\r\n\r\nOur own rule.\r\n\r\n## 9. Project-specific\r\n'));
    assert.doesNotMatch(read('AGENTS.md'), /[^\r]\n/);
  });
});

test('damaged markers in AGENTS.md stop the run before anything is written', () => {
  const start = /<!-- velspek:start[^>]*-->/;
  const damages = {
    'no end': (agents) => agents.replace('<!-- velspek:end -->', ''),
    'a second end': (agents) => `${agents}\nOur own rule.\n\n<!-- velspek:end -->\n`,
    'a second start': (agents) => `${agents}\n${start.exec(agents)[0]}\n`,
    'the end before the start': (agents) => agents.replace('<!-- velspek:end -->', '').replace(start, (marker) => `<!-- velspek:end -->\n\n${marker}`),
  };
  for (const [name, damage] of Object.entries(damages)) {
    inProject(({ root, read, write }) => {
      install(root);
      write('AGENTS.md', damage(read('AGENTS.md')));
      write('docs/specs/README.md', 'a change the run would report\n');
      const before = snapshot(root);
      assert.throws(() => install(root, { force: true }), /velspek markers/, name);
      assert.throws(() => uninstall(root, { force: true }), /velspek markers/, name);
      assert.deepEqual(snapshot(root), before, name);
    });
  }
});

test('a reinstall puts the block back before the section 9 the project filled', () => {
  inProject(({ root, read, write }) => {
    install(root);
    write('AGENTS.md', edit(read('AGENTS.md'), ['- Stack and versions:', '- Stack and versions: Go 1.23']));
    const filled = read('AGENTS.md');
    uninstall(root);
    reports(install(root), 'the block was put before the section 9');
    assert.equal(read('AGENTS.md'), filled);
    assert.deepEqual(install(root), []);
  });
  inProject(({ root, read, write }) => {
    write('AGENTS.md', '# Ours\n\n## 9. Deployment\n\nBy hand.\n');
    install(root);
    assert.ok(read('AGENTS.md').startsWith('# Ours\n\n## 9. Deployment\n\nBy hand.\n\n<!-- velspek:start'));
    assert.equal(count(read('AGENTS.md'), '## 9. Project-specific'), 1);
  });
  inProject(({ root, write }) => {
    write('AGENTS.md', '# Ours\n\n## 9. Project-specific\n\n- a\n\n## 9. Project-specific\n\n- b\n');
    assert.throws(() => install(root), /two sections '## 9\. Project-specific'/);
    assert.deepEqual(readdirSync(root), ['AGENTS.md']);
  });
});

test('a damaged manifest stops the run before anything is touched', () => {
  const damages = {
    'not JSON': () => '{',
    'no files': (manifest) => JSON.stringify({ ...manifest, files: [] }),
    'an unknown tool': (manifest) => JSON.stringify({ ...manifest, tools: ['cursor'] }),
    'a checksum that is no text': (manifest) => JSON.stringify({ ...manifest, files: { 'docs/specs/README.md': 1 } }),
    'rules that are no list': (manifest) => JSON.stringify({ ...manifest, settings: { allow: 'all', deny: [] } }),
    'a path above the project': (manifest) => JSON.stringify({ ...manifest, files: { ...manifest.files, '../outside.txt': sha('mine\n') } }),
    'a path through the project and out': (manifest) => JSON.stringify({ ...manifest, files: { 'docs/../../outside.txt': sha('mine\n') } }),
  };
  for (const [name, damage] of Object.entries(damages)) {
    inProject(({ root: parent, read, write }) => {
      const root = join(parent, 'project');
      mkdirSync(root);
      install(root);
      write('outside.txt', 'mine\n');
      write('project/.velspek.json', damage(JSON.parse(read('project/.velspek.json'))));
      const before = snapshot(parent);
      assert.throws(() => install(root, { force: true }), /\.velspek\.json/, name);
      assert.throws(() => uninstall(root, { force: true }), /\.velspek\.json/, name);
      const failed = run('uninstall', root, '--force');
      assert.equal(failed.status, 1, name);
      assert.match(failed.stderr, /^velspek: \.velspek\.json/, name);
      assert.deepEqual(snapshot(parent), before, name);
    });
  }
});

test('a file where the kit needs a folder stops the run before anything is written', () => {
  inProject(({ root, write }) => {
    write('.agents', 'ours\n');
    assert.throws(() => install(root, { dryRun: true }), /\.agents is a file/);
    assert.throws(() => install(root), /\.agents is a file/);
    assert.deepEqual(readdirSync(root), ['.agents']);
  });
});

test('a run that failed halfway is completed by the next one', { skip: process.platform === 'win32' || process.getuid() === 0 }, () => {
  inProject(({ root, read, write, has }) => {
    mkdirSync(join(root, '.agents'));
    chmodSync(join(root, '.agents'), 0o555);
    assert.throws(() => install(root), /EACCES/);
    assert.ok(has('docs/specs/README.md') && !has('.velspek.json'));
    chmodSync(join(root, '.agents'), 0o755);
    install(root);
    assert.deepEqual(install(root), []);
    assert.deepEqual(check(root), []);

    const manifest = JSON.parse(read('.velspek.json'));
    manifest.files['docs/specs/README.md'] = sha('as installed before\n');
    manifest.files['docs/adr/_template.md'] = sha('as installed before\n');
    write('docs/adr/_template.md', 'as installed before\n');
    write('.velspek.json', JSON.stringify(manifest));
    assert.deepEqual(install(root), ['updated  docs/adr/_template.md', 'updated  .velspek.json']);
    assert.deepEqual(install(root), []);

    rmSync(join(root, 'docs/specs'), { recursive: true });
    rmSync(join(root, '.claude/skills'), { recursive: true });
    uninstall(root);
    assert.deepEqual(readdirSync(root), ['.gitignore']);
  });
});

test('uninstall takes no --only, and dropping one tool is an update', () => {
  inProject(({ root, read, write, has }) => {
    install(root);
    const settings = JSON.parse(read('.claude/settings.json'));
    settings.permissions.allow.push('Bash(npm test)');
    write('.claude/settings.json', JSON.stringify(settings));
    const before = snapshot(root);
    for (const tool of ['claude', 'codex']) {
      const failed = run('uninstall', root, '--only', tool);
      assert.equal(failed.status, 1);
      assert.match(failed.stderr, /update --only/);
    }
    assert.deepEqual(snapshot(root), before);
    install(root, { only: 'codex' });
    assert.ok(!has('.claude/skills') && has('.agents/skills/spec/SKILL.md'));
    assert.deepEqual(JSON.parse(read('.claude/settings.json')).permissions, { allow: ['Bash(npm test)'], deny: [] });
    assert.deepEqual(JSON.parse(read('.velspek.json')).settings, { allow: [], deny: [] });
  });
});

test('--only codex leaves the Claude settings unread', () => {
  inProject(({ root, read, write }) => {
    write('.claude/settings.json', '{ // comment\n}');
    const done = run('init', root, '--only', 'codex');
    assert.equal(done.status, 0, done.stderr);
    assert.doesNotMatch(done.stdout, /\.claude/);
    assert.equal(read('.claude/settings.json'), '{ // comment\n}');
  });
  inProject(({ root }) => assert.match(run('init', root).stdout, /2\. For each protected branch other than main, mirror the deny rules in \.claude\/settings\.json/));
});

test('init names the documents of the project that the check does not accept', () => {
  inProject(({ root, read, write }) => {
    write('docs/adr/0001-record-architecture-decisions.md', '# 1. Record architecture decisions\n');
    write('docs/specs/overview.md', '# Overview\n');
    const done = run('init', root);
    assert.equal(done.status, 0, done.stderr);
    assert.match(done.stdout, /docs\/specs\/overview\.md: no front matter/);
    assert.match(done.stdout, /docs\/adr\/0001-record-architecture-decisions\.md: no front matter/);
    assert.equal(read('docs/specs/overview.md'), '# Overview\n');
    assert.doesNotMatch(run('init', root, '--dry-run').stdout, /no front matter/);
  });
  inProject(({ root }) => assert.doesNotMatch(run('init', root).stdout, /problem/));
});
