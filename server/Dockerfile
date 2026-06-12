FROM rust:1.95-alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev
COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY src ./src
RUN cargo build --locked --release

FROM docker:29-cli
RUN apk add --no-cache ca-certificates git
WORKDIR /app
COPY --from=builder /app/target/release/codesync-server /usr/local/bin/codesync-server
RUN mkdir -p /app/workspaces /runner-workspaces
EXPOSE 8080
CMD ["codesync-server"]
