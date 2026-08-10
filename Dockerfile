# ---- Stage 1: build the React frontend ----
FROM node:22-slim AS frontend
WORKDIR /build
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build
# Output lands in /build/dist

# ---- Stage 2: compile native backend deps ----
FROM node:22-slim AS backend-deps
# better-sqlite3 and argon2 are native modules — need build tools
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package*.json ./
RUN npm install --omit=dev

# ---- Stage 3: lean runtime image ----
FROM node:22-slim
WORKDIR /app
# Copy compiled node_modules from stage 2
COPY --from=backend-deps /app/node_modules ./node_modules
# Copy backend source
COPY server/ ./
# Copy built frontend into the folder the backend will serve
COPY --from=frontend /build/dist ./public

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "index.js"]
