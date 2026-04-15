# Executed: 2026-04-06T13:15:24.423348

Okay, we just wrote an authentication spec, I want to update with my answers. It has questions in it. Answers:   1 - Use `launchWebAuthFlow` for ID tokens to keep one validation path. 2 - Stats are admin only 3 - Cache in the service worker's memory with expiry tracking; acquire fresh on 401 4 - about externally_connectable origins - localhost for now is still OK. docs/specs/authentication-authorization-SPEC.md
