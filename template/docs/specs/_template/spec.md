---
ticket: <TICKET>
title: <short title>
status: draft            # draft | approved | implemented | rejected
approved_by:
date:
---

# <TICKET>: <short title>

## Why

The problem, with links (tracker, designs, dashboards), and what is true after the change that is not true now. Facts, not solutions.

## Scope

- In: modules, features, configs, environments.
- Out: what is not touched, even if related.

## Requirements

Numbered and testable, each with the check a reviewer or QA can observe.

- R1. <statement>. Check: <observable result>.

## Constraints

Only the lines that apply; "Contracts" always.

- Contracts: what changes in configs and file formats, API and protocols, data schema, public interfaces, events and feature flags, as concrete files and keys per environment; "none" when nothing changes.
- ADRs: the accepted ADRs that apply, each with the constraint it sets (`docs/specs/README.md`, "ADRs").
- Preserve: existing data and behavior that must stay as is: stored data and user state, other callers of the changed code, analytics.
- Risk and recovery: for a production-risky or irreversible change, the recovery scenario of AGENTS.md section 8.

## Approach

- The facts the approach rests on, each with `path:line`: what is wrong or missing, how similar things are done nearby.
- Decision: the chosen approach and, if several existed, why this one.
- Compatibility layers: every layer the change adds or keeps (AGENTS.md section 3), with its purpose and place; a layer not named here is not approved.

## Tasks

Ordered, each mapped to requirements and naming its files, grouped into sessions: one `/implement` run each, checked by a person before the next (`docs/specs/README.md`, "Sessions").

### S1: <what works after it>

- [ ] T1 (R1): <task>. Files: `<path>`.
- Check: <what the person verifies before the next session>.
- Checked:

## Verification

The commands of AGENTS.md section 9 scoped to the change, with expected results, and the manual checks.

## Open questions

What only the reviewer or stakeholders can answer. None is left at approval.

## Log

Written during implementation, one entry per run: what was verified and how, what was not and why, deviations and their reason, out-of-scope findings.

- [<YYYY-MM-DD>] S1 (T1): <results>
