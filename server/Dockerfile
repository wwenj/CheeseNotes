FROM node:26-bookworm-slim AS web-build
WORKDIR /app/web
COPY web/package.json ./
RUN npm install
COPY web ./
RUN npm run build

FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY server/package.json ./
RUN npm install
COPY server ./
COPY --from=web-build /app/server/public ./public
RUN npm run build
FROM node:26-bookworm-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
CMD ["node", "dist/src/main.js"]
