# Executed: 2026-06-18T09:26:13.796371

I currently have only three gems configured under my test user (`users/charles.schiele%40gmail.com/`) in the GCS bucket, but the Gem Registry UI is showing five gems.

Looking at the bucket structure under `users/charles.schiele@gmail.com/`, I see:
- A `gems.json` file at the root of my email-named folder, which contains some gem configurations.
- A `gems/` subfolder containing one JSON file per individual gem (three of them, matching my three actual gems).

In the registry UI, the three gems that correspond to the individual JSON files in the `gems/` subfolder have a delete option available. However, the two extra gems that appear to come from the consolidated `gems.json` file do not have a delete option.

I suspect the consolidated `gems.json` file is an obsolete/legacy format that's still being read by the SPA, causing those two stale gems to show up alongside the three current ones from the per-gem JSON files.

Can you investigate this, confirm whether `gems.json` is indeed a legacy format that should no longer be read, and recommend how to handle it (e.g., stop reading the legacy file, migrate its contents, or otherwise resolve the duplication and missing delete capability)?
