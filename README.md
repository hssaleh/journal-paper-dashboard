# Journal Paper Dashboard

One-screen academic manuscript tracking dashboard for Editorial Manager, Elsevier AuthorHub, and Research Square, with offline local parsing, optional AI page reading, status-change alerts via Gmail, Excel/JSON export, and a cross-browser Companion Extension (Edge, Chrome, Firefox MV3).

## Features

- **Unified Manuscript Table**: Tracks multiple linked portals per paper (e.g., Editorial Manager + Elsevier AuthorHub + Research Square) in one row, counting as OK whenever any linked source works.
- **Built-in Local Reader + AI Agents**: Instant offline deterministic parser (`localSmartReader`), plus optional Free Open AI (Pollinations), Local Ollama, and Gemini AI (`GEMINI_API_KEY`).
- **Companion Extension (`v1.2.5`)**: Downloadable directly from **Setup & Extension** inside the running app. Refreshes open, signed-in portal tabs while preserving Editorial Manager ASP.NET postback tables and waiting for AuthorHub SPA hydration. Never opens new browser tabs.
- **Data Safety & Export**: Preserves manually edited fields, tracks status-change history and unseen badges, supports JSON backup/merge import, and exports multi-sheet `.xlsx` workbooks.

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

The app runs on `http://localhost:3000`. Requires **Node.js >= 22.18.0** (for native TypeScript server execution via `node server.ts`).

## Deploy on Render (via GitHub)

1. Push all repository files to GitHub (excluding `node_modules/`, `dist/`, `.env*`).
2. In Render, create a **New Web Service** (or **New Blueprint** using `render.yaml`) connected to your GitHub repository:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/health`
3. Optional Environment Variables in Render:
   - `NODE_ENV=production`
   - `APP_URL=https://<your-service>.onrender.com`
   - `GEMINI_API_KEY` (only needed if selecting Gemini AI; default `Smart Local + Free Open AI` works with zero keys)
   - `VITE_FIREBASE_*` (optional custom Firebase project for Gmail OAuth; add your Render domain to Firebase Authorized Domains)
