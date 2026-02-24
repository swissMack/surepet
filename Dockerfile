FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json* ./
COPY dist/ ./dist/
COPY public/ ./public/
COPY node_modules/ ./node_modules/
RUN mkdir -p /app/data
EXPOSE 3333
CMD ["node", "dist/index.js"]
