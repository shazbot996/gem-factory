# Response: 2026-05-14T09:06:58.230580

I wrote the proposed architecture decision record to docs slash decisions slash zero zero zero one. The recommendation is to eliminate the Express API server and Cloud SQL entirely, and have the Chrome extension write one JSON file per user directly to Google Cloud Storage, scoped by an IAM Condition to a per user object prefix. The approach is feasible and standard, with the main trade off being that full text search and cross user deduplication move from write time to read side processing.
