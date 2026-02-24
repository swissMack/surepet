ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install build dependencies for better-sqlite3 native module
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy pre-built application (TypeScript must be compiled before building image)
COPY dist/ ./dist/
COPY public/ ./public/

# Copy addon run script
COPY ha-addon/run.sh /run.sh
RUN chmod a+x /run.sh

# Data directory for SQLite database
RUN mkdir -p /data

CMD [ "/run.sh" ]
