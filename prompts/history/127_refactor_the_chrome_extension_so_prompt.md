# Executed: 2026-06-18T09:55:57.262661

Refactor the Chrome extension so that the GCS bucket is the authoritative source of truth for saved gems, not local storage. Currently, when a user extracts a gem it's saved locally; the extension popup lists local gems and reconciles them against the cloud. If the user clicks "Clear," the local entries are removed but the cloud copies remain in the GCS bucket — and from then on the popup shows "no gems extracted yet" even though they still exist in the bucket.

Changes I want:

1. **Make the bucket authoritative.** The extension popup should query the GCS bucket and display the gems stored there as the canonical list of saved gems. The local copy should not be what drives the UI once gems have been uploaded.

2. **New workflow:**
   - Extract a gem → save it locally as a pending/unsynced gem.
   - Upload to the bucket → on success, remove the local copy.
   - Gems that exist in the bucket should display as "already saved in cloud."

3. **Distinguish synced vs. unsynced gems** in the popup UI so the user can tell which local gems still need to be uploaded versus which are already in the cloud. The user should still be able to extract and add new gems; only newly added (unsynced) local gems get uploaded to the cloud.

4. **Remove the "Clear" function** from the extension entirely. Users should have no delete privileges against the GCS bucket, and removing local-only clearing avoids the current confusing state where the UI shows empty while the bucket still holds the gems.
