# Response: 2026-06-18T09:34:53.119685

Yes, safe to remove both. The storage object user role is a strict superset of viewer and creator, plus it adds delete and bucket metadata read. Dropping the narrower bindings just keeps your IAM policy tidy.
