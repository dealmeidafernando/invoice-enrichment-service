# --- build -------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY tsconfig*.json ./
COPY src ./src
RUN yarn build && yarn install --frozen-lockfile --production --ignore-scripts --prefer-offline

# --- runtime -----------------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main/main.js"]
