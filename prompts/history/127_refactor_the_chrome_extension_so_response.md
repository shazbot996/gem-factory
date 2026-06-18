# Response: 2026-06-18T10:01:17.073617

Done. The popup now treats the Cloud Storage bucket as the source of truth. It fetches your cloud gems on open, shows them as In cloud, and shows any new local extractions as Pending upload. Clicking Upload pushes pending gems to the bucket and removes the local copy on success. The Clear button is gone, and stale local copies of already uploaded gems get cleaned up automatically on first open.
