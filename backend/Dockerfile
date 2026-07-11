FROM node:20-bookworm
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN chmod +x entrypoint.sh
EXPOSE 3001
CMD ["sh", "entrypoint.sh"]
