# Response: 2026-05-14T09:11:57.743383

For least privilege, regular users get the object creator and object viewer roles on the bucket, while admins get the object admin role. One important correction to my earlier architecture document: Cloud Storage IAM conditions do not support the email claim attribute I used in the example, so per user prefix isolation actually requires one binding per user, or you can accept group wide write access and rely on audit logs and versioning.
