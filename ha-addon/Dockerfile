FROM node:22-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++ curl

WORKDIR /app

# Download source (ADD with remote URL is never cached by Docker)
ADD https://github.com/swissMack/Surepet/archive/refs/heads/main.tar.gz /tmp/surepet.tar.gz
RUN tar xzf /tmp/surepet.tar.gz -C /tmp && mv /tmp/Surepet-main /tmp/surepet

# Install all dependencies (need devDeps for tsc)
RUN cp /tmp/surepet/package.json /tmp/surepet/package-lock.json* ./
RUN npm ci

# Compile TypeScript
RUN cp -r /tmp/surepet/src/ ./src/
RUN cp /tmp/surepet/tsconfig.json ./
RUN npx tsc

# Copy public assets
RUN cp -r /tmp/surepet/public/ ./public/

# Slim down: remove dev deps and build artifacts
RUN npm prune --omit=dev
RUN rm -rf src/ tsconfig.json /tmp/surepet /tmp/surepet.tar.gz

# Copy startup script
COPY run.sh /run.sh
RUN chmod a+x /run.sh

RUN mkdir -p /data

CMD [ "/run.sh" ]
