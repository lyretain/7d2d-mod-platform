FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node apps ./apps
COPY --chown=node:node data ./data
ENV HOST=0.0.0.0 PORT=8080 DATA_DIR=/app/data
EXPOSE 8080
USER node
CMD ["node", "apps/api/src/server.js"]
