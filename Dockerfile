FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY apps ./apps
COPY data ./data
RUN npm --prefix apps/web install && npm --prefix apps/web run build && rm -rf apps/web/node_modules
RUN chown -R node:node /app
ENV HOST=0.0.0.0 PORT=8080 DATA_DIR=/app/data
EXPOSE 8080
USER node
CMD ["node", "apps/api/src/server.js"]
