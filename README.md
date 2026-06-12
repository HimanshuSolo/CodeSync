CodeSync is a real-time collaborative code editor with AI assistance, GitHub
workspaces, and isolated multi-language code execution.

## Docker deployment

Requirements:

- Docker Engine with Docker Compose
- A Groq API key
- Ports `3000` and `8080` available

Create the deployment environment file:

```bash
cp .env.docker.example .env
```

Set strong values in `.env`. For a remote server, set `PUBLIC_API_URL` and
`PUBLIC_WS_URL` to browser-accessible URLs, for example:

```dotenv
PUBLIC_API_URL=https://api.codesync.example.com
PUBLIC_WS_URL=wss://api.codesync.example.com
```

Build and start CodeSync:

```bash
docker compose up --build -d
docker compose ps
```

CodeSync is available at `http://localhost:3000` by default. PostgreSQL data
and imported GitHub workspaces are persisted in Docker volumes.

Stop the application without deleting data:

```bash
docker compose down
```

The backend mounts `/var/run/docker.sock` so it can create restricted runner
containers. Access to the Docker socket is equivalent to host-level control;
deploy CodeSync only on a trusted host and put the public services behind HTTPS.
