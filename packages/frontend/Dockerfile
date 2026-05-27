FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/shared/package.json ./packages/shared/

RUN npm install

COPY packages/frontend/ ./packages/frontend/
COPY packages/shared/ ./packages/shared/

EXPOSE 5173

CMD ["npm", "run", "dev"]
