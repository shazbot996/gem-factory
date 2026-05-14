---
type: runbook
title: "Gem Factory — GCS Bucket Setup"
scope: Operational steps to configure the Cloud Storage bucket that backs Gem Factory
date: 2026-05-14
---

# GCS Bucket Setup

This runbook configures a Google Cloud Storage bucket as the storage tier for
Gem Factory. The bucket holds one JSON file per user at
`users/<email>/gems.json`. See ADR-0001 for the rationale.

The repo currently targets the **test** bucket `gcs-gem-registry`. Promoting
to a production bucket requires repeating these steps for the new bucket and
updating two configuration files in the codebase
(`extension/config.js`, `frontend/.env.development`).

## 1. Create the bucket

```bash
PROJECT=<your-gcp-project>
BUCKET=gcs-gem-registry          # change for production
LOCATION=us-central1             # pick the region nearest your users

gcloud storage buckets create gs://${BUCKET} \
  --project=${PROJECT} \
  --location=${LOCATION} \
  --uniform-bucket-level-access \
  --public-access-prevention
```

`--uniform-bucket-level-access` is required: all permissions flow through IAM,
not per-object ACLs.

## 2. Enable object versioning

```bash
gcloud storage buckets update gs://${BUCKET} --versioning
```

Versioning gives free history of every user's gem set. Combined with audit
logging it makes accidental or malicious overwrites recoverable.

## 3. Configure CORS for browser writes

Create `cors.json` (replace the `chrome-extension://` ID with the actual
extension ID — visible at `chrome://extensions` after loading the extension
unpacked):

```json
[{
  "origin": [
    "http://localhost:3000",
    "chrome-extension://<extension-id>"
  ],
  "method": ["GET", "PUT", "POST", "HEAD"],
  "responseHeader": [
    "Content-Type",
    "Authorization",
    "ETag",
    "If-Match",
    "x-goog-meta-*"
  ],
  "maxAgeSeconds": 3600
}]
```

Apply it:

```bash
gcloud storage buckets update gs://${BUCKET} --cors-file=cors.json
```

Verify:

```bash
gcloud storage buckets describe gs://${BUCKET} --format="value(cors)"
```

For production, replace `http://localhost:3000` with the deployed SPA origin
and add the Chrome Web Store extension ID.

## 4. IAM bindings

### Test setup (current state)

`charles.schiele@gmail.com` already has read + object-write on
`gs://gcs-gem-registry`. No further IAM changes are needed for end-to-end
testing.

### Production setup

```bash
# Regular users — group binding
gcloud storage buckets add-iam-policy-binding gs://${BUCKET} \
  --member=group:gem-importers@<customer-org> \
  --role=roles/storage.objectCreator

gcloud storage buckets add-iam-policy-binding gs://${BUCKET} \
  --member=group:gem-importers@<customer-org> \
  --role=roles/storage.objectViewer

# Admins — full object control (no bucket IAM)
gcloud storage buckets add-iam-policy-binding gs://${BUCKET} \
  --member=user:<admin-email> \
  --role=roles/storage.objectAdmin
```

**Per-user prefix isolation:** Cloud Storage IAM Conditions do not support
`request.auth.claims.email`, so a single group-wide condition isolating each
user to their own prefix is not possible. Options if isolation is required:

1. Add one binding per user with a per-user
   `resource.name.startsWith("projects/_/buckets/<bucket>/objects/users/<email>/")`
   condition. Managed via Terraform.
2. Accept group-wide write access and rely on Cloud Audit Logs + object
   versioning for forensics.

Phase 1 uses option 2.

## 5. (Optional) Lifecycle rule for old versions

Bounds storage cost by deleting non-current versions older than 90 days:

```bash
cat > lifecycle.json <<'EOF'
{
  "lifecycle": {
    "rule": [{
      "action": { "type": "Delete" },
      "condition": {
        "daysSinceNoncurrentTime": 90,
        "isLive": false
      }
    }]
  }
}
EOF

gcloud storage buckets update gs://${BUCKET} --lifecycle-file=lifecycle.json
```

## 6. Verify

```bash
# Bucket exists with the expected settings:
gcloud storage buckets describe gs://${BUCKET} \
  --format="yaml(name,location,iamConfig.uniformBucketLevelAccess.enabled,versioning.enabled,cors)"

# Listing works (will be empty initially):
gcloud storage ls gs://${BUCKET}/users/
```

## 7. Code-side configuration

After the bucket is configured, update two files to point at it:

- `extension/config.js` — set `bucketName`.
- `frontend/.env.development` (or `.env.production`) — set `VITE_GCS_BUCKET`.

The extension's OAuth client ID (in `extension/config.js` **and**
`extension/manifest.json`) and the SPA's OAuth client ID
(`VITE_GOOGLE_CLIENT_ID`) point at the OAuth 2.0 client created in
Cloud Console — that is a separate configuration step, not part of the
bucket setup.
