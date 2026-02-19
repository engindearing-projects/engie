FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      git \
      curl \
      ca-certificates \
      jq \
      openssh-client && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Bun (required for OpenClaw build)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

# Clone and build OpenClaw
WORKDIR /opt/openclaw
RUN git clone --depth 1 https://github.com/openclaw/openclaw.git . && \
    pnpm install --frozen-lockfile && \
    pnpm build && \
    pnpm ui:build

ENV OPENCLAW_PREFER_PNPM=1
ENV NODE_ENV=production

# Set up non-root user
RUN chown -R node:node /opt/openclaw
USER node

# Config and workspace are mounted as volumes
VOLUME ["/home/node/.openclaw"]

EXPOSE 18789 18790

CMD ["node", "openclaw.mjs", "gateway", "--bind", "lan", "--port", "18789"]
