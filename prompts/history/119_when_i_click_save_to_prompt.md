# Executed: 2026-06-09T09:25:58.847611

When I click **Save to Registry** on a gem that already exists in the GCS bucket, the extension reports a successful save without warning me that the gem was already registered. I'd prefer it to detect this case and tell me the gem is already in the registry rather than silently succeeding.

More broadly, I'd like the extension's popup (the one that opens when I click the toolbar icon) to query the GCS bucket directly when it loads, so it can show which gems are already in the shared registry — not just what's in the extension's local cache. Right now, after I reload the extension or reset the browser, the popup shows an empty registry until I try to save something. That may just be because I had recently deleted and reloaded the extension, but either way, the popup should reflect the actual state of the GCS bucket on open, with already-saved gems clearly marked.

Please update the extension to:
1. On **Save to Registry**, detect when a gem is already present in the bucket and surface that to the user instead of reporting a plain success.
2. On popup open, look up the current user's gems in the GCS bucket and display which ones are already registered, rather than relying solely on the local cache.
