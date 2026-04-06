# Executed: 2026-04-05T13:05:29.169961

Create a `make db-init` Makefile target that interactively prompts the user for database connection details (host, port, username, password, and database name), then saves them to a local configuration file. Add this config file to `.gitignore` so credentials aren't committed.

After successfully saving the config file, `db-init` should automatically test the connection. If the connection succeeds but the specified database doesn't exist, create it.

Also create a `make db-test` target that reads the saved config file, tests the database connection, and verifies that the connected user has the necessary privileges.
