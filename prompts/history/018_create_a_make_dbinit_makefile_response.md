# Response: 2026-04-05T13:06:35.784119

I added two Makefile targets. Make db-init interactively prompts for database connection details, saves them to a local config file with restricted permissions, tests the connection, and creates the database if it doesn't exist. Make db-test reads the saved config and verifies the connection and user privileges. The config file is gitignored so credentials stay local.
