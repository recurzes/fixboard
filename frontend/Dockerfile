# Built from the repo root, because siteConfig reads backend/app/intake/form_config.json:
#   docker build -f frontend/Dockerfile --build-arg VITE_API_URL=... --build-arg NEON_AUTH_URL=... .
FROM node:24-alpine AS build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY backend/app/intake/form_config.json /app/backend/app/intake/
COPY frontend ./

# Build args reach RUN as environment variables, which is how Vite reads them.
ARG VITE_API_URL
ARG VITE_SENTRY_DSN
# nginx serves Neon Auth from this site at /neon-auth, so Safari keeps the session cookie.
RUN VITE_NEON_AUTH_URL=/neon-auth npm run build

FROM nginx:stable-alpine

ARG VITE_API_URL
ARG VITE_SENTRY_DSN
ARG NEON_AUTH_URL
# The photo bucket's origin, for signed links. Empty until the storage provider is chosen.
ARG PHOTO_ORIGIN

COPY frontend/nginx.conf.template /tmp/
# The CSP and the auth proxy need origins, so take them from the same values the build used.
RUN : "${VITE_API_URL:?is required}" "${NEON_AUTH_URL:?is required}" \
 && origin() { printf '%s' "$1" | sed -E 's#^(https?://)([^@/]*@)?([^/]*).*#\1\3#'; } \
 && export PHOTO_ORIGIN API_ORIGIN="$(origin "$VITE_API_URL")" \
    SENTRY_ORIGIN="$(origin "$VITE_SENTRY_DSN")" NEON_AUTH_ORIGIN="$(origin "$NEON_AUTH_URL")" \
 && path="${NEON_AUTH_URL#"$NEON_AUTH_ORIGIN"}" && export NEON_AUTH_PATH="${path%/}" \
 && envsubst '$PHOTO_ORIGIN $API_ORIGIN $SENTRY_ORIGIN $NEON_AUTH_ORIGIN $NEON_AUTH_PATH' \
    < /tmp/nginx.conf.template > /etc/nginx/conf.d/default.conf \
 && rm /tmp/nginx.conf.template \
 && nginx -t

COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
