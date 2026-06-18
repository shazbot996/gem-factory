# Response: 2026-06-18T09:27:28.571401

Confirmed the consolidated gems.json file is legacy. The extension only writes per gem files now, and the two extra gems you see are leftover data from before the rewrite. My recommendation is to stop reading the legacy file from the SPA, which is a small change. You can inspect or delete the file directly from the bucket using gcloud if you want to rescue or clean it up. Want me to make the change?
