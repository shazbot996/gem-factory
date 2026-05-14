# Response: 2026-05-01T09:34:26.223905

The API server was crashing because the Docker container couldn't resolve the hostname branch dot local for your database. I added an extra hosts mapping in docker compose to point that hostname to its IP address, and the server is now running successfully. Try refreshing the app and it should work.
