# Response: 2026-06-09T09:18:46.342102

The bug was that the extension was overwriting your gems file, and GCS implements overwrite as delete plus create, which needed delete permission you do not have. I switched to one immutable file per gem with the create only precondition if generation match zero, so the extension never overwrites or deletes. Re-saving an existing gem now returns four twelve and is reported as already in the registry rather than failing.
