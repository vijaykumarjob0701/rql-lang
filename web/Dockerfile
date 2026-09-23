# Build context: repo root (javascript/ + web/).
#   docker compose -f web/docker-compose.yml up --build

FROM node:20-bookworm-slim AS seed
WORKDIR /app/web
COPY web/scripts ./scripts
RUN mkdir -p src/lib
ENV QDRANT_URL=http://qdrant:6333
CMD ["node", "scripts/seed.mjs"]

FROM node:20-bookworm-slim AS seed-pg
WORKDIR /app/web
RUN npm install --omit=dev pg@8.16.3
COPY web/scripts ./scripts
COPY web/sql ./sql
ENV DATABASE_URL=postgres://rql:rql@postgres:5432/rql_studio
CMD ["node", "scripts/seed-pg.mjs"]

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY javascript/package.json javascript/package-lock.json ./javascript/
RUN cd javascript && npm ci
COPY javascript ./javascript
RUN cd javascript && npm run build
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
RUN cd web && npm run build

FROM node:20-bookworm-slim AS studio
WORKDIR /app
COPY --from=build /app/javascript ./javascript
COPY --from=build /app/web ./web
WORKDIR /app/web
ENV QDRANT_URL=http://qdrant:6333
ENV DATABASE_URL=postgres://rql:rql@postgres:5432/rql_studio
ENV STUDIO_PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "npx vite preview --host 0.0.0.0 --port ${STUDIO_PORT:-8080}"]
