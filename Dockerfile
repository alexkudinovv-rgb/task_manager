# Test environment image (Railway). Production on Russian hosting reuses it in stage 9.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build -w apps/web

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST=/app/apps/web/dist
COPY --from=build /app /app
EXPOSE 3000
# Migrations and reference data are idempotent, so every start brings the database up to date.
CMD ["sh", "-c", "npm run db:migrate -w apps/server && npm run db:seed -w apps/server && exec npm start -w apps/server"]
