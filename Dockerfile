FROM node:23.3.0-alpine

WORKDIR /usr/src/app
COPY package.json ./
COPY package-lock.json ./

RUN npm ci

COPY . ./
RUN npm run build

ENV NODE_ENV=production
ENTRYPOINT ["npm", "run", "start"]
