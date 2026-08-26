# NGHome

> **Multi-tenant Apartment Community Management SaaS**  
> Powered by **NovaGade**

---

## Monorepo Structure

```
NGHome/
├── App/        NestJS 10 API  →  https://api.nghome.novagade.in
├── Web/        Next.js 14     →  https://app.nghome.novagade.in
├── Mobile/     Expo 51        →  Play Store / App Store
├── docker-compose.yml         Local full-stack dev
└── README.md                  (this file)
```

---

## Quick Start (Local Dev)

### Prerequisites

- Node.js 20+
- Docker Desktop (for the database)

### 1. Clone

```bash
git clone https://github.com/novagade/nghome
cd nghome
```

### 2. Start the database

```bash
docker-compose up -d db
```

### 3. Run the API

```bash
cd App
cp .env.example .env       # fill in your values
npm install
npm run prisma:migrate
npm run prisma:seed
npm run start:dev          # http://localhost:3000
```

### 4. Run the Web app

```bash
cd Web
cp .env.example .env.local # fill in API_URL=http://localhost:3000
npm install
npm run dev                # http://localhost:3001
```

### 5. Run the Mobile app

```bash
cd Mobile
npm install
npm start                  # Expo Dev Tools
```

### Or — start everything with Docker Compose

```bash
docker-compose up --build
```

---

## Sub-project READMEs

- [App/README.md](App/README.md) — API architecture, billing engine, roles, Docker
- [Mobile/README.md](Mobile/README.md) — Expo setup, EAS Build, screens

---

## Deployment

| Sub-project | Platform   | Notes                                      |
|-------------|------------|--------------------------------------------|
| API         | Coolify    | `App/Dockerfile` · auto-migrates on start  |
| Web         | Coolify    | `Web/Dockerfile` · Next.js standalone      |
| Mobile      | EAS Build  | `eas build --platform all`                 |
| Database    | Coolify    | PostgreSQL resource — internal only        |

See [App/README.md](App/README.md) for full Coolify environment variable reference.

---

## Environment Variables

Each sub-project ships an `.env.example`. Copy and fill:

```bash
cp App/.env.example App/.env
cp Web/.env.example Web/.env.local
```

**Never commit `.env` files with real secrets.**

---

*NG Home — Built with NestJS · Next.js · Expo · Prisma · PostgreSQL*  
*© NovaGade. All rights reserved.*
