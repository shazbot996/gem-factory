---
run: schiele/0004
at: 2026-11-05T15:35:04.517Z
mode: direct
agent: direct:general
model: agy:gemini-3.8-flash
target: null
template: direct/general
prompt-sha: 26b55e259505
template-sha: f7093a112dd1
commit: 3212a77+
attachments: []
read:
  - AGENTS.md
  - docs/plans/spa-frontend-PLAN.md
  - ls -la /tmp/cr2-worktrees/f69853eb723c-cr2-schiele-gem-factory/docs/plans
  - docs/plans/gcs-direct-write-rewrite-PLAN.md
  - docs/context/ARCH.md
  - ls -la /tmp/cr2-worktrees/f69853eb723c-cr2-schiele-gem-factory/docs/context
  - ls -la /tmp/cr2-worktrees/f69853eb723c-cr2-schiele-gem-factory/.cr2
  - .cr2/config.json
outcome: success
usage:
  input: 239130
  output: 5056
  peak: 28031
  window: 1000000
cost: 0
harness:
  provider: agy
  kind: sdk
  workspace: self
  access: build
  turns: 1
  sandbox: true
  conversation: 375009d8-4052-40f3-aac0-391c783d02c0
---

# Review: Conformance of `docs/plans/spa-frontend-PLAN.md` to CR2 Standard

### Executive Summary

[`docs/plans/spa-frontend-PLAN.md`](file:///tmp/cr2-worktrees/f69853eb723c-cr2-schiele-gem-factory/docs/plans/spa-frontend-PLAN.md) **does not conform** to the CR2 specification for document type `plan`. It is an early, freeform engineering plan created prior to the repository's CR2 setup. While comprehensive in implementation detail, both its YAML front matter and its section structure diverge significantly from the CR2 standard defined in [`.cr2/config.json`](file:///tmp/cr2-worktrees/f69853eb723c-cr2-schiele-gem-factory/.cr2/config.json).

---

### 1. Front Matter Conformance

#### CR2 Standard for `type: plan`
In CR2, collections configured with `lifecycle: true` (such as `docs/plans`) require:
- `type: plan`
- `title: <Document Title>`
- `authority: prescriptive`
- `status: <draft | active | superseded | retired>`

#### Current Front Matter in `docs/plans/spa-frontend-PLAN.md`
```yaml
---
type: plan
title: "SPA Frontend — Implementation Plan"
spec: docs/specs/spa-frontend-SPEC.md
scope: React + TypeScript SPA with Vite, Tailwind CSS, Google Identity Services auth, extension communication, gem import, and registry browser
date: 2026-04-05
---
```

#### Deficiencies & Gaps
1. **Missing `authority: prescriptive`**: CR2 requires all plan documents to explicitly declare prescriptive authority.
2. **Missing `status`**: The `status` field is required for lifecycle tracking in CR2 collection panels (`plans` has `"lifecycle": true`). Given that this document targets the retired Express + PostgreSQL stack prior to [ADR-0001](file:///tmp/cr2-worktrees/f69853eb723c-cr2-schiele-gem-factory/docs/decisions/0001-replace-sql-and-api-server-with-direct-gcs-writes.md), its accurate lifecycle status would be `superseded` or `retired`.
3. **Non-Standard Metadata Keys**: Keys such as `spec:`, `scope:`, and `date:` are ad-hoc fields not recognized by the CR2 schema.

---

### 2. Required Section Structure vs. Current Sections

#### CR2 Prescribed Sections for `type: plan`
Per [`.cr2/config.json`](file:///tmp/cr2-worktrees/f69853eb723c-cr2-schiele-gem-factory/.cr2/config.json#L458-L466), a conforming CR2 plan must contain exactly these five sections:
1. `The delta`
2. `Numbered steps, each with its files and a Done when`
3. `Choices the spec leaves open`
4. `Out of scope`
5. `Open Questions`

#### Current Sections in `docs/plans/spa-frontend-PLAN.md`
The existing document uses an 8-section breakdown:
- `## 1. Goal`
- `## 2. Context & Prior Art`
- `## 3. Implementation Steps` (Phases A–L, Steps 1–33)
- `## 4. Data Model / Schema Changes`
- `## 5. Integration Points`
- `## 6. Edge Cases & Risks`
- `## 7. Verification`
- `## 8. Open Questions`

#### Detailed Gap Analysis

| CR2 Required Section | Status in Document | Notes & Discrepancies |
| :--- | :---: | :--- |
| **The delta** | ❌ Missing | Replaced by `## 1. Goal` and `## 2. Context & Prior Art`. CR2 expects a concise statement describing the precise delta between current repository state and target state. |
| **Numbered steps, each with its files and a Done when** | ⚠️ Partial | Has numbered steps (Steps 1–33 under `## 3. Implementation Steps`), but uses an informal custom schema (`What`, `Where`, `How`, `Why`) rather than explicit target file paths and measurable `Done when` statements per step. |
| **Choices the spec leaves open** | ❌ Missing | Discussed informally under `Key decisions` in Section 2 and `8. Open Questions (Resolved)`, but lacks the required dedicated section. |
| **Out of scope** | ❌ Missing | Scope boundaries are implied or deferred to the spec rather than stated under the required heading. |
| **Open Questions** | ⚠️ Partial | Exists as `## 8. Open Questions`, but includes a `### Resolved` subsection. In CR2, resolved choices belong in `Choices the spec leaves open`; `Open Questions` is strictly reserved for unresolved blockers. |
| *Ad-hoc Extra Sections* | ❌ Non-Standard | Sections 4 (`Data Model`), 5 (`Integration Points`), 6 (`Edge Cases & Risks`), and 7 (`Verification`) are extraneous in CR2 plans. Their contents belong inside `The delta`, individual step criteria (`Done when`), or context documents (`SCHEMA.md`, `ARCH.md`). |

---

### 3. Step-Level Formatting Discrepancies

CR2 plan steps must follow a strict, actionable pattern:
- **Target Files**: Explicit path(s) to files created or modified.
- **Action**: Direct instructions on what to write or change.
- **Done when**: An explicit, testable completion gate for that step.

In [`spa-frontend-PLAN.md`](file:///tmp/cr2-worktrees/f69853eb723c-cr2-schiele-gem-factory/docs/plans/spa-frontend-PLAN.md#L55-L99), the steps currently use:
```markdown
#### Step 1 — Initialize frontend/ with Vite + React + TypeScript
- **What:** Create the frontend/ directory...
- **Where:** frontend/
- **How:** Run npm create vite@latest...
- **Why:** Establishes the project foundation...
```
Verification conditions are detached into a separate section at the end (`## 7. Verification`) rather than being inline `Done when` clauses for each step.

---

### 4. What Would Be Needed to Bring It into CR2 Conformance

1. **Update Front Matter**:
   ```yaml
   ---
   type: plan
   title: SPA Frontend — Implementation Plan
   authority: prescriptive
   status: superseded
   ---
   ```
2. **Reorganize into the 5 Standard Headings**:
   - Consolidate Section 1, Section 2, Section 4, Section 5, and Section 6 into **`## The delta`**.
   - Refactor Section 3 into **`## Numbered steps, each with its files and a Done when`**, ensuring every step names the specific files and integrates acceptance criteria from Section 7 directly into an inline `**Done when:**` line.
   - Relocate the resolved items from Section 2 (`Key decisions`) and Section 8 (`Resolved`) into **`## Choices the spec leaves open`**.
   - Add **`## Out of scope`** to define boundaries (e.g. backend changes, mobile apps).
   - Prune **`## Open Questions`** so that it contains only genuine unresolved questions.
