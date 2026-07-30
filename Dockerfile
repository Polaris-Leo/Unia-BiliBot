FROM node:22-alpine

# Chromium 会自动拉取 nss、freetype、harfbuzz 等运行依赖。
# 保留完整字体组合，确保中文、各语种文本和 Emoji 的渲染兼容性。
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
    && apk add --no-cache \
      chromium \
      ca-certificates \
      font-wqy-zenhei \
      font-noto \
      font-noto-cjk \
      font-noto-emoji \
      ttf-dejavu \
    && fc-cache -f

# 使用系统 Chromium，禁止 Puppeteer 再下载一份浏览器。
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force

COPY src ./src
COPY public ./public
RUN mkdir /app/data

EXPOSE 3002

CMD ["node", "src/index.js"]
