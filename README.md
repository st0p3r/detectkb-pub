# DetectKB — Detection Engineering Knowledge Base

A self-hosted web application for learning, documenting, and organizing detection content.

## Features
- Wiki-style pages with [[backlinks]] and Markdown editing
- Structured detection rules with MITRE ATT&CK mapping and SPL queries
- SPL command cheat-sheet library with searchable cards
- Global search (Cmd+K) across all content
- Tag and category organization
- JSON backup and restore
- Dark mode, keyboard shortcuts, collapsible sidebar

## Quick Start (Development)

### Prerequisites
- Docker + Docker Compose
- Node.js 20+

### Setup
1. Clone and configure:
   ```bash
   cp backend/.env.example .env
   # Edit .env with your settings
   ```

2. Start MySQL:
   ```bash
   docker-compose up mysql -d
   ```

3. Install and migrate:
   ```bash
   cd backend && npm install && npx prisma migrate dev && cd ..
   cd frontend && npm install && cd ..
   ```

4. Start development servers:
   ```bash
   # Terminal 1:
   cd backend && npm run dev
   # Terminal 2:
   cd frontend && npm run dev
   ```

5. Open http://localhost:5173

### Full Docker Stack
```bash
docker-compose up
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| DATABASE_URL | mysql://detectkb:detectkb@localhost:3306/detectkb | MySQL connection string |
| JWT_SECRET | detectkb-dev-secret-change-in-production | JWT signing secret |
| ADMIN_USERNAME | admin | Login username |
| ADMIN_PASSWORD | detectkb | Login password |
| BACKUP_DIR | ../backups | Backup file directory |
| PORT | 3001 | Backend port |

## Default Login
- Username: `admin`
- Password: `detectkb`

**Change these in production via environment variables.**

## Backup & Restore
- Click "Backup Now" in the Backups section to export a JSON snapshot
- Daily automatic backup runs at startup + every 24 hours
- To restore: upload a JSON backup file in the Backups section
- Manual MySQL dump: `docker exec detectkb-mysql mysqldump -u detectkb -pdetectkb detectkb > backup.sql`

## Keyboard Shortcuts
| Key | Action |
|---|---|
| Cmd/Ctrl+K | Open search |
| n | New page |
| e | Edit current page |
| ? | Show shortcuts |
| Escape | Close modal |

## Production Deployment

Build and run with the production nginx frontend:
```bash
docker-compose --profile prod up --build
```

This serves the React app via nginx on port 80, with `/api` proxied to the backend.

## Tech Stack
- Frontend: React 18 + TypeScript + Vite + Tailwind CSS
- Backend: Node.js + Express + TypeScript + Prisma
- Database: MySQL 8
- Containerization: Docker + Docker Compose
