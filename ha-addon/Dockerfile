FROM node:22-alpine

RUN apk add --no-cache python3 make g++ curl

WORKDIR /app

# ARG invalidates all subsequent layers when its value changes
ARG APP_VERSION=1.0.10
RUN echo "Building version: ${APP_VERSION}" \
    && curl -sL https://github.com/swissMack/Surepet/archive/refs/heads/main.tar.gz \
    | tar xz -C /app --strip-components=1

# Install dependencies, compile TypeScript, then prune dev deps
RUN npm ci \
    && npx tsc \
    && npm prune --omit=dev \
    && rm -rf src/ tsconfig.json

COPY run.sh /run.sh
RUN chmod a+x /run.sh
RUN mkdir -p /data

CMD [ "/run.sh" ]
