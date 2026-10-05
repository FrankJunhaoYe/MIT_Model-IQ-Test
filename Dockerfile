FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json server.cjs index.html styles.css app.js api-adapter.js test-cases.js demo-responses.js result-renderer.js ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
USER node
EXPOSE 8080
CMD ["node", "server.cjs"]
