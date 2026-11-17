FROM node:22.22.0-alpine AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_API_URL=http://localhost:8000
RUN VITE_API_URL=$VITE_API_URL VITE_AUTH_MODE=disabled npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
ENV PORT=8080
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
