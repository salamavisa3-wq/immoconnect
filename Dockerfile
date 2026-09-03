# SakeurImmo — conteneur unique (API + frontend statique + SSR).
# Le backend Express sert tout : /api, les fichiers de frontend/, et le SSR SEO.
# Base de données = Turso (externe) ; images = Cloudinary (externe) → conteneur stateless.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Dépendances d'abord (cache Docker) — package-lock.json requis
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Code applicatif
COPY backend/ ./backend/
COPY frontend/ ./frontend/

WORKDIR /app/backend
EXPOSE 3001
CMD ["node", "server.js"]
