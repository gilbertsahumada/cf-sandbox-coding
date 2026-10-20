FROM node:24-trixie-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep util-linux \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global --ignore-scripts @earendil-works/pi-coding-agent@0.87.1 opencode-linux-x64-baseline@1.18.32 \
    && ln -s /usr/local/lib/node_modules/opencode-linux-x64-baseline/bin/opencode /usr/local/bin/opencode
COPY --from=docker.io/cloudflare/sandbox:1.0.1 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
COPY container/opencode-task.mjs /opt/opencode-task.mjs
WORKDIR /workspace
CMD ["sleep", "infinity"]
