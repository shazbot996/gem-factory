# Response: 2026-04-15T12:35:12.789375

The API server is already fully isolated in Docker, so nothing touches your local system. The frontend uses a project-local node modules folder inside the frontend directory, which is the Node.js equivalent of a virtual environment. The only host dependency is having Node itself installed.
