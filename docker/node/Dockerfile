# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

# Production stage
FROM node:24-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY --from=builder /app/node_modules ./node_modules

COPY . .

EXPOSE 4000

CMD ["node", "server.js"]
