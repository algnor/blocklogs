FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
# /data is created owned by the unprivileged user so a fresh named volume is writable.
RUN mkdir /data && chown bun:bun /data
ENV DATA_DIR=/data BIND_HOST=0.0.0.0 PORT=3000
VOLUME /data
EXPOSE 3000
USER bun
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
	CMD bun -e "const r = await fetch('http://127.0.0.1:' + (process.env.PORT ?? 3000) + '/api/status'); process.exit(r.ok ? 0 : 1)"
CMD ["bun", "server/index.ts"]
