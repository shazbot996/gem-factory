# Response: 2026-04-15T09:21:02.596401

The second file was failing because of a race condition. After capturing the first file, the old Drive viewer and its data element were still in the DOM when the next capture started. The fix ensures complete cleanup between captures by waiting until the viewer is fully removed before proceeding, and explicitly deleting any stale data elements before opening the next file. The locally uploaded file will still show an X since it has no Drive URL to capture, which is correct.
