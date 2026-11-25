import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Play,
  ShieldCheck,
  Upload,
  XCircle,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import type {
  AiProviderOption,
  BackupSnapshot,
  DashboardSettings,
  DateFormatOption,
  DeletedPaperRecord,
  ExportBundle,
  HistoryEntry,
  PaperRecord,
  StatusGroupKey,
} from '../types';
import {
  TIMEZONE_OPTIONS,
  buildExportBundle,
  formatDateTime,
  getEffectivePaperHealth,
  maskTrackingUrl,
  previewMergeImport,
  validateExportBundle,
  type MergePreview,
} from '../utils/paperLogic';

/* -------------------------------------------------------------------------- */
/* 1. Setup, First-Run Diagnostics & Browser Extension View                   */
/* -------------------------------------------------------------------------- */
interface SetupViewProps {
  papers: PaperRecord[];
  extensionConnected: boolean;
  gmailConnected: boolean;
  onRunSandboxScenario: (scenario: string) => void;
  onTriggerStatusChangeTest: () => void;
}

interface DiagnosticCheckRow {
  label: string;
  status: 'pass' | 'fail' | 'info';
  detail: string;
}

export const SetupView: React.FC<SetupViewProps> = ({
  papers,
  extensionConnected,
  gmailConnected,
  onRunSandboxScenario,
  onTriggerStatusChangeTest,
}) => {
  const [diagResults, setDiagResults] = useState<DiagnosticCheckRow[] | null>(null);
  const [runningDiag, setRunningDiag] = useState(false);

  const runDiagnostics = async () => {
    setRunningDiag(true);
    const rows: DiagnosticCheckRow[] = [];

    // 1. Browser / Extension Access
    rows.push({
      label: 'Browser access (Edge / Chrome / Firefox)',
      status: extensionConnected ? 'pass' : 'info',
      detail: extensionConnected
        ? 'Companion extension is active and connected to this dashboard tab.'
        : 'Companion extension not detected in this tab. Public links and built-in sandbox pages still work; install the extension below to read signed-in portals.',
    });

    // 2. AI Connection & Gemini Env Var Status
    try {
      const res = await fetch('/api/health');
      const data = (await res.json()) as {
        ok: boolean;
        aiConfigured: boolean;
        freeProvidersReady?: boolean;
        geminiConfigured?: boolean;
        model: string;
      };
      rows.push({
        label: 'AI page reader connection',
        status: data.freeProvidersReady || data.aiConfigured ? 'pass' : 'fail',
        detail: data.freeProvidersReady
          ? `Ready (${data.model}) — Smart Local + Free Open AI works with zero keys.`
          : 'AI extraction endpoint is unavailable.',
      });
      rows.push({
        label: 'Gemini AI (optional server key)',
        status: data.geminiConfigured ? 'pass' : 'info',
        detail: data.geminiConfigured
          ? 'GEMINI_API_KEY is configured on the server. Gemini AI is ready.'
          : 'GEMINI_API_KEY is not set on this server. Add GEMINI_API_KEY in Render Environment Variables to use Gemini AI, or keep Smart Local + Free Open AI active.',
      });
    } catch {
      rows.push({
        label: 'AI page reader connection',
        status: 'fail',
        detail: 'Could not reach the server AI health check.',
      });
    }

    // 3. Email connection
    const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
    rows.push({
      label: 'Email alerts (Gmail to hssaleh@gmail.com)',
      status: gmailConnected ? 'pass' : 'info',
      detail: gmailConnected
        ? 'Signed in with Google and ready to send status change emails.'
        : `Not signed in with Google yet. Go to History & Alerts and click "Sign in with Google" (ensure "${currentHost}" is listed in Firebase Authorized Domains).`,
    });

    // 4. Each saved link
    for (const p of papers) {
      const effHealth = getEffectivePaperHealth(p);
      rows.push({
        label: `Saved paper: ${p.journalName} (${p.manuscriptNumber || 'No MS #'})`,
        status: effHealth === 'OK' || effHealth === 'Paused' ? 'pass' : 'fail',
        detail:
          effHealth === 'OK'
            ? `Reachable (${maskTrackingUrl(p.url)}). Fields not shown on tracker are marked "Not shown", which is normal.`
            : `${effHealth}: ${p.healthMessage || 'Check page in browser'}`,
      });
    }

    setDiagResults(rows);
    setRunningDiag(false);
  };

  return (
    <div className="space-y-5 max-w-5xl mx-auto w-full">
      {/* First-Run / Diagnostic Check */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
              First-run system check
            </h2>
            <p className="text-[14px] text-slate-600 dark:text-slate-400 mt-0.5">
              Verifies browser access, AI connection, email alerts, and every saved paper link. Missing tracker fields report as “Not shown”, not failures.
            </p>
          </div>
          <button
            type="button"
            disabled={runningDiag}
            onClick={runDiagnostics}
            className="inline-flex items-center gap-2 px-4 py-2 text-[14px] font-medium text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 rounded-lg"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{runningDiag ? 'Checking…' : 'Run system check'}</span>
          </button>
        </div>

        {diagResults && (
          <div className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800 pt-2">
            {diagResults.map((row, idx) => (
              <div key={idx} className="py-2.5 flex items-start gap-3 text-[14px]">
                {row.status === 'pass' && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                )}
                {row.status === 'fail' && (
                  <XCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
                )}
                {row.status === 'info' && (
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                )}
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{row.label}</div>
                  <div className="text-[13px] text-slate-600 dark:text-slate-400">{row.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Companion Extension Download & Plain Steps (Edge first, then Chrome & Firefox) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
              Companion Browser Extension v1.2.5 (Edge, Chrome, Firefox)
            </h2>
            <p className="text-[14px] text-slate-600 dark:text-slate-400 mt-0.5">
              Refreshes your already-open, signed-in portal tabs (Editorial Manager, Elsevier AuthorHub, Research Square) before reading text while preserving ASP.NET frames and waiting for AuthorHub SPAs. Uses clean Chromium MV3 <span className="font-mono">service_worker</span> for Edge &amp; Chrome (and automatic Firefox build when downloaded in Firefox). Never opens any browser tabs. Re-download &amp; reload if updating from v1.2.4 or earlier.
            </p>
          </div>

          <a
            href="/api/extension/download"
            download="journal-paper-dashboard-extension.zip"
            className="inline-flex items-center gap-2 px-4 py-2 text-[14px] font-medium text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 rounded-lg"
          >
            <Download className="w-4 h-4" />
            <span>Download Extension (.zip)</span>
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 text-[14px]">
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">
              1. Microsoft Edge (Windows 11)
            </h3>
            <ol className="list-decimal list-inside space-y-1.5 text-[13px] text-slate-700 dark:text-slate-300">
              <li>Download and unzip the extension folder on your PC.</li>
              <li>Open <span className="font-mono">edge://extensions</span> in Edge.</li>
              <li>Turn on <strong>Developer mode</strong> in the left sidebar.</li>
              <li>Click <strong>Load unpacked</strong> and select the unzipped folder.</li>
              <li>Sign in to Editorial Manager or AuthorHub in Edge, then refresh papers here.</li>
            </ol>
          </div>

          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">
              2. Google Chrome
            </h3>
            <ol className="list-decimal list-inside space-y-1.5 text-[13px] text-slate-700 dark:text-slate-300">
              <li>Unzip the downloaded extension folder.</li>
              <li>Open <span className="font-mono">chrome://extensions</span>.</li>
              <li>Enable <strong>Developer mode</strong> in the top-right corner.</li>
              <li>Click <strong>Load unpacked</strong> and choose the folder.</li>
              <li>Keep your journal portal tabs signed in inside Chrome.</li>
            </ol>
          </div>

          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">
              3. Mozilla Firefox
            </h3>
            <ol className="list-decimal list-inside space-y-1.5 text-[13px] text-slate-700 dark:text-slate-300">
              <li>
                Download and unzip the{' '}
                <a
                  href="/api/extension/download?browser=firefox"
                  download="journal-paper-dashboard-extension-firefox.zip"
                  className="underline font-medium text-blue-700 dark:text-blue-400"
                >
                  Firefox extension ZIP
                </a>
                .
              </li>
              <li>Open <span className="font-mono">about:debugging#/runtime/this-firefox</span>.</li>
              <li>Click <strong>Load Temporary Add-on…</strong>.</li>
              <li>Select <span className="font-mono">manifest.json</span> inside the folder.</li>
              <li>Reload this dashboard tab to verify connection.</li>
            </ol>
          </div>
        </div>
      </section>

      {/* Safe Acceptance Sandbox */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
        <h2 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
          Acceptance checklist test sandbox
        </h2>
        <p className="text-[14px] text-slate-600 dark:text-slate-400">
          Run isolated verification tests without touching any real journal paper record.
        </p>

        <div className="flex flex-wrap gap-2.5 pt-1">
          <button
            type="button"
            onClick={onTriggerStatusChangeTest}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
          >
            <Play className="w-3.5 h-3.5" />
            Test status change (With Editor → Under Review + 1 email)
          </button>

          <button
            type="button"
            onClick={() => onRunSandboxScenario('expired-signin')}
            className="px-3.5 py-2 text-[13px] font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Test expired sign-in
          </button>

          <button
            type="button"
            onClick={() => onRunSandboxScenario('timeout')}
            className="px-3.5 py-2 text-[13px] font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Test page timeout
          </button>

          <button
            type="button"
            onClick={() => onRunSandboxScenario('ai-error-gibberish')}
            className="px-3.5 py-2 text-[13px] font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Test AI error handling
          </button>

          <button
            type="button"
            onClick={() => onRunSandboxScenario('missing-from-list')}
            className="px-3.5 py-2 text-[13px] font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Test missing paper from list
          </button>
        </div>
      </section>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 2. Settings, Colors, Export/Import & Backups View                          */
/* -------------------------------------------------------------------------- */
interface SettingsViewProps {
  settings: DashboardSettings;
  papers: PaperRecord[];
  deletedPapers: DeletedPaperRecord[];
  history: HistoryEntry[];
  rememberedIdentities: Record<string, string>;
  backups: BackupSnapshot[];
  onUpdateSettings: (next: DashboardSettings) => void;
  onImportMerge: (bundle: ExportBundle) => void;
  onImportReplace: (bundle: ExportBundle) => void;
  onRestoreBackup: (snapshot: BackupSnapshot) => void;
  onExportExcel: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  papers,
  deletedPapers,
  history,
  rememberedIdentities,
  backups,
  onUpdateSettings,
  onImportMerge,
  onImportReplace,
  onRestoreBackup,
  onExportExcel,
}) => {
  const [shareableExport, setShareableExport] = useState(false);
  const [fasterRiskModal, setFasterRiskModal] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    bundle: ExportBundle;
    preview: MergePreview;
  } | null>(null);
  const [newMappingStatus, setNewMappingStatus] = useState('');
  const [newMappingGroup, setNewMappingGroup] = useState<StatusGroupKey>('under_review');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadExport = () => {
    const bundle = buildExportBundle(
      papers,
      deletedPapers,
      history,
      settings,
      rememberedIdentities,
      shareableExport
    );
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal-paper-dashboard-${shareableExport ? 'shareable-' : ''}${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setPendingImport(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const check = validateExportBundle(parsed);
      if (!check.ok) {
        setImportError(check.error);
        return;
      }
      const preview = previewMergeImport(papers, history, check.bundle);
      setPendingImport({ bundle: check.bundle, preview });
    } catch {
      setImportError('Could not read this file. It is damaged or not valid JSON. No data was changed.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleIntervalChange = (mins: number) => {
    if (mins < 60 && !settings.fasterCheckingApproved) {
      setFasterRiskModal(mins);
      return;
    }
    onUpdateSettings({ ...settings, checkIntervalMinutes: mins });
  };

  return (
    <div className="space-y-5 max-w-5xl mx-auto w-full">
      {/* Display, Dates & Timezone */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4 text-[14px]">
        <h2 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
          Display, dates &amp; schedule
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Theme
            </label>
            <select
              value={settings.theme}
              onChange={(e) =>
                onUpdateSettings({ ...settings, theme: e.target.value as 'light' | 'dark' })
              }
              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
            >
              <option value="light">Light mode</option>
              <option value="dark">Dark mode</option>
            </select>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Row density
            </label>
            <select
              value={settings.density}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  density: e.target.value as 'compact' | 'comfortable',
                })
              }
              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
            >
              <option value="compact">Compact (15 rows target)</option>
              <option value="comfortable">Comfortable</option>
            </select>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Date display format
            </label>
            <select
              value={settings.dateFormat}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  dateFormat: e.target.value as DateFormatOption,
                })
              }
              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg font-mono"
            >
              <option value="YYYY-MM-DD">YYYY-MM-DD (2026-11-24)</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY (24/11/2026)</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY (11/24/2026)</option>
              <option value="DD MMM YYYY">DD MMM YYYY (24 Nov 2026)</option>
            </select>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Timezone (Riyadh UTC+3 default)
            </label>
            <select
              value={settings.timezone}
              onChange={(e) => onUpdateSettings({ ...settings, timezone: e.target.value })}
              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              AI page reader (replaceable, free)
            </label>
            <select
              value={settings.aiProvider}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  aiProvider: e.target.value as AiProviderOption,
                })
              }
              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
            >
              <option value="auto_free">Smart Local + Free Open AI (Recommended, no limits)</option>
              <option value="pollinations">Free Open AI only (Pollinations, no key)</option>
              <option value="local_reader">Built-in Local Reader (Offline, 100% private)</option>
              <option value="ollama">Local Ollama (On your PC, free)</option>
              <option value="gemini">Gemini AI (Google, 20/day free quota)</option>
            </select>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Auto-check interval (while browser is open)
            </label>
            <select
              value={settings.checkIntervalMinutes}
              onChange={(e) => handleIntervalChange(Number(e.target.value))}
              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
            >
              <option value={60}>Every 1 hour (Default, safe)</option>
              <option value={120}>Every 2 hours</option>
              <option value={30}>Every 30 minutes (Requires approval)</option>
              <option value={15}>Every 15 minutes (Requires approval)</option>
            </select>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Alert email recipient
            </label>
            <input
              type="email"
              value={settings.recipientEmail}
              onChange={(e) =>
                onUpdateSettings({ ...settings, recipientEmail: e.target.value })
              }
              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Email frequency
            </label>
            <select
              value={settings.emailMode}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  emailMode: e.target.value as 'per_change' | 'daily_summary' | 'both',
                })
              }
              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
            >
              <option value="per_change">One email per change (Default)</option>
              <option value="daily_summary">One daily summary</option>
              <option value="both">Immediate + daily summary</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-6 pt-1">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoCheckPausedAll}
              onChange={(e) =>
                onUpdateSettings({ ...settings, autoCheckPausedAll: e.target.checked })
              }
            />
            <span>Pause automatic checks for all papers</span>
          </label>

          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.includeWorkingLinkInEmail}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  includeWorkingLinkInEmail: e.target.checked,
                })
              }
            />
            <span>Include working tracker link inside alert emails (off = site &amp; MS # only)</span>
          </label>
        </div>
      </section>

      {/* Editable Status Colours */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4 text-[14px]">
        <div>
          <h2 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
            Status colours &amp; groupings
          </h2>
          <p className="text-[13px] text-slate-600 dark:text-slate-400">
            Exact status text from the journal is always preserved. Colours only control row swatches and charts.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {settings.statusGroups.map((g) => (
            <div
              key={g.key}
              className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-800"
            >
              <span className="font-medium text-slate-900 dark:text-slate-100">{g.label}</span>
              <input
                type="color"
                value={g.color}
                onChange={(e) => {
                  const nextGroups = settings.statusGroups.map((item) =>
                    item.key === g.key ? { ...item, color: e.target.value } : item
                  );
                  onUpdateSettings({ ...settings, statusGroups: nextGroups });
                }}
                aria-label={`Color for ${g.label}`}
                className="w-9 h-7 cursor-pointer rounded border border-slate-300 dark:border-slate-700"
              />
            </div>
          ))}
        </div>

        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2.5">
          <input
            type="text"
            value={newMappingStatus}
            onChange={(e) => setNewMappingStatus(e.target.value)}
            placeholder="Exact status text (e.g. Decision in Process)"
            className="flex-1 min-w-[220px] px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
          />
          <select
            value={newMappingGroup}
            onChange={(e) => setNewMappingGroup(e.target.value as StatusGroupKey)}
            className="px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
          >
            {settings.statusGroups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const trimmed = newMappingStatus.trim().toLowerCase();
              if (!trimmed) return;
              onUpdateSettings({
                ...settings,
                customStatusMappings: {
                  ...settings.customStatusMappings,
                  [trimmed]: newMappingGroup,
                },
              });
              setNewMappingStatus('');
            }}
            className="px-3.5 py-1.5 bg-slate-900 dark:bg-blue-600 text-white rounded-lg font-medium"
          >
            Map status colour
          </button>
        </div>
      </section>

      {/* Export, Import & Local Backups */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4 text-[14px]">
        <h2 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
          Export, import &amp; local backups
        </h2>

        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="space-y-1.5">
            <div className="font-medium text-slate-900 dark:text-slate-100">
              Export all papers, links, order, edits, history &amp; settings
            </div>
            <label className="inline-flex items-center gap-2 text-[13px] text-slate-600 dark:text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={shareableExport}
                onChange={(e) => setShareableExport(e.target.checked)}
              />
              <span>Shareable export (masks private URL tracking tokens; secrets are never included)</span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onExportExcel}
              className="inline-flex items-center gap-2 px-4 py-2 font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Export Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={handleDownloadExport}
              className="inline-flex items-center gap-2 px-4 py-2 font-medium bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 text-white rounded-lg"
            >
              <Download className="w-4 h-4" />
              Export JSON
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="font-medium text-slate-900 dark:text-slate-100">
                Import from JSON file
              </div>
              <p className="text-[13px] text-slate-600 dark:text-slate-400">
                Choose Merge (keeps existing papers, updates newer fields, deduplicates history) or Replace (backs up current data first).
              </p>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Upload className="w-4 h-4" />
                Choose export file…
              </button>
            </div>
          </div>

          {importError && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
              {importError}
            </div>
          )}

          {pendingImport && (
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Import summary ({pendingImport.bundle.papers.length} papers in file)
              </div>
              <ul className="text-[13px] text-slate-700 dark:text-slate-300 list-disc list-inside space-y-0.5">
                <li>New papers to add in Merge mode: {pendingImport.preview.newPapersCount}</li>
                <li>Existing papers with newer updates: {pendingImport.preview.matchedUpdatedCount}</li>
                <li>Unchanged papers: {pendingImport.preview.unchangedCount}</li>
                <li>New unique history entries: {pendingImport.preview.newHistoryEntriesCount}</li>
              </ul>
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    onImportMerge(pendingImport.bundle);
                    setPendingImport(null);
                  }}
                  className="px-4 py-2 text-[13px] font-medium bg-slate-900 dark:bg-blue-600 text-white rounded-lg"
                >
                  Apply Merge (Safe)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onImportReplace(pendingImport.bundle);
                    setPendingImport(null);
                  }}
                  className="px-4 py-2 text-[13px] font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700"
                >
                  Replace all (Creates automatic backup first)
                </button>
                <button
                  type="button"
                  onClick={() => setPendingImport(null)}
                  className="px-4 py-2 text-[13px] font-medium bg-slate-200 dark:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Automatic Local Backups (Latest 10) */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
          <div className="font-medium text-slate-900 dark:text-slate-100">
            Automatic local backups (latest {backups.length} of 10)
          </div>
          {backups.length === 0 ? (
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              Backups are created automatically before any Replace import or schema update.
            </p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {backups.map((b) => (
                <div key={b.id} className="py-2 flex items-center justify-between gap-3 text-[13px]">
                  <div>
                    <span className="font-medium text-slate-900 dark:text-slate-100">{b.reason}</span>
                    <span className="text-slate-500 dark:text-slate-400 ml-2">
                      · {b.paperCount} papers · {formatDateTime(b.createdAt, settings.timezone, settings.dateFormat)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRestoreBackup(b)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Faster Interval Risk Confirmation Modal */}
      {fasterRiskModal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 shadow-xl space-y-4">
            <h3 className="text-[17px] font-semibold text-slate-900 dark:text-slate-100">
              Confirm faster automatic checks?
            </h3>
            <p className="text-[14px] text-slate-600 dark:text-slate-300">
              Checking journal portals (such as Editorial Manager or Elsevier AuthorHub) more often than once per hour can trigger rate limiting, temporary CAPTCHAs, or account lockouts on your signed-in sessions.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setFasterRiskModal(null)}
                className="px-4 py-2 text-[14px] font-medium bg-slate-100 dark:bg-slate-800 rounded-lg"
              >
                Keep hourly (Safe)
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdateSettings({
                    ...settings,
                    fasterCheckingApproved: true,
                    checkIntervalMinutes: fasterRiskModal,
                  });
                  setFasterRiskModal(null);
                }}
                className="px-4 py-2 text-[14px] font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg"
              >
                I understand, set {fasterRiskModal} min
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
