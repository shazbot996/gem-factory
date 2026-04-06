# Response: 2026-04-05T14:09:08.338332

The mirrored networking mode caused a port conflict on 5432 because a Windows-side PostgreSQL is now visible inside WSL. I changed the Docker Compose DB port mapping to 5433 and both containers are up and healthy, with the API responding at localhost 9090.
