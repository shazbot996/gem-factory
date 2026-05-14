# Executed: 2026-04-16T15:01:46.508760

You are a senior software engineer producing a stepwise implementation plan.

## Your task

You will be given a build specification (scope) describing a feature, change, or piece of work to implement. Your job is to analyze the spec together with the existing codebase, then produce a detailed, step-by-step implementation plan in Markdown. The plan should be concrete enough that a developer (or an AI agent) can follow it without guessing — every step should reference real files, real functions, and real patterns already in the codebase.

## Scope / Build Spec

Write an implementation plan for the Gemini Enterprise publication process specified in `docs/specs/gemini-enterprise-publish-SPEC.md`. Save the plan in `docs/plans/`.

Structure the plan in three phases:

**Phase 1: Configuration and connection testing (foundation)**
- Build the API capabilities and frontend UI needed to test connecting to a local Gemini Enterprise instance.
- Add a Gemini Enterprise **configuration screen** in the SPA, accessible only to users already whitelisted in our admin list (`ADMIN_EMAILS`).
- Add a Gemini Enterprise **test screen** (or test area within the config screen) with a button that verifies connectivity against the configured instance.
- Include documentation/help content in the configuration screen explaining the privileges and roles the admin needs to grant on the Google Cloud / Gemini Enterprise side for the connection to work.
- The goal of this phase is end-to-end: admin enters config → clicks test → sees whether we can successfully connect.

**Phase 2: Minimal gem publication**
- Extend the API and UI to support creating a simple gem in Gemini Enterprise with only the **prompt (instructions) and description**.
- Verify this works against the local Gemini Enterprise instance before moving on.

**Phase 3: Knowledge and tools**
- Add support for publishing **knowledge files** and **default/enabled tools** with the gem.

Keep Phase 1 deliberately simple — the point is to get the connection and admin-only configuration UI working before any gem publication logic is built. Read the spec at `docs/specs/gemini-enterprise-publish-SPEC.md` first to ground the plan in the specified design.

## Destination

The output will be saved to `docs/plans/`. Choose a descriptive filename that includes `-PLAN.md` as a suffix. Use lowercase-kebab-case derived from the feature or goal name. Examples: `doc-maintenance-PLAN.md`, `smoke-test-suite-PLAN.md`, `publish-overlay-PLAN.md`. The filename should make the document identifiable at a glance without opening it.

## Document structure

Produce the following sections. Omit any section that genuinely does not apply, but err on the side of including rather than skipping.

### 1. Goal
- One-paragraph summary of what this plan achieves.
- Link back to the spec or requirements driving it.

### 2. Context & Prior Art
- Relevant existing code, patterns, or conventions in the codebase that this plan builds on or must be consistent with.
- Key files and modules that will be touched or referenced.
- Any dependencies, libraries, or infrastructure involved.

### 3. Implementation Steps

A numbered list of concrete steps. For each step:

- **What**: Describe the change — new file, edit to an existing file, configuration change, etc.
- **Where**: Exact file path(s) and, where helpful, function/class names.
- **How**: Enough detail to implement without ambiguity. Reference existing patterns in the codebase (e.g. "follow the same pattern as `ArchAgent` in `publish/arch.py`"). Include code sketches for non-obvious logic.
- **Why**: Brief rationale if the step is not self-evident.

Group related steps under sub-headings if the plan is large.

### 4. Data Model / Schema Changes
- Any new classes, data structures, enums, or configuration fields.
- Changes to existing models or schemas.
- Migration or compatibility notes if applicable.

### 5. Integration Points
- How the new code connects to the rest of the system.
- UI changes, new keyboard shortcuts, overlay updates, etc.
- API or CLI surface changes.

### 6. Edge Cases & Risks
- Potential failure modes and how to handle them.
- Thread safety, performance, or compatibility concerns.
- Anything that might be tricky or easy to get wrong.

### 7. Verification
- How to verify each step works (manual test steps, expected behavior).
- Any automated tests to add.
- Acceptance criteria derived from the spec.

### 8. Open Questions
- Anything unresolved that needs a decision before or during implementation.
- Alternatives considered and why they were set aside.

## Guidelines

- **Read the actual code.** Do not guess or hallucinate. Use your tools to explore files, grep for patterns, and read implementations.
- **Be specific.** Reference actual file paths, class names, and function names. Every step should be grounded in the real codebase.
- **Respect existing patterns.** If the codebase does something a certain way, the plan should follow that convention unless there is a good reason not to.
- **Order matters.** Steps should be in a logical implementation order — foundations first, integration last.
- **Keep it actionable.** Each step should be something a developer can sit down and do. Avoid vague steps like "implement the feature" — break it down.
- Write the document as a single Markdown file. Use `##` for top-level sections and `###` for subsections.
- Start the document with a YAML frontmatter block containing type (always `plan`), title, spec reference, scope, and date.

