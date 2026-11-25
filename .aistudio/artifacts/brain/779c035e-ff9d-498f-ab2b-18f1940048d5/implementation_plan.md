# Journal Paper Dashboard — Full System Review, Bugfixes & Render Readiness Plan

A comprehensive revision of the Journal Paper Dashboard to eliminate multi-source tracking false alerts, resolve Render deployment and GitHub build blockers, upgrade browser extension and portal parser reliability, and polish the dashboard layout and analytics while keeping the existing light and dark visual identity intact.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirmed preferences from your review setup are locked into this plan:

- **Confirmed Focus Areas**: Multi-source tracking health & sync fixes, Render deployment & dependency conflict resolution, AI & local portal parser accuracy, and light/dark UI + analytics polish.
- **Confirmed Multi-Source Health Rule**: A manuscript row counts as **OK** whenever **any** linked portal source (e.g., Editorial Manager, Elsevier AuthorHub, Research Square) succeeds, and only surfaces a row-level problem when all checked sources fail.
- **Confirmed Hosting Target**: Primarily external **Render** hosting synced from GitHub (while remaining 100% compatible with local dev and AI Studio preview).
- **Confirmed Visual Direction**: Preserve the existing crisp light and dark visual style (`Plus Jakarta Sans` + `Public Sans` + `JetBrains Mono` with slate surfaces and blue/amber/emerald/rose semantic accents) with cleaner spacing, contrast, and alignment polish.

---

## 1. Overview & Core Concept

- **What It Does**: Provides a single-screen, zero-backend-database academic manuscript tracking workspace that reads already-open journal portals via a cross-browser MV3 companion extension (or direct fetch/paste), tracks verbatim status changes over time, merges multiple portals tracking the same paper into one unified row, exports formatted multi-sheet Excel workbooks and JSON backups, and sends deduplicated Gmail alerts.
- **Target Audience / Persona**: Academic researchers managing simultaneous manuscript submissions across Editorial Manager, Elsevier AuthorHub, Research Square, and publisher portals, hosted persistently on Render.
- **Key Value**: Eliminates false-positive `"Sign-in needed"` and `"Not in list"` alerts on multi-source manuscripts, prevents duplicate tab reloads during batch refreshes, ensures one-click clean builds on Render without dependency flags, and equips the companion extension to work seamlessly on `*.onrender.com`.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Add & Auto-Merge Flow**: User pastes a tracker link or pushes the active tab via the companion extension. Multi-paper portal lists open the picker with already-tracked papers pre-ticked; single-paper links auto-merge with matching manuscripts across Editorial Manager, AuthorHub, and Research Square into one row.
  2. **Refresh & Multi-Source Health Flow**: Clicking **Refresh all** reloads each unique open portal tab at most once per run, updates all matching papers from that list, keeps row health **OK** if any linked source succeeds, and surfaces a focused **Recheck problems** action when any row genuinely has zero working sources.
  3. **Per-Source Diagnostics & Control**: Clicking a row's health indicator or title opens the detail modal where each linked portal card displays its independent status, masked URL, last read timestamp, plus direct **Refresh source** and **Remove source** actions (when multiple portals are linked).
  4. **Render & Cloud Setup**: First-run diagnostics in **Setup & Extension** clearly report whether server Gemini AI is configured via Render environment variables (`GEMINI_API_KEY`) while keeping Smart Local + Free Open AI active with zero configuration, and Gmail Sign-In gives actionable domain guidance if Firebase Authorized Domains still need the Render hostname.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Crisp, utilitarian academic control center—no pill badge clutter, no nested heavy shadow cards, quiet 1px hairline borders, and high-density scannability.
  - *Color Palette & Mood*: Neutral slate canvas (`slate-50` light / `slate-950` dark) at 60%, elevated crisp surfaces (`white` / `slate-900` with 1px `slate-200` / `slate-800` borders) at 30%, and semantic status colors strictly tied to manuscript stage and health (`#2563EB` Editor, `#D97706` Review, `#EA580C` Revision, `#16A34A` Accepted/OK, `#DC2626` Rejected/Error) at 10%.
  - *Typography & Hierarchy*: `Plus Jakarta Sans` headings and wordmark, `Public Sans` dense body/table cells (12px–14px), and `JetBrains Mono` with enforced `tabular-nums` on every manuscript ID, date, day count, and metric counter.
  - *Component Styling & Layout*: Full-width 1440px-baseline single-screen grid with sticky table header, compact row height, inline problem recovery bar with targeted **Recheck problems** and **Clear warnings**, and aligned 4-card analytics row where status and journal bars act as live click-to-filter controls.

- **Interactive Feedback & Motion**: Smooth $\le 200\text{ms}$ hover and active filter transitions (`transition-colors`), spinning refresh affordances per-row, cancellable progress counter during **Refresh all**, and clear empty/filtered/loading states without blocking modals on load.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Per-Run Portal Tab Caching During "Refresh all"**
  - *Chosen Approach*: Cache captured page text and extracted results per normalized portal URL within a single **Refresh all** pass.
  - *Why*: When two or more tracked papers live on the same Editorial Manager journal portal (such as multiple submissions to *Journal of Energy Storage*), sequential per-paper reloads previously reloaded the exact same tab back-to-back within seconds, causing session/DOM timing failures (`Not in list`). Reading each shared portal tab once per pass makes refreshes faster and far more reliable.
  - *Alternatives Considered*: Adding long artificial delays between rows, which slows down refresh queues without eliminating redundant reloads.

- **Decision 2: Source-Aware Multi-Portal Health Aggregation**
  - *Chosen Approach*: Keep individual portal health (`OK`, `Sign-in needed`, `Not found`, etc.) stored per linked source inside `sources[]`, while computing row-level health as **OK** whenever **any** linked source succeeds (or already holds a working read when refreshing a single source).
  - *Why*: Matches your confirmed preference—when Editorial Manager updates a paper cleanly, an expired Elsevier AuthorHub token on the side no longer triggers false `"Problems"` counts or urgent warning banners, while still remaining inspectable inside the paper's Details modal.
  - *Alternatives Considered*: Keeping strict worst-case health across all sources, which repeatedly alarmed on healthy papers.

- **Decision 3: Aligning Dependency Versions & Proxy Awareness for Render**
  - *Chosen Approach*: Align the conflicting `esbuild` dev dependency with `vite`, respect `process.env.PORT` with port `3000` fallback, enable Express `trust proxy` for accurate HTTPS origin detection when generating the companion extension ZIP, and whitelist `https://*.onrender.com/*` inside the extension manifest and popup tab finder.
  - *Why*: Fixes Render's `npm install` `ERESOLVE` build failure without requiring `--legacy-peer-deps`, fixes port binding on Render's dynamic port environment, and enables the companion browser extension to connect directly to `journal-paper-dashboard.onrender.com`.
  - *Alternatives Considered*: Requiring manual Render `--legacy-peer-deps` build flags and manually editing extension manifests after download.

- **Decision 4: De-duplicating & Hardening Extension Table + Local Smart Extraction**
  - *Chosen Approach*: Stop scanning duplicate `innerText` rows when structured DOM tables are already extracted, allow nested inline formatting inside Editorial Manager table cells, decouple single-paper source matching from sibling `sourceListUrl` flags, and match `normPageAlphaNum` consistently in the free extractor validator.
  - *Why*: Directly prevents `"Not in list"` false negatives caused by nested cell markup, column shifts, punctuation differences, or sibling list flags.
  - *Alternatives Considered*: Relying solely on cloud LLMs for standard Editorial Manager tables, which adds rate-limit latency and quota risk.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                Browser Companion Extension (MV3 v1.2)                     │
│  [Existing Portal Tab] ──reload──▶ [DOM Table + Frame Extractor]          │
│         ▲                                    │                            │
│         │ (never opens portal tabs)          ▼ postMessage                │
│  content_scripts: localhost, *.run.app, *.onrender.com, custom origin     │
└──────────────────────────────────────────────┬────────────────────────────┘
                                               │
                                               ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                 React Dashboard Client (LocalStorage State)               │
│  ┌──────────────┐   ┌───────────────────────────┐   ┌──────────────────┐  │
│  │ TopBar &     │──▶│ Refresh Queue + Per-Run   │──▶│ Multi-Source     │  │
│  │ Status Legend│   │ Shared Tab Capture Cache  │   │ Merger & Health  │  │
│  └──────────────┘   └───────────────────────────┘   └──────────────────┘  │
│         │                         │                          │            │
│         ▼                         ▼                          ▼            │
│  ┌──────────────┐   ┌───────────────────────────┐   ┌──────────────────┐  │
│  │ KPI Strip &  │   │ High-Density Papers Table │   │ Paper Detail &   │  │
│  │ Click Charts │   │ + Targeted Problem Bar    │   │ Per-Source Cards │  │
│  └──────────────┘   └───────────────────────────┘   └──────────────────┘  │
│                                   │                                       │
│                    Firebase Google Auth (Gmail API)                       │
└───────────────────────────────────┼───────────────────────────────────────┘
                                    │ HTTPS (/api/*)
                                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│             Express + Vite/Dist Server (Render PORT || 3000)              │
│  ├─ /api/health             (AI & Gemini config diagnostics)              │
│  ├─ /api/fetch-page         (Server fallback fetch for public/sandbox)    │
│  ├─ /api/extract            (Local Smart Reader -> Free AI / Gemini AI)   │
│  ├─ /api/gmail/send         (Bearer-proxied Gmail API delivery)           │
│  └─ /api/extension/download (Builds cross-browser ZIP with proxy origin)  │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - `PaperRecord.sources[]`: Each linked portal (`Editorial Manager`, `Elsevier AuthorHub`, `Research Square`, etc.) tracks its own `health`, `healthMessage`, `currentStatus`, `statusDate`, and `lastSuccessfulReadAt`.
  - **Effective Row Health**: Derived from the active refresh outcome and stored sources—`Paused` if paused; `OK` if at least one linked source succeeded in the latest check or remains `OK` when refreshing only a sibling link; otherwise surfaces the failing state (`Sign-in needed`, `Not found`, `Timed out`, `AI error`, etc.).
  - **Import ID Remapping**: Merging or replacing imported JSON bundles propagates `deduplicateAndMergePapers` ID remaps into `history[]` so merged cross-source histories stay attached to their surviving manuscript record.

- **Interactive Component & State Mapping**:
  - **TopBar**: Displays primary navigation tabs, unseen/failed counters, AI provider selector (with subtle indicator if Gemini is selected while `GEMINI_API_KEY` is unset), **Refresh all**, and the single-line **Status Legend**.
  - **KpiStrip & Problem Action Bar**: Accurate `Problems` count reflecting only papers where no linked source works; clicking **Recheck problems** refreshes only failing papers, while **Clear warnings / Mark OK** resets transient alerts cleanly.
  - **AnalyticsGraphs**: Uniform-height 4-column grid where status bars and top-journal bars toggle table filters on click, paired with active filter feedback.
  - **PapersTable & PaperDetailModal**: Displays aligned multi-source portal labels with per-portal colors; inside the Details view, each linked portal card exposes **Refresh source**, **Mark OK / Dismiss**, and **Remove source** (when $>1$ source is attached).
  - **History, Setup & Settings Views**: Preserves Gmail Bearer auth with actionable `auth/unauthorized-domain` guidance for Render hostnames, surfaces Render `GEMINI_API_KEY` + extension `v1.2` setup status cleanly, and keeps `.xlsx` / JSON export & 10-slot backup restore intact.
