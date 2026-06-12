FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY packages/api/package.json ./packages/api/
COPY packages/shared/package.json ./packages/shared/

RUN npm install

COPY packages/api/ ./packages/api/
COPY packages/shared/ ./packages/shared/

RUN npm run build --workspace=@job-search/shared
RUN npm run build --workspace=@job-search/api

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "packages/api/dist/index.js"]
