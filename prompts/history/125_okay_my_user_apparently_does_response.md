# Response: 2026-06-18T09:33:29.406201

This is an IAM problem, not an OAuth scope problem. Your token already has the right permission set; the bucket policy just does not let your user delete objects yet. Add the storage object user role to your account on the bucket with one gcloud command and the delete will work without signing in again.
