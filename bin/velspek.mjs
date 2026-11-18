#!/usr/bin/env node
// velspek: installs, updates and removes the spec-driven development kit in a repository.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { check } from '../template/docs/specs/_tools/check.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(KIT, 'template');
const VERSION = JSON.parse(readFileSync(join(KIT, 'package.json'), 'utf8')).version;
const MANIFEST = '.velspek.json';
const TOOLS = ['claude', 'codex'];
const SETTINGS = '.claude/settings.json';
// Sections 0–8 of AGENTS.md live between the two markers; everything outside them belongs to the project.
const START = /<!-- velspek:start[^>]*-->/;
const END = /<!-- velspek:end -->/;
const BLOCK = new RegExp(`${START.source}[\\s\\S]*${END.source}`);
const BLOCK_AND_GAP = new RegExp(`${BLOCK.source}(\\r?\\n)*`);
const SECTION_9 = /^## 9\. Project-specific[ \t]*\r?$/gm;
const CODEX_POLICY = 'policy:\n  allow_implicit_invocation: false\n';
const USAGE = `velspek ${VERSION}: a spec-driven development kit for AI coding agents

Usage: npx velspek <command> [directory] [options]

  init        install the kit into the directory (default: the current one)
  update      bring an installed kit to this version
  uninstall   remove the kit; specs, ADRs and investigations stay

  --dry-run            show what would change, write nothing
  --force              overwrite or remove kit files that were changed locally
  --only <tool>        init, update: install the skills of one tool, claude or codex`;

// A checkout may turn line endings into CRLF. Text is compared and hashed with LF, and written with the endings its file has.
const lf = (text) => text.replace(/\r\n/g, '\n');
const withEndingsOf = (file, text) => (file.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text);
const sha = (text) => createHash('sha256').update(lf(text)).digest('hex');
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
const template = (path) => lf(readFileSync(join(TEMPLATE, path), 'utf8'));

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

// The record of an earlier install, or null. It names the files a run may overwrite or remove, so one that is not what `install` writes stops the run.
function readManifest(root) {
  const text = readText(join(root, MANIFEST));
  if (text === null) return null;
  const damaged = (what) => new Error(`${MANIFEST} is damaged (${what}): restore it from version control and run the command again`);
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isRules = (rules) => Array.isArray(rules) && rules.every((rule) => typeof rule === 'string');
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw damaged('not valid JSON');
  }
  if (!isObject(manifest) || !isObject(manifest.files) || !isObject(manifest.settings)) throw damaged('not the record of an install');
  if (!Array.isArray(manifest.tools) || manifest.tools.some((tool) => !TOOLS.includes(tool))) throw damaged(`tools are not of ${TOOLS.join(', ')}`);
  if (!isRules(manifest.settings.allow) || !isRules(manifest.settings.deny)) throw damaged('settings do not list the allow and deny rules');
  for (const [path, installed] of Object.entries(manifest.files)) {
    const inside = relative(root, resolve(root, path));
    if (inside === '' || isAbsolute(inside) || inside.split(sep)[0] === '..') throw damaged(`'${path}' is not a file of this project`);
    if (typeof installed !== 'string') throw damaged(`'${path}' has no checksum`);
  }
  return manifest;
}

// A write needs every folder on the way to its file to be a folder, or absent.
function assertFolders(root, path) {
  const parts = path.split('/');
  for (let depth = 1; depth < parts.length; depth += 1) {
    const folder = parts.slice(0, depth).join('/');
    const stat = statSync(join(root, folder), { throwIfNoEntry: false });
    if (stat && !stat.isDirectory()) throw new Error(`${folder} is a file, and the kit needs a folder there for ${path}: move it away and run the command again`);
  }
}

// Collects the changes of a run and the lines of its report; nothing is written before `apply`, which first checks that every write can land.
// A run that fails while writing is completed by running the command again: each file is compared with the kit anew.
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
      for (const { path, text } of actions) if (text !== null) assertFolders(root, path);
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

// The kit's block in the text of an AGENTS.md, or null. Markers other than one start above one end stop the run: replacing between them would take the project's own text along.
function findBlock(agents) {
  const [starts, ends] = [START, END].map((marker) => agents.split(marker).length - 1);
  if (!starts && !ends) return null;
  const block = BLOCK.exec(agents);
  if (starts !== 1 || ends !== 1 || !block) throw new Error(`AGENTS.md has damaged velspek markers (${starts} start, ${ends} end): restore the one '<!-- velspek:start … -->' above and the one '<!-- velspek:end -->' below the kit's rules and run the command again`);
  return block[0];
}

function syncAgents(root, out) {
  const kit = template('AGENTS.md');
  const block = findBlock(kit);
  const current = readText(join(root, 'AGENTS.md'));
  if (current === null) return out.write('AGENTS.md', kit, 'added');
  const installed = findBlock(current);
  if (installed !== null) {
    if (lf(installed) !== block) out.write('AGENTS.md', current.replace(BLOCK, () => withEndingsOf(current, block)), 'updated');
    return;
  }
  // After an uninstall the section 9 the project filled is still there, and the block goes back above it.
  const sections = current.match(SECTION_9)?.length ?? 0;
  if (sections > 1) throw new Error("AGENTS.md has two sections '## 9. Project-specific' and no velspek block: keep one and run the command again");
  if (sections === 1) {
    out.write('AGENTS.md', current.replace(SECTION_9, (heading) => `${withEndingsOf(current, `${block}\n\n`)}${heading}`), 'updated');
    out.note('note', 'AGENTS.md had no velspek block: the block was put before the section 9 it has');
    return;
  }
  out.write('AGENTS.md', `${current.trimEnd()}${withEndingsOf(current, `\n\n${kit.slice(kit.indexOf(block))}`)}`, 'updated');
  out.note('note', 'AGENTS.md had no velspek block: the block and section 9 were appended to it');
}

// Adds the kit's permission rules to the settings and returns the ones it added, so that only those are removed later.
// With `wanted` false it removes the rules added earlier, and leaves alone a file it added nothing to.
function syncSettings(root, out, added = { allow: [], deny: [] }, wanted = true) {
  const text = readText(join(root, SETTINGS));
  if (!wanted && (text === null || added.allow.length + added.deny.length === 0)) return { allow: [], deny: [] };
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

// The missing lines go above the project's own: the last matching line of a .gitignore decides, so the project's rules and exceptions keep their effect.
function syncGitignore(root, out) {
  const wanted = template('gitignore').split('\n').filter(Boolean);
  const current = readText(join(root, '.gitignore'));
  if (current === null) return out.write('.gitignore', `${wanted.join('\n')}\n`, 'added');
  const present = new Set(current.split('\n').map((line) => line.trim()));
  const missing = wanted.filter((line) => !present.has(line));
  if (missing.length) out.write('.gitignore', `${withEndingsOf(current, `${missing.join('\n')}\n`)}${current}`, 'updated');
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
    if (current !== null && lf(current) === text) {
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
  const recorded = readText(join(root, MANIFEST));
  if (recorded === null || lf(recorded) !== next) out.write(MANIFEST, next, old ? 'updated' : 'added');
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
  if (agents !== null && findBlock(agents) !== null) {
    const rest = agents.replace(BLOCK_AND_GAP, '');
    if (lf(rest) === template('AGENTS.md').replace(BLOCK_AND_GAP, '')) out.remove('AGENTS.md');
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
  if ('only' in options && command === 'uninstall') throw new Error('uninstall removes the whole kit and takes no --only; to drop one tool, run "npx velspek update --only <the tool to keep>"');
  if (!existsSync(root)) throw new Error(`no directory ${root}`);
  if (command === 'update' && !readManifest(root)) throw new Error(`no ${MANIFEST} in ${root}: run "npx velspek init" first`);
  const report = command === 'uninstall' ? uninstall(root, options) : install(root, options);
  for (const line of report) console.log(line);
  const done = { init: 'installed', update: 'updated', uninstall: 'removed' }[command];
  console.log(report.length ? `\nvelspek ${VERSION}: ${options.dryRun ? 'dry run, nothing written' : done}` : `velspek ${VERSION}: already up to date`);
  if (command !== 'init' || options.dryRun) return;
  if (report.length) {
    const steps = ['Fill section 9 of AGENTS.md: chat language, stack, commands, ticket key, branches.'];
    if (readManifest(root).tools.includes('claude')) steps.push('For each protected branch other than main, mirror the deny rules in .claude/settings.json.');
    steps.push('Open a new agent session and check that AGENTS.md is loaded (docs/specs/README.md, "Tooling").');
    console.log(`\nNext:\n${steps.map((step, index) => `  ${index + 1}. ${step}`).join('\n')}`);
  }
  const problems = check(root);
  if (problems.length) {
    console.log(`\nThe check the skills run, node docs/specs/_tools/check.mjs, reports ${problems.length} problem(s) in this project:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
    console.log('It reads the documents under docs/specs, docs/adr and docs/investigations as specs, ADRs and investigations (docs/specs/README.md, "Tooling"). Nothing was changed in them.');
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
