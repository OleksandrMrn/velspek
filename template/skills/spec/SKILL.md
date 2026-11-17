---
name: spec
description: Create or update the spec for a ticket in docs/specs, what and why together with how, following docs/specs/README.md. Use only when invoked explicitly.
argument-hint: "<TICKET> [short title]"
disable-model-invocation: true
---

Write or update the spec for the ticket given with the invocation (`$ARGUMENTS`: `<TICKET>` and an optional short title). One file holds what changes and why together with how, and a person approves it once (`docs/specs/README.md`).

1. Read `AGENTS.md` (sections 1 to 3 and 7 to 9), `docs/specs/README.md`, `docs/specs/_template/spec.md` and the accepted ADRs in `docs/adr/` that apply to the ticket's scope.
2. Find the spec: `docs/specs/<TICKET>-*.md`. None → create `docs/specs/<TICKET>-<slug>.md` from the template with `status: draft`; `<slug>` is the branch title in snake_case, and the file is never renamed. Several → stop and ask which one belongs to the ticket. One → update it. A `rejected` spec is not updated: stop and say so; the person reopens it by setting `status: draft`. In an `approved` or `implemented` spec a change of requirements, scope or approach sets `status: draft`, unticks every task whose finished work no longer matches and clears the "Checked" of its session, with "Log" kept as history; small corrections (typos, wording, links) and regrouping sessions that have not started keep the status (`docs/specs/README.md`, "Statuses").
3. Investigate what the ticket touches: the files that will change and the ones that call them (AGENTS.md section 5), the configs per environment, the tests nearby and existing compatibility layers (AGENTS.md section 3). Change no file outside `docs/specs/`.
4. Write "Why", "Scope" and "Requirements": the requirements numbered and testable, each with the check that shows it is met. What only the reviewer can decide goes into "Open questions"; do not guess. If an open question changes the requirements or the approach, stop here: report (step 7) and finish the spec in a later run, once it is answered.
5. Write the rest.
   - "Constraints": the contracts that change, as concrete files and keys per environment, or "none"; the accepted ADRs that apply, each with the constraint it sets, and any the change would contradict, named in "Open questions" too (`docs/specs/README.md`, "ADRs"); the existing data and behavior that must stay; for a production-risky or irreversible change the recovery scenario of AGENTS.md section 8.
   - "Approach": the facts it rests on with `path:line`, the decision and why it beats the alternatives, and every compatibility layer the change adds or keeps.
   - "Tasks": ordered, each mapped to requirements and naming its files, grouped into sessions as `docs/specs/README.md`, "Sessions", describes, each session with its "Check".
   - "Verification": the commands of AGENTS.md section 9 scoped to the change, with expected results, and the manual checks.
6. Apply the writing rules of AGENTS.md section 7: only the lines that apply, nothing copied from the template's instructions. Then run `node docs/specs/_tools/check.mjs` and fix what it reports about this spec; if it cannot be run, say so.
7. Report the path of the spec, the proposed sessions, the open questions and the trade-offs the reviewer must decide, then stop. No code changes. Approval is given by a person, by setting `status: approved`, `approved_by` and `date` in the file.
