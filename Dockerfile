FROM node:20-alpine AS builder

WORKDIR /app

COPY shared/teleshop-common-1.0.0.tgz ./shared/
COPY shared/teleshop-common-1.0.3.tgz ./shared/
COPY order-service/package*.json ./order-service/

WORKDIR /app/order-service
RUN npm ci

COPY order-service/ ./
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runner

WORKDIR /app/order-service
ENV NODE_ENV=production

COPY --from=builder /app/order-service /app/order-service

EXPOSE 3005
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
