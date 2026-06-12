# Docker Runner Setup

CodeSync executes submitted code in short-lived Docker containers. The backend
user must be able to access Docker, and the runner images must be installed
before users click Run.

```bash
docker pull python:3.13-alpine
docker pull node:22-alpine
docker pull denoland/deno:alpine
docker pull rust:1.85-alpine
docker pull golang:1.24-alpine
docker pull gcc:14
docker pull eclipse-temurin:21-jdk-alpine
```

On a typical Linux Docker installation, add the backend user to the Docker
group, then sign out and back in:

```bash
sudo usermod -aG docker "$USER"
```

Docker daemon access is highly privileged. In production, run CodeSync's runner
as a separate service using rootless Docker or another hardened sandbox.

When deployed with the repository's `compose.yaml`, runner source files use the
shared `codesync_runner_workspaces` volume. The `runner-images` setup service
pulls all required language images before the backend starts.
