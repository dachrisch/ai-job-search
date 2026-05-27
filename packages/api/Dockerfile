FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/api/package.json ./packages/api/
COPY packages/shared/package.json ./packages/shared/

RUN npm install

COPY packages/api/ ./packages/api/
COPY packages/shared/ ./packages/shared/

RUN npm run build

CMD ["npm", "start"]
