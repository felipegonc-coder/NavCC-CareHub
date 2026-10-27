# syntax=docker/dockerfile:1
# Care Hub: one image with the server, which also serves the web app. It is built on the
# server from a checkout (deploy/up.sh) and in CI. See docs/decisions/0003-image-and-deploy.md.
# The base images are pinned by digest and bumped by hand ("Base images" in deploy/README.md).

# Only the package manifests, so the npm ci layers stay cached until they change.
FROM node:24@sha256:6449e19d8184d84062525b6a7524def03146c2cb04a7f08b076680d0e8e4240a AS manifests
WORKDIR /src
COPY . .
RUN mkdir /out \
 && find . -name package.json -not -path '*/node_modules/*' -exec cp --parents {} /out/ \; \
 && for f in package-lock.json .npmrc; do if [ -f "$f" ]; then cp "$f" /out/; fi; done

FROM node:24@sha256:6449e19d8184d84062525b6a7524def03146c2cb04a7f08b076680d0e8e4240a AS build
WORKDIR /src
ENV NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_UPDATE_NOTIFIER=false
COPY --from=manifests /out/ ./
# Exactly the lockfile, without install scripts (decision 0011), as in ci.yml. npm install
# (also without scripts) only when the lockfile is out of sync with a package.json, which can
# happen on a pull request or just after a merge, before the repo bot updates it.
RUN if npm ci --ignore-scripts > /tmp/npm.log 2>&1; then cat /tmp/npm.log; \
    else cat /tmp/npm.log; grep -q 'can only install' /tmp/npm.log || exit 1; \
      echo 'package-lock.json is out of sync: npm install --ignore-scripts instead'; \
      npm install --ignore-scripts; fi
COPY . .
RUN npm run build
RUN test -f apps/server/dist/index.js && test -f apps/web/dist/index.html \
 && mkdir -p /app/apps/server /app/apps/web \
 && cp apps/server/package.json /app/apps/server/ \
 && cp -R apps/server/dist /app/apps/server/dist \
 && cp -R apps/web/dist /app/apps/web/dist \
 && if [ -d apps/server/migrations ]; then cp -R apps/server/migrations /app/apps/server/; fi \
 && cp LICENSE /app/ \
 && if [ -f THIRD_PARTY_NOTICES.md ]; then cp THIRD_PARTY_NOTICES.md /app/; \
    else echo 'THIRD_PARTY_NOTICES.md is missing (CI generates it on main)'; fi

# Production dependencies of the server and the workspace packages it uses. Those
# packages are bundled into dist by esbuild, so their workspace links are dropped.
FROM node:24@sha256:6449e19d8184d84062525b6a7524def03146c2cb04a7f08b076680d0e8e4240a AS server-deps
WORKDIR /src
ENV NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_UPDATE_NOTIFIER=false
COPY --from=manifests /out/ ./
RUN if npm ci --ignore-scripts --omit=dev --workspace=apps/server > /tmp/npm.log 2>&1; then cat /tmp/npm.log; \
    else cat /tmp/npm.log; grep -q 'can only install' /tmp/npm.log || exit 1; \
      echo 'package-lock.json is out of sync: npm install --ignore-scripts instead'; \
      npm install --ignore-scripts --omit=dev --workspace=apps/server; fi \
 && mkdir -p node_modules /app/apps/server \
 && rm -rf node_modules/@carehub node_modules/.package-lock.json \
 && mv node_modules /app/node_modules \
 && if [ -d apps/server/node_modules ]; then mv apps/server/node_modules /app/apps/server/; fi

FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
LABEL org.opencontainers.image.title="Care Hub" \
      org.opencontainers.image.description="Care Hub workspace app (server and web app)" \
      org.opencontainers.image.source="https://github.com/felipegonc-coder/NavCC-CareHub"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WEB_DIST_DIR=/app/apps/web/dist FILES_DIR=/data/files
COPY --from=server-deps /app/ /app/
COPY --from=build /app/ /app/
# Uploaded files. docker-compose.yml mounts a folder of CAREHUB_DATA_DIR here.
RUN mkdir -p /data/files && chown node:node /data/files
# What /api/health and the Status page report: up.sh passes the git version and the
# build time (UTC, ISO 8601), CI sha-<commit>.
ARG CAREHUB_VERSION=0.0.0-dev CAREHUB_BUILD_DATE=
ENV CAREHUB_VERSION=$CAREHUB_VERSION CAREHUB_BUILD_DATE=$CAREHUB_BUILD_DATE
WORKDIR /app/apps/server
# docker-compose.yml runs it as the Care Hub user instead; never as root.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>r.json()).then(b=>process.exit(b.status==='ok'?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
