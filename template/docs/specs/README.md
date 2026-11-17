# Spec-driven development

How ticketed work is specified and implemented in this repository, by people and AI agents alike. The rules for agents are in [AGENTS.md](../../AGENTS.md); this document describes the process those rules refer to.

## Before a ticket

An idea that has no ticket yet, or a ticket that turns out to be a project, is investigated first with `/investigate <slug>` ([docs/investigations/README.md](../investigations/README.md)). An investigation is input for specs, not an instruction for agents.

## When a spec is required

A ticket gets a spec when any of these applies:

- a trigger of AGENTS.md section 2.3: a public contract changes, layers disagree, a dependency is added or upgraded, several materially different solutions exist, more than one module is affected or data must migrate, the change is irreversible or production-risky;
- a project trigger of AGENTS.md section 9 (Conventions);
- the person or the reviewer asks for one.

## Without a spec

Everything else (small bug fixes, text changes, visual tweaks) is given to the agent as a task in chat, with or without a ticket, and done under AGENTS.md: pre-flight check, investigation, minimal change, verification, self-review, report. Nothing is written under `docs/specs/`. `/review [what the change is for]` checks the uncommitted changes, or with `HEAD` or a branch name committed work, against the project rules, the ADRs that apply and the stated purpose, and checks that the change meets none of the triggers above. Fixes are given as the next task and reviewed again. The moment a trigger appears, in the task or in the review, the work stops and a spec is written; what was done so far is input for it, not an instruction.

## The spec file

One file per ticket, `docs/specs/<TICKET>-<slug>.md`, written from `_template/spec.md`: what changes and why, together with how. `<TICKET>` is the ticket key (AGENTS.md section 9) and `<slug>` the branch title in snake_case when the file is created: `ABC-123-fix_login_redirect.md` for branch `ABC-123/fix_login_redirect`. The name is fixed at creation and does not follow later branch renames. The skills find the file by `docs/specs/<TICKET>-*.md`: none → `/spec` creates it; one → every skill uses it; several → the skills stop and ask. `_example/` holds a finished fictional ticket.

A spec follows the writing rules of AGENTS.md section 7: only the lines that apply, about 80 lines for a usual ticket. One that grows well beyond that is probably several tickets.

## Steps

1. **Spec.** `/spec <TICKET>` (`$spec <TICKET>` in Codex) or the developer writes the file, status `draft`. When an open question changes the requirements or the approach, `/spec` stops after the requirements and finishes the spec once the question is answered.
2. **Approval.** The reviewer (a lead or a designated reviewer) reads the spec, resolves the open questions and any conflict with an accepted ADR (see ADRs) and sets `status: approved`, `approved_by` and `date`. From then on agents treat the spec as an instruction (AGENTS.md section 0); until then there are no code changes (section 2.3).
3. **Implementation.** `/implement <TICKET>` or by hand, one session per run (see Sessions). The spec becomes `implemented` only when every task is ticked and the whole verification has passed; the only failures allowed are the known baseline of AGENTS.md section 9, named in "Log". Agents do not commit or open PRs on their own: after the last session `/implement` asks, and either happens only on an explicit yes (AGENTS.md section 6). A PR targets the integration branch (section 9) and links the spec.
4. **Review.** `/review <TICKET>` checks the diff of the current or a named branch against the integration branch on the remote, or with `local` the uncommitted changes, against the spec read at the same revision; the requirements of sessions not yet done are pending, not findings. Then a person reviews the change. Fixes within the approved scope go through `/implement` again: the spec is `implemented` again only when they are in and the checks pass, otherwise it goes back to `approved` with the affected tasks unticked, the approval itself staying. A finding that changes requirements, scope or approach goes back to the spec (see Statuses).
5. **After the merge.** Nothing is set: `implemented` is the last status. A decision that outlives the ticket (architecture, contracts, conventions) becomes an ADR in `docs/adr/`.

## Sessions

A spec is implemented in sessions: one `/implement` run each, in order, with a person's check between them. One run stays within what an agent can hold in its context, and the person sees the work in pieces instead of once at the end.

- **Split.** `/spec` proposes it and the reviewer approves it with the spec. The tasks are numbered through the whole spec and grouped under `### S<n>` headings. A session ends in a state the person can check: the project's checks pass and a slice of the change works, not half a function. It is sized for one run, usually three to five tasks; up to five tasks are one session unless a check is needed in the middle. A production-risky task (AGENTS.md section 8) is the last of its session, so it is checked right after it. "Check" names what the person verifies before the next session.
- **Run.** `/implement` takes the first session with an unticked task, or the one named with `S<n>`, and only when every earlier session has "Checked" filled; a single task `T<n>` runs without that. A task is ticked only when its scoped verification has passed. A run ends with the self-review of AGENTS.md section 2.6 and one entry in "Log"; then the agent reports what the person checks and stops. The next session is a new run, as a rule in a fresh conversation, so it starts from the spec and not from the earlier context. When every task is ticked and the spec is still `approved`, the run finishes it: the whole verification, the self-review against all requirements and, when all passes, `implemented`.
- **Check.** The person checks the result and fills "Checked" as `<name>, <YYYY-MM-DD>`; whether to commit then is the person's call. The status stays `approved` between sessions: the ticked tasks show what is done.
- **Fixes.** A problem found in the check or the review goes back as a fixes run (`/implement <TICKET> S<n> <what to fix>`). A ticked task that a run changes is unticked first and the "Checked" of its session cleared, and ticked again when the fix is verified. A fixes run may touch several sessions, the one exception to one session per run, and every session it touches is checked again. A problem that changes requirements, scope or approach goes back to the spec (see Statuses).
- **Regrouping.** Regrouping sessions that have not started resets nothing; the person does it, or asks `/spec` to.
- **Interrupted run.** It is resumed from what is on disk, the ticks, "Log" and the diff, not from memory (AGENTS.md section 2.4). A run that stops on purpose before its work is done writes the unfinished action and the next command or check into "Log".

## Review findings

A finding of a review, by `/review` or by a person, names the file and place, what is wrong, what the spec, the rule or the stated purpose expects, and the evidence: a test that was run or a scenario traced through the code. Assumptions and wishes are listed apart from the defects. Severity says what the consequence is and how far it reaches; what must be fixed is a separate question, answered below the table:

| Severity | Meaning |
|---|---|
| P0 | data loss, a security hole or an outage for the users |
| P1 | wrong behavior for users or for other code: a requirement is not met, a contract is broken |
| P2 | wrong behavior with a limited effect: an edge case, a wrong text, something a workaround covers |
| P3 | no effect on behavior: a comment, a name, dead code, the structure of the code |

Fixed before the merge: every P0 and P1, and every finding of any severity that is a requirement or a rule of AGENTS.md not met, a P3 too. A P2 or P3 that breaks no rule may go into a named follow-up or stay; the author decides. A check of AGENTS.md section 9 that fails because of the change blocks the merge whatever the severity of its cause; the failures of the known baseline of section 9 do not. Wishes, improvements and a reviewer's stylistic preference are not defects and get no severity: they are listed apart.

## Statuses

| Status | Meaning |
|---|---|
| `draft` | being written, or changed after approval; not an instruction for agents |
| `approved` | approved by the reviewer; agents implement it. Also the state between sessions and of an unfinished implementation or fix: the unticked tasks show what is open |
| `implemented` | every task ticked and the whole verification passed, the known baseline of AGENTS.md section 9 excepted; the approval stays in force for fixes within the approved scope |
| `rejected` | will not happen; kept for history |

A change of requirements, scope or approach in an `approved` or `implemented` spec resets it to `draft`, and the changed version is approved again. Every task whose finished work no longer matches the new version is unticked and the "Checked" of its session cleared, so `/implement` does it again and the person checks it again; "Log" stays as history. Small corrections (typos, wording, links) reset nothing. Neither does the bookkeeping of implementation: ticking tasks, filling "Checked" and writing "Log" do not touch the approval. A draft is created and edited freely; writing it is how approval is requested, not a code change (AGENTS.md section 2.3). `/spec` stops on a `rejected` spec; the person reopens it by setting `status: draft`. New work on a merged ticket is as a rule a new ticket with its own spec.

## ADRs

Accepted ADRs in `docs/adr/` are instructions for agents and rank after the approved spec of a ticket (AGENTS.md section 0). A file is named `0001-<slug>.md` (AGENTS.md section 9).

- The spec lists under "Constraints" the accepted ADRs that apply to its scope; `/spec`, `/implement` and `/review` read them.
- An approved spec agrees with the accepted ADRs. A spec that would contradict one names it under "Constraints" and in "Open questions". Before approval the reviewer either changes the spec or accepts a new ADR that supersedes the old one: the new ADR has `supersedes: <old id>`, the old one gets `status: superseded`.
- A conflict found later, while implementing or reviewing, stops the work until it is resolved the same way.

## Tooling

- **Claude Code.** The skills `/spec`, `/implement`, `/review` and `/investigate` live in `.claude/skills/` and are invoked explicitly only. Shared permissions are in `.claude/settings.json`; personal overrides go to the untracked `.claude/settings.local.json`.
- **Codex.** The same skills live in `.agents/skills/` and are invoked as `$spec <TICKET>` or picked from `/skills`. `npx velspek update` writes both sets from one source; a skill changed locally is kept and reported, and no longer follows the kit. Codex reads `AGENTS.md` natively and caps the combined size of `AGENTS.md` files at 32 KiB by default.
- **`AGENTS.md` in Claude Code.** Claude Code reads `AGENTS.md` itself only when there is no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the working directory or above it, and not in every version and setup ([docs](https://code.claude.com/docs/en/memory#when-claude-code-reads-agents-md)). After installing the kit, open a new session and check: it prints `AGENTS.md loaded: <path>` at the start, and `/memory` lists the file. If it is not read, import it: a tracked `CLAUDE.md` next to `AGENTS.md` whose first line is `@AGENTS.md`, or the same line in an untracked `CLAUDE.local.md` for you only.
- **Permissions.** The deny rules in `.claude/settings.json` cover the usual forms of force pushes, pushes to `main`, branch deletion, `reset --hard`, `commit --amend`, `rebase`, `clean`, `rm -rf` and reads of `.env` files. They match the command text ([docs](https://code.claude.com/docs/en/permissions#bash)), so they are a safety net for the commands an agent usually writes, not a protection boundary: they do not catch `git push` with no refspec while `main` is checked out, git started another way (`git -C <dir> push`, `sh -c '…'`, aliases), combined short flags such as `-uf`, or other commands with a similar effect (`git restore`, `git stash drop`, `rm -r`). Protected branches need branch protection on the remote; limits on files and network need sandboxing. For each protected branch of AGENTS.md section 9 other than `main`, add the same rules as for `main`.
- **Check.** `node docs/specs/_tools/check.mjs` (Node 18 or later, no dependencies) prints every problem and exits with 1, or prints `ok`; `/spec`, `/implement` and `/investigate` run it before they report. It checks the structure this document and the templates define: front matter keys and statuses, file names against tickets and ADR numbers, the approval fields, the numbering of tasks and sessions, "Check" and "Checked", and what `implemented` and a `ready` investigation need. Front matter is one unindented `key: value` per line, the value plain text without quotes, up to an optional comment that starts with ` #`. Whether a spec is sound is the reviewer's call.
