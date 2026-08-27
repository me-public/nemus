# The Nemus cloud agent image — the portability boundary.
#
# Provider-agnostic: it takes only env (see parseAgentEnv / the runner-image
# contract) and does clone -> run agent -> open PR -> write result.json -> exit.
# Any Runner (docker/fly/fargate/k8s) launches THIS image; nothing here is
# cloud-specific.
#
# Build (from the repo root, after `npm ci && npm run build -w @nemus-cli/cloud`):
#   docker build -f packages/cloud/image/Dockerfile -t nemus-cloud-agent .
#
# Run (local Docker runner):
#   docker run --rm \
#     -e NEMUS_REPOS=acme/api,acme/web -e NEMUS_TASK="add idempotency keys" \
#     -e NEMUS_OWNER=acme -e GITHUB_TOKEN=$(gh auth token) \
#     nemus-cloud-agent

FROM node:22-bookworm-slim

# git + gh (GitHub CLI) + certs. gh from the official apt repo.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl gnupg \
  && mkdir -p -m 755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# Coding agents. pi is the default; claude is the fallback (AGENT=claude / NEMUS_AGENT=claude).
RUN npm install -g @earendil-works/pi-coding-agent @anthropic-ai/claude-code || \
    npm install -g @earendil-works/pi-coding-agent

# The cloud package (built dist) — provides the `nemus-cloud-agent` bin.
# Copy the prebuilt package so the image stays run-only (no build toolchain).
WORKDIR /opt/nemus-cloud
COPY packages/cloud/package.json ./
COPY packages/cloud/dist ./dist
COPY packages/cloud/image ./image
RUN npm install -g . && node -e "require('/opt/nemus-cloud/dist/index.js')"

# Non-root; a writable workspace.
RUN useradd -m -u 10001 agent && mkdir -p /workspace && chown agent:agent /workspace
USER agent
WORKDIR /workspace
ENV NEMUS_WORKDIR=/workspace

ENTRYPOINT ["nemus-cloud-agent"]
