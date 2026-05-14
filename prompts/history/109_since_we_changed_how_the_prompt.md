# Executed: 2026-05-14T12:27:29.528114

Since we changed how the extension works, end users no longer need access to the registry UI — the SPA is now only for administrators, so it's too complicated.

Right now the menu bar has redundant links: "Gem Registry," "Dashboard," and "Registry." I only need one view. Please simplify the SPA so that:

- The main page (`/`) shows the registry for all users.
- The separate Dashboard page is eliminated.
- The separate Registry link is eliminated.
- The nav/menu bar collapses down to just the single main page.

Update `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx`, and remove or repurpose `frontend/src/pages/Dashboard.tsx` and `frontend/src/pages/Registry.tsx` as needed so the main page is the registry view.
