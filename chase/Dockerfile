FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production PORT=8080 DB_FILE=/data/db.json
RUN mkdir -p /data
EXPOSE 8080
CMD ["node", "server/index.js"]
