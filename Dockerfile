FROM node:18-alpine

# 安装 Chromium 和中文字体
# font-wqy-zenhei 用于支持中文显示
# 显式指定 community 仓库以确保能找到字体包
RUN echo "http://dl-cdn.alpinelinux.org/alpine/edge/community" >> /etc/apk/repositories \
    && echo "http://dl-cdn.alpinelinux.org/alpine/edge/main" >> /etc/apk/repositories \
    && apk update \
    && apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      font-wqy-zenhei

# 设置环境变量
# 1. 跳过 Puppeteer 下载自带的 Chromium (节省 ~170MB)
# 2. 指定使用系统安装的 Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./

# 安装依赖
RUN npm install --production

COPY . .

RUN mkdir -p data

EXPOSE 3002

CMD ["npm", "start"]
