FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY services ./services
RUN npm run wake:build

FROM node:22-alpine
ENV NODE_ENV=production WAKE_HOST=0.0.0.0 WAKE_DATA_DIR=/data PORT=8790
WORKDIR /app
COPY server/wake-server.mjs server/wake-storage.mjs server/shared-models.mjs server/billing.mjs server/alipay-provider.mjs ./server/
COPY server/wechat-provider.mjs server/wechat-certificates.mjs ./server/
COPY shared/billing-plans.json ./shared/
COPY --from=build /app/server/.wake-build ./server/.wake-build
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8790/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/wake-server.mjs"]
