FROM node:20-bookworm
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx prisma generate && npm run build
EXPOSE 3001
CMD ["sh", "entrypoint.sh"]
