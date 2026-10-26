# syntax=docker/dockerfile:1
# Care Hub: one linux/amd64 image with the server, which also serves the web app.
# See docs/decisions/0003-image-and-deploy.md.

# Only the package manifests, so the npm install layers stay cached until they change.
FROM node:24 AS manifests
WORKDIR /src
COPY . .
RUN mkdir /out \
 && find . -name package.json -not -path '*/node_modules/*' -exec cp --parents {} /out/ \; \
 && for f in package-lock.json .npmrc; do if [ -f "$f" ]; then cp "$f" /out/; fi; done

FROM node:24 AS build
WORKDIR /src
ENV NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_UPDATE_NOTIFIER=false
COPY --from=manifests /out/ ./
RUN npm install
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
FROM node:24 AS server-deps
WORKDIR /src
ENV NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_UPDATE_NOTIFIER=false
COPY --from=manifests /out/ ./
RUN npm install --omit=dev --workspace=apps/server \
 && mkdir -p node_modules /app/apps/server \
 && rm -rf node_modules/@carehub node_modules/.package-lock.json \
 && mv node_modules /app/node_modules \
 && if [ -d apps/server/node_modules ]; then mv apps/server/node_modules /app/apps/server/; fi

FROM node:24-slim
LABEL org.opencontainers.image.title="Care Hub" \
      org.opencontainers.image.description="Care Hub workspace app (server and web app)" \
      org.opencontainers.image.source="https://github.com/felipegonc-coder/NavCC-CareHub"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WEB_DIST_DIR=/app/apps/web/dist
COPY --from=server-deps /app/ /app/
COPY --from=build /app/ /app/
# Uploaded files live here; a new named volume copies this owner.
RUN mkdir -p /data/files && chown node:node /data/files
# The version /api/health reports; CI passes sha-<commit>.
ARG CAREHUB_VERSION=0.0.0-dev
ENV CAREHUB_VERSION=$CAREHUB_VERSION
WORKDIR /app/apps/server
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>r.json()).then(b=>process.exit(b.status==='ok'?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
