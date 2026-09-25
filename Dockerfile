FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/joshuawowk/cors-relay" \
      org.opencontainers.image.description="Tiny self-hostable CORS relay / fetch proxy for RSS feeds" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY app/ /app/
ENV PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
USER node
CMD ["node", "/app/server.js"]
