# dsh-bot 沙箱宿主：每个容器 = bot 的"电脑"。
# 本镜像独立安装 dsh（npm），与本机 D:\Dev\DSH 桌面版零交互。
FROM node:24-bookworm-slim

# dsh CLI（developer preview：版本由 build 时锁定并记录在镜像 label）
# NPM_REGISTRY 可换源（默认官方源；受限网络环境用镜像源 build）
ARG DSH_VERSION=latest
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm install -g --registry="$NPM_REGISTRY" @deepseek-ai/dsh${DSH_VERSION:+@$DSH_VERSION} \
    && dsh --version || true

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY test ./test
COPY docs ./docs
COPY web ./web
COPY docker ./docker

# bot 状态与 dsh home 均在卷内，容器可弃；容器内默认走真实 dsh driver（GLM patch 随镜像）
ENV DSH_HOME=/dsh-home \
    DSH_BOT_STATE=/state \
    DSH_BOT_DRIVER=dsh \
    DSH_PATCH=/app/docker/dsh-glm-patch.yml
VOLUME ["/dsh-home", "/state"]

EXPOSE 8787
CMD ["node", "src/cli.ts", "serve"]
