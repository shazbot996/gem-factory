---
run: schiele/0003
at: 2026-11-05T15:09:14.410Z
mode: direct
agent: direct:ask
model: agy:gemini-3.8-flash
target: null
template: direct/ask
prompt-sha: 11d6c54ad105
template-sha: 44af0dfef32e
commit: 3212a77+
attachments: []
read:
  - AGENTS.md
  - docs/plans/spa-frontend-PLAN.md
  - docs/plans/gcs-direct-write-rewrite-PLAN.md
  - docs/decisions/0001-replace-sql-and-api-server-with-direct-gcs-writes.md
  - docs/context/ARCH.md
  - docs/specs/spa-frontend-SPEC.md
outcome: success
usage:
  input: 320396
  output: 9128
  peak: 38477
  window: 1000000
cost: 0
harness:
  provider: agy
  kind: sdk
  workspace: self
  access: read
  turns: 1
  sandbox: false
  conversation: 70234e5f-6da8-4e01-b81e-387379c92f44
---

# Review: `docs/plans/spa-frontend-PLAN.md` Conformance to CR2

### Executive Summary

`docs/plans/spa-frontend-PLAN.md` **does not conform** to the CR2 specification for document type `plan`. It is an older, freeform engineering plan created prior to CR2 adoption. While detailed and well-written, both its YAML front matter and its section structure diverge significantly from the CR2 standard.

---

### 1. Front Matter Conformance

#### CR2 Standard for `type: plan`
The CR2 project manifest defines plans as:
- `authority: prescriptive`
- Requires standard metadata identifying type, title, authority, and lifecycle status.

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

#### Deficiencies & Deviations
1. **Missing `authority`:** CR2 specifies that plan documents must declare `authority: prescriptive` (see canonical entry points like `AGENTS.md`).
2. **Missing `status`:** CR2 documents track status (e.g., `draft`, `active`, `superseded`, or `completed`). Given that this plan targets the retired Express/Postgres backend before ADR-0001, its status would properly be `superseded` or `retired`.
3. **Non-standard attributes:** Keys like `spec:`, `scope:`, and `date:` are ad-hoc metadata not part of the standard CR2 front matter schema.

---

### 2. Section Structure & Formatting Conformance

#### CR2 Prescribed Sections for `type: plan`
The CR2 manifest dictates the following standard section sequence for plans:
1. `The delta`
2. `Numbered steps, each with its files and a Done when`
3. `Choices the spec leaves open`
4. `Out of scope`
5. `Open Questions`

#### Current Structure in `docs/plans/spa-frontend-PLAN.md`
The document currently uses an 8-section outline:
- `## 1. Goal`
- `## 2. Context & Prior Art`
- `## 3. Implementation Steps` (Phases A–L, Steps 1–33)
- `## 4. Data Model / Schema Changes`
- `## 5. Integration Points`
- `## 6. Edge Cases & Risks`
- `## 7. Verification`
- `## 8. Open Questions`

#### Comparison & Gap Analysis

| CR2 Required Section | Present in Plan? | Current Implementation / Gap |
| :--- | :--- | :--- |
| **The delta** | ❌ No | Replaced by `## 1. Goal` and `## 2. Context & Prior Art`. CR2 expects a focused statement describing the exact change between current repository state and target state. |
| **Numbered steps, each with its files and a Done when** | ⚠️ Partial | Has numbered steps (Steps 1–33 under `## 3. Implementation Steps`), but uses an informal format (`What`, `Where`, `How`, `Why`) rather than the CR2 standard requiring explicit **files** and a measurable **Done when** clause per step. |
| **Choices the spec leaves open** | ❌ No | Informally addressed under `Key decisions` in section 2 and `8. Open Questions (Resolved)`, but lacks the required standalone section. |
| **Out of scope** | ❌ No | Scope limits are not formalized under a dedicated section (partially deferred to `spa-frontend-SPEC.md`). |
| **Open Questions** | ⚠️ Partial | Exists as `## 8. Open Questions`, but is divided into `Resolved` and `Remaining`. In CR2, resolved items belong in `Choices the spec leaves open` or context; `Open Questions` is reserved strictly for unresolved blocks/decisions. |
| *Ad-hoc Extra Sections* | ❌ Non-standard | Sections 4 (`Data Model`), 5 (`Integration Points`), 6 (`Edge Cases & Risks`), and 7 (`Verification`) are non-standard sections that CR2 plans typically subsume into `The delta`, step definitions (`Done when`), or context documents (`SCHEMA.md`, `ARCH.md`). |

---

### 3. Step-Level Formatting Discrepancies

CR2 plan steps must follow a strict pattern:
- **Target Files:** Explicit list of files modified or created.
- **Implementation action:** What to write/change.
- **Done when:** An unambiguous, testable condition confirming the step succeeded.

In `spa-frontend-PLAN.md`, steps are formatted like:
```markdown
#### Step 1 — Initialize frontend/ with Vite + React + TypeScript
- **What:** Create the frontend/ directory...
- **Where:** frontend/
- **How:** Run npm create vite@latest...
- **Why:** Establishes the project foundation...
```
Verification criteria are separated into an end-of-document verification section (`## 7. Verification`) rather than being inline `Done when` gates on each step.

---

### 4. Recommendation for CR2 Import

If you decide to formally import or modernize this plan into CR2:
1. **Front Matter:** Add `authority: prescriptive` and set `status: superseded` (or `active` if adapting to direct-to-GCS).
2. **Restructure Sections:** Map the existing content into the 5 standard headers:
   - Move Section 1, 2, 4, 5, and 6 into **The delta**.
   - Refactor Section 3 into **Numbered steps**, reformulating `Where` into explicit file paths and adding **Done when** criteria to each step (moving items from Section 7).
   - Move Section 2's key decisions and Section 8's resolved questions into **Choices the spec leaves open**.
   - Add an explicit **Out of scope** section.
   - Keep only unresolved items in **Open Questions**.
