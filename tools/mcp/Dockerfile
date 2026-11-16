FROM node:24-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache git \
  && addgroup -S app && adduser -S app -G app \
  && mkdir -p /app/data

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

RUN chown -R app:app /app
USER app

EXPOSE 3030

CMD ["node", "dist/index.js"]
