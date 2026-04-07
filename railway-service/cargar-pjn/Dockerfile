FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production --ignore-scripts

RUN npx playwright install chromium --with-deps

COPY lib ./lib
COPY pjn_uploader.js ./
COPY server.mjs ./

EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.mjs"]
