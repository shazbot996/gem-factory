---
type: plan
title: Hy-Vee rebrand
authority: prescriptive
status: active
describes:
  - frontend/index.html
  - frontend/public/*
  - frontend/src/App.tsx
  - frontend/src/components/Layout.tsx
  - frontend/src/components/GemTable.tsx
  - frontend/src/pages/GemDetail.tsx
  - frontend/src/index.css
  - extension/banner-config.js
  - extension/content-script.js
  - extension/icons/*
provenance:
  - run: schiele/0008
    at: 2026-11-06T12:07:19.987Z
    mode: create
---

# Hy-Vee Rebrand — Implementation Plan

Implements the Schnucks Gem Registry SPA — Frontend Client Application spec (`docs/specs/spa-frontend-SPEC.md`). Rebrands the application assets, styles, user-facing text, and extension notifications from Schnucks to Hy-Vee, followed by the manual configuration steps required for deployment.

## 0. The delta

| Spec Rule | Current Implementation | Planned Change |
|---|---|---|
| Branding | Schnucks Gem Registry branding across SPA assets, copy, theme colors, and extension banner | Hy-Vee Gem Registry branding across SPA assets, copy, theme colors, and extension banner |

## 1. Brand assets and theme colors

**Files:** new `frontend/public/hy-vee-logo.png` (replaces `frontend/public/schnucks-logo.png`), `frontend/src/index.css`, `extension/icons/logo-icon.png`.

- Add `frontend/public/hy-vee-logo.png` and remove `frontend/public/schnucks-logo.png`.
- In `frontend/src/index.css`, update the Tailwind `@theme` block: replace `--color-schnucks-red*` tokens with `--color-hyvee-red` (`#EE2724`), `--color-hyvee-red-dark` (`#D71920`), `--color-hyvee-red-light` (`#FEF2F2`), and corresponding tint variations.
- Replace `extension/icons/logo-icon.png` with the Hy-Vee brand icon used for the floating action button (FAB).

**Done when:** inspecting the application in the browser dev tools shows `--color-hyvee-red` CSS variables active and `public/hy-vee-logo.png` loads without 404 errors.

## 2. Frontend application rebranding

**Files:** `frontend/index.html`, `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx`, `frontend/src/components/GemTable.tsx`, `frontend/src/pages/GemDetail.tsx`.

- In `frontend/index.html`, set the `<title>` element to `"Hy-Vee Gem Registry"`.
- In `frontend/src/components/Layout.tsx`, update the navigation logo `src` to `"/hy-vee-logo.png"` and `alt` to `"Hy-Vee"`.
- In `frontend/src/App.tsx`, update the sign-in screen logo `src` to `"/hy-vee-logo.png"`, `alt` to `"Hy-Vee"`, prompt text to `"Sign in with your Hy-Vee account or personal Gmail."`, and update the dev button class to `bg-hyvee-red hover:bg-hyvee-red-dark`.
- In `frontend/src/components/GemTable.tsx`, change link hover classes from `hover:text-schnucks-red` to `hover:text-hyvee-red`.
- In `frontend/src/pages/GemDetail.tsx`, change link and button accent classes from `text-schnucks-red hover:text-schnucks-red-dark` to `text-hyvee-red hover:text-hyvee-red-dark`.

**Done when:** opening the SPA displays "Hy-Vee Gem Registry" in the browser tab, the Hy-Vee logo in the navigation bar and sign-in page, Hy-Vee text on the sign-in screen, and link hover states render in Hy-Vee red.

## 3. Chrome extension banner and content script

**Files:** `extension/banner-config.js`, `extension/content-script.js`.

- In `extension/banner-config.js`, update `message` to `'You are using the public Gemini application. For company data, please use the private Hy-Vee Gemini Enterprise instance.'`.
- In `extension/content-script.js`, update code comments referencing the idle FAB rendering the brand logo.

**Done when:** visiting `gemini.google.com` displays the top alert banner referencing the "private Hy-Vee Gemini Enterprise instance" and the FAB renders the Hy-Vee logo icon.

## 4. Manual follow-up checklist

**Files:** none (external infrastructure, credentials, and deployment configuration).

- Complete the manual administrative tasks outside the repository needed to finalize the transition:
  1. **Google Cloud Storage bucket:** Provision a new GCS bucket for Hy-Vee (e.g. `gs://hyvee-gem-registry`) configuring uniform bucket-level access, object versioning, and CORS per `docs/deployment/gcs-bucket-setup.md`.
  2. **Google Cloud OAuth Consent Screen:** Configure a Google Cloud project with the OAuth consent screen branded as "Hy-Vee Gem Registry", specifying Hy-Vee contact emails and authorizing `hy-vee.com`.
  3. **OAuth credentials & environment configuration:** Generate OAuth 2.0 Web client and Chrome Extension client IDs; populate `frontend/.env.development.local` (`VITE_GCS_BUCKET`, `VITE_GOOGLE_CLIENT_ID`) and update `extension/config.js` and `extension/manifest.json`.
  4. **Official asset sourcing:** Obtain production-grade vector/PNG logos from Hy-Vee brand guidelines to replace placeholder files in `frontend/public/` and `extension/icons/`.
  5. **Enterprise redirect URL:** Verify whether Hy-Vee uses a tenant-specific Gemini Enterprise portal URL and update `enterpriseUrl` in `extension/banner-config.js` accordingly.
  6. **Extension deployment:** Deploy the reconfigured extension to Hy-Vee users via Chrome Enterprise Management policy or private Chrome Web Store listing.

**Done when:** authenticating with a `@hy-vee.com` Google account signs into the SPA, reads and writes gem records against the Hy-Vee GCS bucket, and displays Hy-Vee branding throughout.

## 5. Choices the spec leaves open

1. **Hy-Vee color palette values.** The spec defines Schnucks red (`#E31837`), but does not specify Hy-Vee tokens. Standard Hy-Vee corporate red (`#EE2724` with hover `#D71920`) is used as the default.
2. **Logo asset naming.** The existing asset was `schnucks-logo.png`. Adopting `hy-vee-logo.png` keeps naming clear and avoids browser asset cache collisions.
3. **Single-tenant deployment model.** The rebrand replaces Schnucks branding directly in place rather than introducing dynamic multi-tenant white-labeling, preserving the client-only architecture.

## 6. Out of scope

- Dynamic multi-tenant runtime theme switching or white-labeling engine.
- Migrating or copying existing gem JSON objects from the Schnucks GCS bucket into the Hy-Vee bucket.
- Modifying the VoiceCode BBS subproject (`voicecode-bbs/`).

## Settled without asking

- **Derived (docs/specs/spa-frontend-SPEC.md §4.8).** Brand logo is placed in `frontend/public/` and referenced by `Layout.tsx` and `App.tsx`.
- **Derived (docs/specs/spa-frontend-SPEC.md §4.8).** Brand color tokens are defined in `frontend/src/index.css` via the Tailwind v4 `@theme` block.
- **Derived (docs/specs/spa-frontend-SPEC.md §4.8).** The browser page title is set in `frontend/index.html`.
- **Default.** Use direct in-place replacement of assets and theme tokens rather than building a multi-tenant configuration layer, matching the existing application structure.
- **Default.** Use standard Hy-Vee primary red (`#EE2724`) and hover shade (`#D71920`) to replace Schnucks red variables.

## Changes needed elsewhere

- **README.md.** Update product overview, text references, and ASCII architecture diagrams from Schnucks to Hy-Vee.
- **docs/context/ARCH.md.** Update architecture documentation and component descriptions from Schnucks Gem Registry to Hy-Vee Gem Registry.
- **docs/specs/spa-frontend-SPEC.md.** Update spec title and Section 4.8 from Schnucks Branding to Hy-Vee Branding.
- **docs/specs/chrome-extension-gem-extractor-SPEC.md.** Update alert banner copy and FAB icon references to Hy-Vee.
- **AGENTS.md.** Update orientation notes to reference Hy-Vee instead of Schnucks Markets.
- **CLAUDE.md.** Update project overview and context file references to Hy-Vee.
- **GEMINI.md.** Update project overview and context file references to Hy-Vee.

## Open Questions

- **Domain restriction.** Should Google Sign-In be strictly restricted to `@hy-vee.com` Google Workspace accounts via the `hd` claim, or should personal Gmail accounts remain permitted during testing? Recommended: Allow personal Gmail accounts during initial dev testing, but enforce `@hy-vee.com` before production rollout, because internal corporate gem configurations should be secured against non-employee access.
- **Enterprise destination URL.** Does Hy-Vee have a dedicated corporate URL or SSO entry point for its Gemini Enterprise instance, or should the extension banner continue linking to `https://geminienterprise.google.com/`? Recommended: Link to `https://geminienterprise.google.com/` initially, because Google automatically resolves the tenant based on the active authenticated enterprise session.
