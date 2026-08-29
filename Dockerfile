FROM node:20-slim

# sharp (used by the sticker library) needs these
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "index.js"]
