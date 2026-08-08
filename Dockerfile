# Implant Billing System — Production Dockerfile
# Vite/React frontend + Express/Node.js backend (CommonJS) + MySQL app DB
# (external) + Oracle HIS (external, read-only) + NAS share for vendor docs.
#
# Build:  docker build -t implant-billing:latest .
# Run:    docker run -d -p 3000:5000 --env-file backend/.env implant-billing:latest
#
# Required runtime env vars (see backend/.env for the full documented list):
#   PORT, JWT_SECRET, JWT_EXPIRES_IN, CORS_ORIGIN
#   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME            (MySQL app DB)
#   HIS_ORACLE_HOST, HIS_ORACLE_PORT, HIS_ORACLE_SERVICE,
#   HIS_ORACLE_USER, HIS_ORACLE_PASSWORD                       (Oracle HIS, read-only)
#   NAS_SHARE_PATH, NAS_USERNAME, NAS_PASSWORD                 (vendor document storage)
# These point at hosts on the hospital LAN (e.g. 172.16.x.x) — the container
# must run somewhere with network access to them; nothing is baked into the
# image at build time.

# ── Stage 1: Build Vite frontend ─────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps

COPY frontend/ ./

# Bake the API base URL so the frontend calls /api on the same origin by
# default (the backend serves both the API and the built SPA in this image).
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Install production backend dependencies only
COPY backend/package*.json ./
RUN npm install --omit=dev

# Copy backend source (routes, middleware, db, migrations, scripts, seed, src)
COPY backend/ ./

# Transient local staging dir for vendor-document uploads before they're moved
# to the NAS share — must exist, but nothing is ever served from it directly.
RUN mkdir -p uploads/vendor-documents

# Copy built frontend into the backend's static-file folder.
# Express serves this at "/" and falls back to index.html for SPA routes.
COPY --from=frontend-builder /frontend/dist ./public

ENV NODE_ENV=production
ENV PORT=5000

# Baked-in build metadata — queryable via GET /api/version
ARG GIT_COMMIT=unknown
ARG APP_VERSION=unknown
ARG BUILD_TIME=unknown
ENV GIT_COMMIT=$GIT_COMMIT
ENV APP_VERSION=$APP_VERSION
ENV BUILD_TIME=$BUILD_TIME

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:5000/api/health || exit 1

CMD ["node", "src/index.js"]
