FROM node:18-alpine

# 安装 Chromium 和中文字体
# 1. 替换为国内源（阿里云）以提高下载速度和稳定性
# 2. 安装 Chromium 和文泉驿微米黑字体
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
    && apk update \
    && apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      font-wqy-zenhei \
      font-noto \
      font-noto-cjk \
      font-noto-emoji

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
