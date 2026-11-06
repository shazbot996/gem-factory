---
run: schiele/0005
at: 2026-11-05T15:46:55.160Z
mode: direct
agent: direct:general
model: agy:gemini-3.8-flash
target: null
template: direct/general
prompt-sha: c524cd616184
template-sha: f7093a112dd1
commit: 3212a77+
attachments: []
read:
  - AGENTS.md
  - docs/plans/spa-frontend-PLAN.md
outcome: success
usage:
  input: 54678
  output: 3351
  peak: 20056
  window: 1000000
cost: 0
harness:
  provider: agy
  kind: sdk
  workspace: self
  access: build
  turns: 1
  sandbox: true
  conversation: 71a45944-a865-4018-97e2-33a4e9d8c70d
---

# Review: Conformance of `docs/plans/spa-frontend-PLAN.md` to the CR2 Standard

### Executive Summary

[`docs/plans/spa-frontend-PLAN.md`](file:///tmp/cr2-worktrees/f69853eb723c-cr2-schiele-gem-factory/docs/plans/spa-frontend-PLAN.md) **does not conform** to the CR2 standard for document type `plan`. It is an older, freeform engineering plan created prior to CR2 adoption. While comprehensive in technical detail, both its YAML front matter and its section structure diverge significantly from the schema defined in [`.cr2/config.json`](file:///tmp/cr2-worktrees/f69853eb723c-cr2-schiele-gem-factory/.cr2/config.json).

---

### 1. Front Matter Conformance

#### CR2 Standard for `type: plan`
For collections with `lifecycle: true` such as `docs/plans`, CR2 expects the following standard front matter:
```yaml
---
type: plan
title: <Document Title>
authority: prescriptive
status: <draft | active | superseded | retired>
---
```

#### Current Front Matter in [`spa-frontend-PLAN.md`](file:///tmp/cr2-worktrees/f69853eb723c-cr2-schiele-gem-factory/docs/plans/spa-frontend-PLAN.md#L1-L7)
```yaml
---
type: plan
title: "SPA Frontend — Implementation Plan"
spec: docs/specs/spa-frontend-SPEC.md
scope: React + TypeScript SPA with Vite, Tailwind CSS, Google Identity Services auth, extension communication, gem import, and registry browser
date: 2026-04-05
---
```

#### Discrepancies
1. **Missing `authority: prescriptive`**: CR2 requires plans to declare `authority: prescriptive`.
2. **Missing `status`**: The `status` field is required for lifecycle tracking in CR2 collection panels. Because this plan targeted the legacy Express + PostgreSQL stack that was retired in favor of direct GCS writes ([ADR-0001](file:///tmp/cr2-worktrees/f69853eb723c-cr2-schiele-gem-factory/docs/decisions/0001-replace-sql-and-api-server-with-direct-gcs-writes.md)), its status should be `superseded` or `retired`.
3. **Non-standard metadata keys**: Fields like `spec:`, `scope:`, and `date:` are ad-hoc and not recognized by the CR2 schema.

---

### 2. Section Structure Conformance

#### CR2 Prescribed Sections for `type: plan`
Per [`.cr2/config.json`](file:///tmp/cr2-worktrees/f69853eb723c-cr2-schiele-gem-factory/.cr2/config.json), a valid CR2 `plan` must contain exactly these 5 sections:
1. `The delta`
2. `Numbered steps, each with its files and a Done when`
3. `Choices the spec leaves open`
4. `Out of scope`
5. `Open Questions`

#### Current Sections in [`spa-frontend-PLAN.md`](file:///tmp/cr2-worktrees/f69853eb723c-cr2-schiele-gem-factory/docs/plans/spa-frontend-PLAN.md)
The document currently uses an 8-section layout:
- `## 1. Goal`
- `## 2. Context & Prior Art`
- `## 3. Implementation Steps` (Phases A–L, Steps 1–33)
- `## 4. Data Model / Schema Changes`
- `## 5. Integration Points`
- `## 6. Edge Cases & Risks`
- `## 7. Verification`
- `## 8. Open Questions`

#### Gap Analysis

| CR2 Required Section | Present? | Gap Analysis |
| :--- | :---: | :--- |
| **`## The delta`** | ❌ No | Missing. The information is spread across `## 1. Goal`, `## 2. Context & Prior Art`, and `## 4. Data Model / Schema Changes`. |
| **`## Numbered steps, each with its files and a Done when`** | ⚠️ Partial | Exists under `## 3. Implementation Steps`, but uses an ad-hoc sub-structure (`What`, `Where`, `How`, `Why`) and does not pair each step directly with a `Done when` clause. |
| **`## Choices the spec leaves open`** | ❌ No | Missing. Handled informally in Section 2 under `Key decisions` and Section 8 under `Resolved`. |
| **`## Out of scope`** | ❌ No | Missing. Boundaries are either omitted or deferred to external documents. |
| **`## Open Questions`** | ⚠️ Partial | Present as `## 8. Open Questions`, but contains a `### Resolved` subsection. In CR2, resolved choices belong in `Choices the spec leaves open`, reserving `Open Questions` solely for unresolved items. |
| *Ad-hoc Extra Sections* | ❌ Extra | Sections 4 (`Data Model`), 5 (`Integration Points`), 6 (`Edge Cases & Risks`), and 7 (`Verification`) are extraneous in CR2. |

---

### 3. Step-Level Formatting Discrepancies

CR2 plan steps expect:
- Explicit file targets: Specific paths being created or edited.
- Action description: Direct instructions on the change.
- A **`Done when`** clause: A testable, deterministic verification gate directly tied to that step.

In [`spa-frontend-PLAN.md`](file:///tmp/cr2-worktrees/f69853eb723c-cr2-schiele-gem-factory/docs/plans/spa-frontend-PLAN.md#L55-L99), the steps currently follow:
```markdown
#### Step 1 — Initialize frontend/ with Vite + React + TypeScript
- **What:** Create the frontend/ directory...
- **Where:** frontend/
- **How:** Run npm create vite@latest...
- **Why:** Establishes the project foundation...
```
Verification criteria are detached into Section 7 (`## 7. Verification`), rather than inline as `Done when:` lines for each step.

---

### Summary of Adjustments Needed for CR2 Conformance

If you decide to bring this plan into full CR2 compliance in the future:
1. **Front Matter**:
   ```yaml
   ---
   type: plan
   title: SPA Frontend — Implementation Plan
   authority: prescriptive
   status: superseded
   ---
   ```
2. **Sections**:
   - Merge Section 1, Section 2, Section 4, Section 5, and Section 6 into **`## The delta`**.
   - Rename Section 3 to **`## Numbered steps, each with its files and a Done when`**, integrating the verification checks from Section 7 directly into each step as a `Done when` line.
   - Move resolved items from Section 2 and Section 8 into **`## Choices the spec leaves open`**.
   - Add **`## Out of scope`** to define explicit non-goals.
   - Clean **`## Open Questions`** to only include unresolved blockers.

*(Per your instruction, no files were modified.)*
