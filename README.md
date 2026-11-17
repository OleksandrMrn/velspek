# velspek

A spec-driven development kit for AI coding agents. It gives Claude Code and Codex one set of rules, four skills and approvals that live in files, so the agent stops guessing and over-building, and a decision outlives the session it was made in.

```bash
npx velspek init
```

## What it solves

| The pain | What the kit does |
|---|---|
| The agent treats "fix it" as approval of its own plan, or forgets the approval in the next session | Approval is `status: approved` in the spec file, set by a person. It survives sessions, tools and context resets, and the rules name approved files as the only documents an agent takes commands from. |
| It patches a mismatch with an adapter, a fallback or a default value | A compatibility layer needs an approved spec that names it. A mismatch between layers is raised, not hidden. |
| One giant diff that nobody can review | The work is split into sessions sized for one run. The agent stops after each, and a person checks it before the next. |
| "Done" that nobody ran | Verified means executed. Every report says what was run, what was not and why. |
| Drive-by refactors and scope creep | A minimal change within the agreed scope. Everything else goes into the report, not into the diff. |
| A guess where a question was needed | What the code defines is looked up; what only you can decide is asked, with options and a recommendation. |
| Paperwork for every typo | A spec is needed only when a trigger applies: a public contract, several modules, data, a dependency, a production risk. Small changes go without documents, under the same rules. |

A rules file such as `.cursorrules` or a plain `CLAUDE.md` tells an agent how to behave. This kit adds what a rules file alone does not have: decisions recorded where the next session finds them, and points where the agent stops and a person decides.

It is Markdown and one small script: no server, no runtime dependency, no lock-in to a language or stack.

## How it works

1. `/investigate <slug> <the idea in one sentence>`: for an idea with no ticket yet. Rounds of research and questions end in recorded decisions and a roadmap in `docs/investigations/<slug>/`, from which tickets are cut.
2. `/spec <TICKET> [short title]`: one file, `docs/specs/<TICKET>-<slug>.md`, with what changes and why together with how: requirements with their checks, constraints, the approach on facts with file references, and the tasks split into sessions. A person approves it by setting `status: approved`.
3. `/implement <TICKET> [S<n> | T<n>] [what to fix]`: one session per run, with scoped verification after each task, a self-review at the end and the results written into the spec. A person checks the result between sessions.
4. `/review [<TICKET>] [local | HEAD | <branch>] [what the change is for]`: the change against the spec, or against the project rules when there is no spec. It reports findings and changes nothing.

In Codex the same skills are `$investigate`, `$spec`, `$implement` and `$review`. Agents never commit, push or open pull requests on their own.

A finished example is in [template/docs/specs/_example/](template/docs/specs/_example/); the rules are in [template/AGENTS.md](template/AGENTS.md), the process in [template/docs/specs/README.md](template/docs/specs/README.md).

## Install

In the root of your repository, with Node 18 or later:

```bash
npx velspek init
```

Then:

1. Fill section 9 of `AGENTS.md`: chat language, stack, commands, the ticket key format, the integration branch and the protected branches.
2. For each protected branch other than `main`, add the same deny rules as for `main` to `.claude/settings.json`.
3. Open a new agent session and check that `AGENTS.md` is loaded; `docs/specs/README.md`, "Tooling", says how.

What `init` does with files you already have:

| File | What happens |
|---|---|
| `AGENTS.md` | Your text stays. The kit's rules are appended as one block between `<!-- velspek:start -->` and `<!-- velspek:end -->`, followed by section 9 for the project specifics. |
| `.claude/settings.json` | The kit's allow and deny rules are added to yours; nothing is removed. |
| `.gitignore` | Missing lines are appended. |
| Specs, ADRs, investigations | Never touched. |

Later:

```bash
npx velspek update
```

```bash
npx velspek uninstall
```

`update` replaces the block in `AGENTS.md` and the kit's own files; a file you changed locally is kept and reported. `uninstall` removes what was installed and leaves your documents, section 9 and `.gitignore`. Both read `.velspek.json`, the record of what was installed, so commit it.

| Option | Effect |
|---|---|
| `--dry-run` | show what would change, write nothing |
| `--force` | overwrite or remove kit files that were changed locally |
| `--only claude` or `--only codex` | install the skills of one tool |

## What gets installed

```
AGENTS.md                         rules for agents; section 9 is yours
.claude/settings.json             shared Claude Code permissions
.claude/skills/<skill>/SKILL.md   the four skills for Claude Code
.agents/skills/<skill>/           the same skills for Codex
docs/specs/README.md              the process: steps, sessions, statuses, review findings
docs/specs/_template/spec.md      the spec template
docs/specs/_example/              a finished fictional ticket
docs/specs/_tools/check.mjs       structural check of specs, ADRs and investigations
docs/adr/_template.md             architecture decision records
docs/investigations/              the investigation process and its templates
.velspek.json                     what was installed, for update and uninstall
```

`node docs/specs/_tools/check.mjs` prints every structural problem of the specs, ADRs and investigations and exits with 1, or prints `ok`. The skills run it before they report.

## Developing the kit

`template/` is what gets installed; each skill has one source in `template/skills/`, from which the installer writes the Claude Code and the Codex copy. `bin/velspek.mjs` is the installer.

```bash
npm test
```

A rule has one home: `template/AGENTS.md` for the rules, the two READMEs under `template/docs/` for the process, the templates for the document formats. A skill applies them and a README explains them; neither redefines them.

## Author and license

Made by OleksandrMrn. Released under the MIT License, see [LICENSE](LICENSE).
