FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# Install ALL deps (including dev). `remix vite:build` needs vite and
# @remix-run/dev, which live in devDependencies — and NODE_ENV=production above
# would otherwise make npm skip them, breaking the build. --include=dev forces
# them in. Single-stage keeps it simple; the extra dev packages just sit unused
# at runtime.
RUN npm ci --include=dev && npm cache clean --force
# Remove CLI packages since we don't need them in production by default.
# Remove this line if you want to run CLI commands in your container.
RUN npm remove @shopify/cli

COPY . .

RUN npm run build

# docker-start = `prisma generate && prisma migrate deploy` then `remix-serve`.
# Piping stderr→stdout so migrate/boot errors show up in Coolify's log view
# (Coolify's log tail drops stderr, which otherwise hides the real failure).
CMD ["sh", "-c", "npm run docker-start 2>&1"]
