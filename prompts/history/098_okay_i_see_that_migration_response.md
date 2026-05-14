# Response: 2026-04-16T15:19:56.050165

The migration is already applied. It ran automatically when the API container started. The settings link was hidden because dev bypass mode signs you in as dev at localhost, which is not in the admin email list. I restarted the API with dev at localhost added to ADMIN_EMAILS, and now users slash me reports isAdmin true. Hard refresh the browser and the Settings link will appear.
