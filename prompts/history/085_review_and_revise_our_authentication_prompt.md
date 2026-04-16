# Executed: 2026-04-16T08:43:50.489931

Review and revise our authentication and authorization spec at `docs/specs/authentication-authorization-SPEC.md` to align it with how I actually want auth to work in this application. Compare what the spec currently says against the current state of the app, then update the spec to reflect the design described below.

## Context: how the app should authenticate

**Cloud-side credentials (server → Google Cloud):**
- During local development, all cloud calls should rely on Application Default Credentials (ADC).
- When deployed to Cloud Run, the Cloud Run service account provides the credentials needed for calls to and from Google Cloud.
- This part is straightforward and should be reflected in the spec.

**Client identity (the harder problem):**
- The universal truth is that **every user of this application signs in with Google** — this needs to support both personal Gmail accounts and my customer's private organization cloud identity.
- I do **not** want to build any complicated OAuth integration into the Chrome extension. Keep the extension lightweight and rely on the user's existing browser session.

**Frontend SPA → API auth:**
- Auth should start at the SPA: the user signs in to the Gem Registry via Google, which establishes the session.
- Once that session exists in the browser, the Chrome extension can piggyback on it — no separate auth pathway in the extension.

**Chrome extension behavior:**
- The extension should continue to work exactly as it does today for capturing gem content from Gemini and storing it locally (relying on the user's existing Gemini session).
- When the extension submits gems to the API, the user is already logged into the SPA in the same browser, so those API calls should authenticate using that same session.
- I don't believe the extension needs any new auth code beyond this — verify that assumption.
- The **one extension change** I'd like: today there is a field where the user manually enters their email address. I want this to be automatically derived from the user's Google authentication instead, if that's possible.

**API server:**
- The API needs to be able to authenticate / verify the authenticated user on incoming requests, supporting both Gmail and the customer's organizational Google identities.

## What I want you to do

1. Read the existing spec at `docs/specs/authentication-authorization-SPEC.md`.
2. Cross-reference it against how the app is actually configured today (SPA, API server, Chrome extension).
3. Identify any places where the spec is wrong, incomplete, or misaligned with the goals above.
4. Revise the spec so it describes a design consistent with the Google authentication goals laid out here — covering ADC/Cloud Run service account on the server side, Google Sign-In in the SPA, session-piggybacking from the extension, support for both Gmail and customer org identities, and auto-deriving the user's email in the extension from their Google auth.
