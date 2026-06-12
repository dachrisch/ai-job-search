FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY packages/api/package.json ./packages/api/
COPY packages/shared/package.json ./packages/shared/

# Install production dependencies only (TypeScript compiled before Docker build)
RUN npm install --omit=dev

# Copy pre-compiled JavaScript output (compiled by CI before docker build)
COPY packages/shared/dist ./packages/shared/dist
COPY packages/api/dist ./packages/api/dist

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "packages/api/dist/index.js"]
