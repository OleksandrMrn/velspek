#!/usr/bin/env node
// velspek: installs, updates and removes the spec-driven development kit in a repository.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(KIT, 'template');
const VERSION = JSON.parse(readFileSync(join(KIT, 'package.json'), 'utf8')).version;
const MANIFEST = '.velspek.json';
const TOOLS = ['claude', 'codex'];
const SETTINGS = '.claude/settings.json';
// Sections 0–8 of AGENTS.md live between the two markers; everything outside them belongs to the project.
const BLOCK = /<!-- velspek:start[^>]*-->[\s\S]*<!-- velspek:end -->/;
const BLOCK_AND_GAP = new RegExp(`${BLOCK.source}\\n*`);
const CODEX_POLICY = 'policy:\n  allow_implicit_invocation: false\n';
const USAGE = `velspek ${VERSION}: a spec-driven development kit for AI coding agents

Usage: npx velspek <command> [directory] [options]

  init        install the kit into the directory (default: the current one)
  update      bring an installed kit to this version
  uninstall   remove the kit; specs, ADRs and investigations stay

  --dry-run            show what would change, write nothing
  --force              overwrite or remove kit files that were changed locally
  --only <tool>        install the skills of one tool: claude or codex`;

const sha = (text) => createHash('sha256').update(text).digest('hex');
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
const template = (path) => readFileSync(join(TEMPLATE, path), 'utf8');

function walk(dir, prefix = '') {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return walk(dir, `${prefix}${entry.name}/`);
    return entry.name === '.DS_Store' ? [] : [`${prefix}${entry.name}`];
  });
}

// The files the kit owns in a repository, by path. The Codex copy of a skill is the Claude copy without the two Claude-only keys.
function payload(tools) {
  const files = new Map(walk(join(TEMPLATE, 'docs')).sort().map((path) => [`docs/${path}`, template(`docs/${path}`)]));
  for (const name of walk(join(TEMPLATE, 'skills')).sort().map((path) => dirname(path))) {
    const skill = template(`skills/${name}/SKILL.md`);
    if (tools.includes('claude')) files.set(`.claude/skills/${name}/SKILL.md`, skill);
    if (tools.includes('codex')) {
      files.set(`.agents/skills/${name}/SKILL.md`, skill.replace(/^(argument-hint|disable-model-invocation):.*\n/gm, ''));
      files.set(`.agents/skills/${name}/agents/openai.yaml`, CODEX_POLICY);
    }
  }
  return files;
}

function readManifest(root) {
  const text = readText(join(root, MANIFEST));
  return text === null ? null : JSON.parse(text);
}

// Collects the changes of a run and the lines of its report; nothing is written before `apply`.
function output(root, dryRun) {
  const actions = [];
  return {
    report: [],
    note(what, text) {
      this.report.push(`${what.padEnd(8)} ${text}`);
    },
    write(path, text, what) {
      actions.push({ path, text });
      this.note(what, path);
    },
    remove(path) {
      actions.push({ path, text: null });
      this.note('removed', path);
    },
    apply() {
      if (dryRun) return;
      for (const { path, text } of actions) {
        const file = join(root, path);
        if (text !== null) {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, text);
          continue;
        }
        rmSync(file);
        for (let dir = dirname(file); dir !== root && readdirSync(dir).length === 0; dir = dirname(dir)) rmdirSync(dir);
      }
    },
  };
}

function syncAgents(root, out) {
  const kit = template('AGENTS.md');
  const block = BLOCK.exec(kit)[0];
  const current = readText(join(root, 'AGENTS.md'));
  if (current === null) return out.write('AGENTS.md', kit, 'added');
  if (BLOCK.test(current)) {
    if (BLOCK.exec(current)[0] !== block) out.write('AGENTS.md', current.replace(BLOCK, () => block), 'updated');
    return;
  }
  out.write('AGENTS.md', `${current.trimEnd()}\n\n${kit.slice(kit.indexOf(block))}`, 'updated');
  out.note('note', 'AGENTS.md had no velspek block: the block and section 9 were appended to it');
}

// Adds the kit's permission rules to the settings and returns the ones it added, so that only those are removed later.
// With `wanted` false it removes the rules added earlier.
function syncSettings(root, out, added = { allow: [], deny: [] }, wanted = true) {
  const text = readText(join(root, SETTINGS));
  if (text === null && !wanted) return { allow: [], deny: [] };
  const kit = wanted ? JSON.parse(template('claude/settings.json')).permissions : { allow: [], deny: [] };
  let settings;
  try {
    settings = text === null ? {} : JSON.parse(text);
  } catch {
    throw new Error(`${SETTINGS} is not valid JSON: fix it and run the command again`);
  }
  const permissions = { ...settings.permissions };
  const mine = { allow: [], deny: [] };
  let changed = text === null;
  for (const kind of ['allow', 'deny']) {
    const rules = (permissions[kind] ?? []).filter((rule) => !added[kind].includes(rule) || kit[kind].includes(rule));
    changed ||= rules.length !== (permissions[kind] ?? []).length;
    for (const rule of kit[kind]) {
      if (!rules.includes(rule)) {
        rules.push(rule);
        mine[kind].push(rule);
        changed = true;
      } else if (added[kind].includes(rule)) {
        mine[kind].push(rule);
      }
    }
    if (rules.length || permissions[kind]) permissions[kind] = rules;
  }
  if (!changed) return mine;
  const rest = { ...settings, permissions };
  const empty = Object.keys(rest).length === 1 && Object.values(permissions).every((rules) => rules.length === 0);
  if (!wanted && empty) out.remove(SETTINGS);
  else out.write(SETTINGS, `${JSON.stringify(rest, null, 2)}\n`, text === null ? 'added' : 'updated');
  return mine;
}

function syncGitignore(root, out) {
  const wanted = template('gitignore').split('\n').filter(Boolean);
  const current = readText(join(root, '.gitignore'));
  if (current === null) return out.write('.gitignore', `${wanted.join('\n')}\n`, 'added');
  const present = new Set(current.split('\n').map((line) => line.trim()));
  const missing = wanted.filter((line) => !present.has(line));
  if (missing.length) out.write('.gitignore', `${current.trimEnd()}\n${missing.join('\n')}\n`, 'updated');
}

// `init` and `update`: writes the kit's files, keeps the ones changed locally, and records what it installed.
export function install(root, { dryRun = false, force = false, only } = {}) {
  const old = readManifest(root);
  const tools = only ? [only] : old?.tools ?? TOOLS;
  const out = output(root, dryRun);
  const manifest = { version: VERSION, tools, files: {}, settings: { allow: [], deny: [] } };
  const files = payload(tools);
  for (const [path, text] of files) {
    const current = readText(join(root, path));
    const installed = old?.files[path];
    if (current === text) {
      manifest.files[path] = sha(text);
    } else if (current === null || force || sha(current) === installed) {
      out.write(path, text, current === null ? 'added' : 'updated');
      manifest.files[path] = sha(text);
    } else {
      out.note('kept', `${path} (changed locally; --force overwrites it)`);
      if (installed) manifest.files[path] = installed;
    }
  }
  for (const [path, installed] of Object.entries(old?.files ?? {})) {
    const current = files.has(path) ? null : readText(join(root, path));
    if (current === null) continue;
    if (force || sha(current) === installed) out.remove(path);
    else out.note('kept', `${path} (no longer in the kit, changed locally)`);
  }
  syncAgents(root, out);
  manifest.settings = syncSettings(root, out, old?.settings, tools.includes('claude'));
  syncGitignore(root, out);
  const next = `${JSON.stringify(manifest, null, 2)}\n`;
  if (readText(join(root, MANIFEST)) !== next) out.write(MANIFEST, next, old ? 'updated' : 'added');
  out.apply();
  return out.report;
}

// Removes what `install` recorded; the project's own files, section 9 of AGENTS.md and .gitignore stay.
export function uninstall(root, { dryRun = false, force = false } = {}) {
  const old = readManifest(root);
  if (!old) throw new Error(`no ${MANIFEST} in ${root}: the kit is not installed there`);
  const out = output(root, dryRun);
  for (const [path, installed] of Object.entries(old.files)) {
    const current = readText(join(root, path));
    if (current === null) continue;
    if (force || sha(current) === installed) out.remove(path);
    else out.note('kept', `${path} (changed locally; --force removes it)`);
  }
  const agents = readText(join(root, 'AGENTS.md'));
  if (agents !== null && BLOCK.test(agents)) {
    const rest = agents.replace(BLOCK_AND_GAP, '');
    if (rest === template('AGENTS.md').replace(BLOCK_AND_GAP, '')) out.remove('AGENTS.md');
    else out.write('AGENTS.md', rest, 'updated');
  }
  syncSettings(root, out, old.settings, false);
  out.remove(MANIFEST);
  out.apply();
  return out.report;
}

function main(argv) {
  const options = { dryRun: false, force: false };
  const words = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return console.log(USAGE);
    if (arg === '--version') return console.log(VERSION);
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--only') options.only = argv[(index += 1)];
    else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    else words.push(arg);
  }
  const [command, directory = '.'] = words;
  const root = resolve(directory);
  if (!['init', 'update', 'uninstall'].includes(command) || words.length > 2) throw new Error(`expected one command: init, update or uninstall\n\n${USAGE}`);
  if ('only' in options && !TOOLS.includes(options.only)) throw new Error('--only takes claude or codex');
  if (!existsSync(root)) throw new Error(`no directory ${root}`);
  if (command === 'update' && !readManifest(root)) throw new Error(`no ${MANIFEST} in ${root}: run "npx velspek init" first`);
  const report = command === 'uninstall' ? uninstall(root, options) : install(root, options);
  for (const line of report) console.log(line);
  const done = { init: 'installed', update: 'updated', uninstall: 'removed' }[command];
  console.log(report.length ? `\nvelspek ${VERSION}: ${options.dryRun ? 'dry run, nothing written' : done}` : `velspek ${VERSION}: already up to date`);
  if (command === 'init' && !options.dryRun && report.length) {
    console.log('\nNext:\n  1. Fill section 9 of AGENTS.md: chat language, stack, commands, ticket key, branches.\n  2. For each protected branch other than main, mirror the deny rules in .claude/settings.json.\n  3. Open a new agent session and check that AGENTS.md is loaded (docs/specs/README.md, "Tooling").');
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`velspek: ${error.message}`);
    process.exit(1);
  }
}
