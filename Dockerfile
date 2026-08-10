FROM node:22-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json bun.lockb ./
RUN npx bun install --frozen-lockfile

COPY . .
RUN npx nuxi build

FROM node:22-slim

WORKDIR /app
COPY --from=build /app/.output .output

ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
