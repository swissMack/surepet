FROM node:22-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++ git curl

WORKDIR /app

# Clone the repo source (HA build context is ha-addon/ only)
RUN git clone --depth 1 https://github.com/swissMack/Surepet.git /tmp/surepet

# Copy package files and install all dependencies (need devDeps for tsc)
RUN cp /tmp/surepet/package.json /tmp/surepet/package-lock.json* ./
RUN npm ci

# Copy source and compile TypeScript
RUN cp -r /tmp/surepet/src/ ./src/
RUN cp /tmp/surepet/tsconfig.json ./
RUN npx tsc

# Copy public assets
RUN cp -r /tmp/surepet/public/ ./public/

# Remove dev dependencies and build artifacts
RUN npm prune --omit=dev
RUN rm -rf src/ tsconfig.json /tmp/surepet

# Copy startup script
COPY run.sh /run.sh
RUN chmod a+x /run.sh

RUN mkdir -p /data

CMD [ "/run.sh" ]
