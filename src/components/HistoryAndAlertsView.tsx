import React, { useState } from 'react';
import { Mail, RefreshCw, Send, CheckCircle2, AlertCircle, Clock, Trash2 } from 'lucide-react';
import type { DashboardSettings, EmailAlertRecord, HistoryEntry } from '../types';
import { formatDateOnly, formatDateTime } from '../utils/paperLogic';

interface HistoryAndAlertsViewProps {
  history: HistoryEntry[];
  alerts: EmailAlertRecord[];
  settings: DashboardSettings;
  gmailUserEmail: string | null;
  gmailConnected: boolean;
  isSigningInGmail: boolean;
  onSignInGmail: () => void;
  onSignOutGmail: () => void;
  onSendTestEmail: () => Promise<{ ok: boolean; message: string }>;
  onResendAlert: (alertId: string) => void;
  onClearHistory: () => void;
  onToggleSimulateFailure: (val: boolean) => void;
}

export const HistoryAndAlertsView: React.FC<HistoryAndAlertsViewProps> = ({
  history,
  alerts,
  settings,
  gmailUserEmail,
  gmailConnected,
  isSigningInGmail,
  onSignInGmail,
  onSignOutGmail,
  onSendTestEmail,
  onResendAlert,
  onClearHistory,
  onToggleSimulateFailure,
}) => {
  const [journalFilter, setJournalFilter] = useState<string>('all');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [sendingTest, setSendingTest] = useState(false);

  const journals = Array.from(new Set(history.map((h) => h.journalName))).sort();
  const filteredHistory =
    journalFilter === 'all'
      ? history
      : history.filter((h) => h.journalName === journalFilter);

  const handleTest = async () => {
    setSendingTest(true);
    setTestResult(null);
    const res = await onSendTestEmail();
    setTestResult(res);
    setSendingTest(false);
  };

  return (
    <div className="space-y-5 max-w-6xl mx-auto w-full">
      {/* Email Connection & Test Card */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
              Email alerts ({settings.recipientEmail})
            </h2>
            <p className="text-[14px] text-slate-600 dark:text-slate-400 mt-0.5">
              Status changes email you automatically via Gmail with deduplicated event IDs and automatic retries. No email passwords are stored.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {gmailConnected ? (
              <div className="flex items-center gap-3">
                <span className="text-[14px] text-emerald-700 dark:text-emerald-400 font-medium">
                  Gmail connected ({gmailUserEmail})
                </span>
                <button
                  type="button"
                  onClick={onSignOutGmail}
                  className="px-3 py-1.5 text-[13px] font-medium border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isSigningInGmail}
                onClick={onSignInGmail}
                className="inline-flex items-center gap-2.5 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-[14px] font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-sm transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
                <span>{isSigningInGmail ? 'Signing in…' : 'Sign in with Google'}</span>
              </button>
            )}

            <button
              type="button"
              disabled={sendingTest}
              onClick={handleTest}
              className="inline-flex items-center gap-2 px-4 py-2 text-[14px] font-medium text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 rounded-lg disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span>{sendingTest ? 'Sending…' : 'Send test email'}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 text-[13px]">
          <label className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.simulateEmailFailure}
              onChange={(e) => onToggleSimulateFailure(e.target.checked)}
            />
            <span>Simulate email delivery failure (for testing retry queue &amp; “Failed” state)</span>
          </label>
          <span className="text-slate-500 dark:text-slate-400">
            Retry schedule on failure: 5 min → 30 min → every 2 hours (up to 24h)
          </span>
        </div>

        {testResult && (
          <div
            className={`p-3 rounded-lg text-[14px] border ${
              testResult.ok
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
            }`}
          >
            {testResult.message}
          </div>
        )}
      </section>

      {/* Email Delivery Queue */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
        <h3 className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">
          Email alert delivery queue ({alerts.length})
        </h3>
        {alerts.length === 0 ? (
          <p className="text-[14px] text-slate-500 dark:text-slate-400">
            No alert emails queued yet. First reads of new papers and minor field updates do not trigger emails.
          </p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {alerts.map((a) => (
              <div key={a.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[14px] font-medium text-slate-900 dark:text-slate-100">
                    {a.state === 'Sent' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                    {a.state === 'Pending' && <Clock className="w-4 h-4 text-blue-600 shrink-0" />}
                    {(a.state === 'Failed' || a.state === 'Not delivered') && (
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span className="truncate">{a.subject}</span>
                  </div>
                  <div className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
                    State: <strong>{a.state}</strong> · To: {a.recipient} · Attempts: {a.attempts} · Created{' '}
                    {formatDateTime(a.createdAt, settings.timezone, settings.dateFormat)}
                    {a.nextRetryAt && a.state === 'Failed' && (
                      <span>
                        {' '}
                        · Next retry: {formatDateTime(a.nextRetryAt, settings.timezone, settings.dateFormat)}
                      </span>
                    )}
                  </div>
                  {a.lastError && a.state !== 'Sent' && (
                    <div className="text-[12px] text-rose-600 dark:text-rose-400 mt-0.5">
                      {a.lastError}
                    </div>
                  )}
                </div>

                {(a.state === 'Failed' || a.state === 'Not delivered') && (
                  <button
                    type="button"
                    onClick={() => onResendAlert(a.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium bg-slate-900 dark:bg-blue-600 text-white rounded-md hover:bg-slate-800"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Resend
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Global Status Change History */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">
            Global status change feed ({filteredHistory.length})
          </h3>
          <div className="flex items-center gap-3">
            <select
              value={journalFilter}
              onChange={(e) => setJournalFilter(e.target.value)}
              aria-label="Filter history by journal"
              className="px-3 py-1.5 text-[14px] bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
            >
              <option value="all">All journals</option>
              {journals.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>

            {history.length > 0 && (
              <button
                type="button"
                onClick={onClearHistory}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear history
              </button>
            )}
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <p className="text-[14px] text-slate-500 dark:text-slate-400 py-3">
            No status transitions recorded yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {filteredHistory.map((h) => (
              <div key={h.eventId} className="py-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-blue-700 dark:text-blue-400">
                    {h.journalName} · {h.manuscriptNumber || 'No MS #'}
                  </div>
                  <div className="text-[14px] font-medium text-slate-900 dark:text-slate-100">
                    {h.paperTitle}
                  </div>
                  <div className="text-[14px] text-slate-700 dark:text-slate-300 mt-0.5">
                    {h.isMinorUpdate ? (
                      <span>Minor update: {h.otherChangedFields.join(', ')}</span>
                    ) : (
                      <span>
                        {h.oldStatus} → <strong>{h.newStatus}</strong>
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Page status date: {formatDateOnly(h.statusDateFromPage, settings.dateFormat)} · Check: {h.checkSource} · Event ID: <span className="font-mono">{h.eventId.slice(0, 8)}</span>
                  </div>
                </div>

                <div className="text-[13px] font-mono text-slate-600 dark:text-slate-400 shrink-0">
                  {formatDateTime(h.detectedAt, settings.timezone, settings.dateFormat)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
