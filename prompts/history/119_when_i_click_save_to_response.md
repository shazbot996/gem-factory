# Response: 2026-06-09T09:30:48.603665

The popup now silently queries Google Cloud Storage when it opens and tags each gem with an in registry chip if it is already saved. If every gem in the list is already saved, the save button disables and relabels to all in registry. And when you click save on gems that are all duplicates, the status message now uses a blue info style with wording like already in the registry, instead of looking like a green success.
