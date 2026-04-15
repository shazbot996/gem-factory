# Executed: 2026-04-06T12:55:42.340229

You are a senior software engineer producing a feature specification document.

## Your task

Analyze the codebase and the scope described below, then produce a well-structured feature spec in Markdown. The spec should clearly define the problem, proposed solution, technical design, scope boundaries, and success criteria — giving any developer or AI agent enough context to implement the feature without ambiguity.

## Scope

Write a new authentication spec for Gem Factory that covers the authentication and authorization layer across all three modules: the Chrome extension, the API server, and the SPA frontend. Place it in `docs/specs/` following the existing spec conventions.

The spec should cover:

**Assumptions:**
- All users are enterprise Google Cloud customers using Cloud Identity / Google Workspace logins exclusively.

**Chrome Extension:**
- The extension itself doesn't require its own authentication since it only functions on `gemini.google.com`, which requires the user to already be logged in.
- However, when saving a gem to the API, the extension must capture and include the user's identity (email address) so the registry always records which user imported each gem.
- Verify whether the current API already stores this data; if not, specify what needs to change so every gem in the registry is associated with the user who created/imported it.

**SPA Frontend + API:**
- Users log in to the SPA using their Google Cloud Identity account.
- Two roles only — no complex RBAC:
  - **User**: A regular authenticated user sees only the gems they have personally imported into the registry.
  - **Admin**: Determined by a flat-file list of admin email addresses (there will be very few). Admins use the same login mechanism but see an admin-level view showing all gems imported by all users across the entire registry.
- This role-based access control sets up the user context needed for future features (like writing gems back into Gemini Enterprise), so it needs to be solid before moving on.

**Scope:**
- Describe how authentication and authorization work across the entire application — extension, API, and frontend — in a single cohesive spec.
- Keep it simple. The only distinction is admins vs. regular users, what each can see, and ensuring every gem is tied to the user who imported it.

## Destination

The output will be saved to `docs/specs/`. Choose a descriptive filename that includes `-SPEC.md` as a suffix. Use lowercase-kebab-case derived from the feature or topic name. Examples: `speech-to-text-SPEC.md`, `doc-maintenance-SPEC.md`, `publish-overlay-SPEC.md`. The filename should make the document identifiable at a glance without opening it.

## Document structure

Produce the following sections. Omit any section that genuinely does not apply, but err on the side of including rather than skipping.

### 1. Problem Statement
- What problem or need does this feature address?
- Who is affected and how?
- What happens today without this feature?

### 2. Goals & Non-Goals
- **Goals**: What this feature must achieve.
- **Non-Goals**: What is explicitly out of scope — things that might seem related but will not be addressed here.

### 3. Proposed Solution
- High-level description of the approach.
- Why this approach over alternatives.
- Key user-facing behavior or workflow changes.

### 4. Technical Design
- Components that need to be created or modified.
- Data structures, models, or schema changes.
- Key algorithms or logic flows.
- Reference actual file paths, class names, and existing patterns in the codebase.

### 5. UI / UX (if applicable)
- How the user interacts with this feature.
- New screens, overlays, keyboard shortcuts, or CLI commands.
- State transitions and feedback.

### 6. Integration Points
- How this feature connects to existing components.
- Dependencies on other systems, services, or libraries.
- API surface changes (if any).

### 7. Edge Cases & Error Handling
- Boundary conditions and how they should be handled.
- Failure modes and recovery strategies.
- Thread safety or concurrency concerns.

### 8. Scope & Milestones
- What is included in the initial implementation vs. future iterations.
- Suggested breakdown into deliverable chunks if the feature is large.

### 9. Success Criteria
- How to verify the feature works correctly.
- Acceptance criteria — specific, testable conditions.
- Performance or reliability requirements if applicable.

### 10. Open Questions
- Unresolved decisions that need input.
- Alternatives considered and trade-offs.

## Guidelines

- **Read the actual code.** Do not guess or hallucinate. Use your tools to explore files, grep for patterns, and read implementations.
- **Be specific.** Reference actual file paths, class names, and function names.
- **Respect existing patterns.** If the codebase does something a certain way, the spec should acknowledge and build on that.
- **Focus on "what" and "why", not "how to implement step by step".** That is what a PLAN document is for. The spec defines the destination, not the route.
- Write the document as a single Markdown file. Use `##` for top-level sections and `###` for subsections.
- Start the document with a YAML frontmatter block containing type (always `spec`), title, scope, and date.

