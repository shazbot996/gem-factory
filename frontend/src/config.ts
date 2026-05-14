// Single source of truth for environment-specific values.
// To switch buckets, edit VITE_GCS_BUCKET in .env.development (or
// .env.development.local for an override) and restart the dev server.
export const config = {
  bucketName: import.meta.env.VITE_GCS_BUCKET || 'gcs-gem-registry',
  oauthClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
};
