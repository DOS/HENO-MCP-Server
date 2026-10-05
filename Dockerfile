FROM node:20-alpine

WORKDIR /app

# Zero external dependencies - node:http & node:crypto built-in
COPY server.js .

ENV NODE_ENV=production
ENV PORT=18070

EXPOSE 18070

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:18070/health || exit 1

CMD ["node", "server.js"]
