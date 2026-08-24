FROM node:22-alpine

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]
