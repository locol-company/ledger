FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
EXPOSE 3002
CMD ["bun", "src/index.ts"]
