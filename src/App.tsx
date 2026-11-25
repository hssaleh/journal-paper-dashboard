import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart2,
  CheckCheck,
  ClipboardPaste,
  Columns,
  FileSpreadsheet,
  Moon,
  Plus,
  Search,
  Sun,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  AmbiguousMatchPrompt,
  BackupSnapshot,
  DashboardSettings,
  DeletedPaperRecord,
  EmailAlertRecord,
  ExportBundle,
  ExtractedPaper,
  ExtractionResponse,
  HealthState,
  HistoryEntry,
  PaperRecord,
  PaperSourceLink,
} from './types';
import {
  DEFAULT_SETTINGS,
  applyMergeImport,
  computeDaysInStatus,
  createBackupSnapshot,
  deduplicateAndMergePapers,
  formatDateOnly,
  formatDateTime,
  generateId,
  getCandidateKey,
  getEffectivePaperHealth,
  getPaperSources,
  inferTrackerSite,
  isValidWebUrl,
  maskTrackingUrl,
  matchExtractedPaperToExisting,
  normalizeManuscriptNumber,
  normalizeSourceComparisonKey,
  remapHistoryIds,
  resolveStatusGroup,
} from './utils/paperLogic';
import {
  isBadOrGenericJournalName,
  isLikelyDateString,
  resolveJournalNameFromHints,
  stripRevisionTagFromTitle,
} from './utils/journalLookup';
import { generateDashboardExcelBlob } from './utils/excelExport';
import {
  captureTrackerPageText,
  extractPapersFromCapturedText,
  initExtensionBridge,
  subscribeExtensionStatus,
  type PageCaptureResult,
} from './services/extensionBridge';
import {
  initGmailAuth,
  sendEmailViaGmailApi,
  signInWithGoogleForGmail,
  signOutGmail,
} from './services/gmailAuth';
import { TopBar, type ActiveTab } from './components/TopBar';
import { KpiStrip, type KpiFilter } from './components/KpiStrip';
import { AnalyticsGraphs } from './components/AnalyticsGraphs';
import { PapersTable } from './components/PapersTable';
import {
  AmbiguousIdentityModal,
  DeleteConfirmModal,
  ManualAddModal,
  MultiPaperPickerModal,
  PaperDetailModal,
  RecentlyDeletedModal,
  type DiscoveredPaperItem,
} from './components/PaperModals';
import { HistoryAndAlertsView } from './components/HistoryAndAlertsView';
import { SettingsView, SetupView } from './components/SetupAndSettingsView';

const STORAGE_KEYS = {
  papers: 'jpd_papers_v1',
  deleted: 'jpd_deleted_v1',
  history: 'jpd_history_v1',
  alerts: 'jpd_alerts_v1',
  settings: 'jpd_settings_v1',
  identities: 'jpd_identities_v1',
  backups: 'jpd_backups_v1',
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function App() {
  const initialIdRemapRef = useRef<Record<string, string>>({});

  const [papers, setPapers] = useState<PaperRecord[]>(() => {
    const loaded = loadJson<PaperRecord[]>(STORAGE_KEYS.papers, []);
    const cleaned = loaded.map((p) => {
      let updated = p;
      if (!p.userEditedFields?.journalName && isBadOrGenericJournalName(p.journalName)) {
        const resolved = resolveJournalNameFromHints({
          pageText: p.lastSourceText,
          sourceUrl: p.url,
          manuscriptNumber: p.manuscriptNumber,
        });
        updated = {
          ...updated,
          journalName: resolved || 'Journal not shown',
        };
      }
      if (!p.userEditedFields?.title && p.title) {
        const stripped = stripRevisionTagFromTitle(p.title);
        if (stripped && stripped !== p.title) {
          updated = { ...updated, title: stripped };
        }
      }
      return updated;
    });

    const dedup = deduplicateAndMergePapers(cleaned);
    initialIdRemapRef.current = dedup.idRemap;
    return dedup.merged.map((p) => {
      const eff = getEffectivePaperHealth(p);
      return eff !== p.health ? { ...p, health: eff, healthMessage: eff === 'OK' ? null : p.healthMessage } : p;
    });
  });
  const [deletedPapers, setDeletedPapers] = useState<DeletedPaperRecord[]>(() => {
    const items = loadJson<DeletedPaperRecord[]>(STORAGE_KEYS.deleted, []);
    const cutoff = Date.now() - 30 * 86400000;
    return items.filter((d) => new Date(d.deletedAt).getTime() >= cutoff);
  });
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadJson(STORAGE_KEYS.history, []));
  const [alerts, setAlerts] = useState<EmailAlertRecord[]>(() => loadJson(STORAGE_KEYS.alerts, []));
  const [settings, setSettings] = useState<DashboardSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...loadJson<Partial<DashboardSettings>>(STORAGE_KEYS.settings, {}),
  }));
  const [rememberedIdentities, setRememberedIdentities] = useState<Record<string, string>>(() =>
    loadJson(STORAGE_KEYS.identities, {})
  );
  const [backups, setBackups] = useState<BackupSnapshot[]>(() =>
    loadJson(STORAGE_KEYS.backups, [])
  );

  // UI Navigation & Filters
  const [activeTab, setActiveTab] = useState<ActiveTab>('papers');
  const [kpiFilter, setKpiFilter] = useState<KpiFilter>('all');
  const [journalFilter, setJournalFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'manual' | 'last_changed' | 'days_in_status' | 'journal'>(
    'manual'
  );
  const [searchQuery, setSearchQuery] = useState('');

  // Network & Extension & Gmail state
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailUserEmail, setGmailUserEmail] = useState<string | null>(null);
  const [isSigningInGmail, setIsSigningInGmail] = useState(false);

  useEffect(() => {
    void fetch('/api/health')
      .then((r) => r.json())
      .then((data: { geminiConfigured?: boolean }) => {
        if (typeof data?.geminiConfigured === 'boolean') {
          setGeminiConfigured(data.geminiConfigured);
        }
      })
      .catch(() => {});
  }, []);

  // Reading / Refresh state
  const [urlInput, setUrlInput] = useState('');
  const [readingPaperIds, setReadingPaperIds] = useState<Set<string>>(new Set());
  const readingIdsRef = useRef<Set<string>>(new Set());
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState({ done: 0, total: 0 });
  const cancelRefreshAllRef = useRef(false);
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'info' | 'error' | 'success';
    text: string;
    technicalDetails?: string;
  } | null>(null);
  const [showBannerDetails, setShowBannerDetails] = useState(false);

  // Modals
  const [multiPickerState, setMultiPickerState] = useState<{
    sourceUrl: string;
    trackerSite: string;
    sourceText: string;
    items: DiscoveredPaperItem[];
  } | null>(null);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [showPasteTextModal, setShowPasteTextModal] = useState(false);
  const [pasteTextUrl, setPasteTextUrl] = useState('');
  const [pasteTextContent, setPasteTextContent] = useState('');
  const [detailModal, setDetailModal] = useState<{
    paperId: string;
    tab: 'details' | 'edit' | 'history' | 'source';
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PaperRecord | null>(null);
  const [showDeletedDrawer, setShowDeletedDrawer] = useState(false);
  const [ambiguousQueue, setAmbiguousQueue] = useState<AmbiguousMatchPrompt[]>([]);
  const repairedOnMountRef = useRef(false);

  // One-time non-destructive repair for saved papers (date statuses, Non Solus/missing journals, AuthorHub Untitled/dates, merged history IDs)
  useEffect(() => {
    if (repairedOnMountRef.current) return;
    repairedOnMountRef.current = true;

    const initialRemap = initialIdRemapRef.current;
    if (Object.keys(initialRemap).length > 0) {
      setHistory((prev) =>
        prev.map((h) => (initialRemap[h.paperId] ? { ...h, paperId: initialRemap[h.paperId] } : h))
      );
    }

    const candidates = papers.filter((p) => {
      const hasDateStatus = !p.userEditedFields?.currentStatus && isLikelyDateString(p.currentStatus);
      const hasBadJournal = !p.userEditedFields?.journalName && isBadOrGenericJournalName(p.journalName);
      const hasBadTitle =
        !p.userEditedFields?.title &&
        (!p.title || p.title === 'Untitled manuscript' || /^\s*\[/.test(p.title));
      const missingAuthorHubDates =
        getPaperSources(p).some((s) => s.trackerSite.includes('AuthorHub')) &&
        (!p.submissionDate || !p.statusDate);
      return hasDateStatus || hasBadJournal || hasBadTitle || missingAuthorHubDates;
    });
    if (candidates.length === 0) return;

    void (async () => {
      const fixes = new Map<
        string,
        {
          currentStatus?: string;
          statusDate?: string | null;
          submissionDate?: string | null;
          journalName?: string;
          title?: string;
          uncertain?: boolean;
        }
      >();

      for (const p of candidates) {
        let repaired = false;
        const sources = getPaperSources(p);
        for (const src of sources) {
          const textToParse = src.lastSourceText || p.lastSourceText;
          if (!textToParse || textToParse.trim().length < 15) continue;
          try {
            const res = await extractPapersFromCapturedText({
              pageText: textToParse,
              sourceUrl: src.url || p.url,
              provider: 'local_reader',
            });
            if (res.ok && res.pageState === 'ok' && res.papers.length > 0) {
              const matched =
                res.papers.length === 1
                  ? res.papers[0]
                  : res.papers.find((cand) => {
                      const m = matchExtractedPaperToExisting(
                        cand,
                        [p],
                        src.url || p.url,
                        src.trackerSite || p.trackerSite,
                        rememberedIdentities
                      );
                      return m.match?.id === p.id;
                    }) || null;

              if (matched) {
                const prevFix = fixes.get(p.id) || {};
                const cleanTitle =
                  matched.title &&
                  matched.title.toLowerCase() !== 'untitled manuscript' &&
                  !p.userEditedFields?.title
                    ? stripRevisionTagFromTitle(matched.title) || matched.title
                    : undefined;
                const cleanJournal =
                  matched.journalName &&
                  !isBadOrGenericJournalName(matched.journalName) &&
                  !p.userEditedFields?.journalName
                    ? matched.journalName
                    : undefined;
                const cleanStatus =
                  matched.currentStatus &&
                  !isLikelyDateString(matched.currentStatus) &&
                  isLikelyDateString(p.currentStatus) &&
                  !p.userEditedFields?.currentStatus
                    ? matched.currentStatus
                    : undefined;

                fixes.set(p.id, {
                  ...prevFix,
                  currentStatus: cleanStatus || prevFix.currentStatus,
                  statusDate: matched.statusDate || prevFix.statusDate || p.statusDate,
                  submissionDate: matched.submissionDate || prevFix.submissionDate || p.submissionDate,
                  journalName: cleanJournal || prevFix.journalName,
                  title:
                    cleanTitle &&
                    (p.title === 'Untitled manuscript' || cleanTitle.length > p.title.length)
                      ? cleanTitle
                      : prevFix.title,
                  uncertain: false,
                });
                repaired = true;
              }
            }
          } catch {
            // ignore and fall back cleanly
          }
        }
        if (!repaired && isLikelyDateString(p.currentStatus)) {
          fixes.set(p.id, { uncertain: true });
        }
      }

      if (fixes.size > 0) {
        let postRepairRemap: Record<string, string> = {};
        setPapers((prev) => {
          const updatedList = prev.map((p) => {
            const fix = fixes.get(p.id);
            if (!fix) return p;
            return {
              ...p,
              currentStatus: fix.currentStatus || p.currentStatus,
              statusDate: fix.statusDate !== undefined ? fix.statusDate : p.statusDate,
              submissionDate:
                fix.submissionDate !== undefined ? fix.submissionDate : p.submissionDate,
              journalName: fix.journalName || p.journalName,
              title: fix.title || p.title,
              uncertainFields: fix.uncertain
                ? Array.from(new Set([...p.uncertainFields, 'currentStatus']))
                : p.uncertainFields.filter((f) => f !== 'currentStatus'),
            };
          });
          const dedup = deduplicateAndMergePapers(updatedList);
          postRepairRemap = dedup.idRemap;
          return dedup.merged;
        });

        if (Object.keys(postRepairRemap).length > 0) {
          setHistory((prev) => remapHistoryIds(prev, postRepairRemap));
        }
      }
    })();
    // Run once on initial mount using loaded papers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.papers, JSON.stringify(papers));
  }, [papers]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.deleted, JSON.stringify(deletedPapers));
  }, [deletedPapers]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
  }, [history]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.alerts, JSON.stringify(alerts));
  }, [alerts]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.identities, JSON.stringify(rememberedIdentities));
  }, [rememberedIdentities]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.backups, JSON.stringify(backups));
  }, [backups]);

  // Online / Offline listeners
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Gmail Auth listener
  useEffect(() => {
    return initGmailAuth(
      (user) => {
        setGmailConnected(true);
        setGmailUserEmail(user.email || null);
      },
      () => {
        setGmailConnected(false);
        setGmailUserEmail(null);
      }
    );
  }, []);

  const handleSignInGmail = async () => {
    setIsSigningInGmail(true);
    try {
      const res = await signInWithGoogleForGmail();
      setGmailConnected(true);
      setGmailUserEmail(res.user.email || null);
      setBannerMessage({
        type: 'success',
        text: `Connected Gmail (${res.user.email || 'signed in'}) for status alerts.`,
      });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Google sign-in was cancelled or failed.',
      });
    } finally {
      setIsSigningInGmail(false);
    }
  };

  const handleSignOutGmail = async () => {
    await signOutGmail();
    setGmailConnected(false);
    setGmailUserEmail(null);
  };

  /* ------------------------------------------------------------------------ */
  /* Email Alert Dispatch & Retry Logic (Spec Section 10)                     */
  /* ------------------------------------------------------------------------ */
  const attemptDeliverAlert = useCallback(
    async (alert: EmailAlertRecord) => {
      const nowIso = new Date().toISOString();
      const res = await sendEmailViaGmailApi({
        to: alert.recipient,
        subject: alert.subject,
        bodyText: alert.bodyText,
        simulateFailure: settings.simulateEmailFailure,
      });

      setAlerts((prev) =>
        prev.map((a) => {
          if (a.id !== alert.id) return a;
          const nextAttempts = a.attempts + 1;
          if (res.ok) {
            return {
              ...a,
              state: 'Sent',
              attempts: nextAttempts,
              lastAttemptAt: nowIso,
              nextRetryAt: null,
              lastError: undefined,
            };
          }

          // Retry schedule: 5 min -> 30 min -> every 2h up to 24h -> Not delivered
          const elapsedHours = (Date.now() - new Date(a.createdAt).getTime()) / 3600000;
          if (elapsedHours >= 24) {
            return {
              ...a,
              state: 'Not delivered',
              attempts: nextAttempts,
              lastAttemptAt: nowIso,
              nextRetryAt: null,
              lastError: res.error,
            };
          }
          const delayMs =
            nextAttempts === 1 ? 5 * 60000 : nextAttempts === 2 ? 30 * 60000 : 120 * 60000;
          return {
            ...a,
            state: 'Failed',
            attempts: nextAttempts,
            lastAttemptAt: nowIso,
            nextRetryAt: new Date(Date.now() + delayMs).toISOString(),
            lastError: res.error,
          };
        })
      );
      return res;
    },
    [settings.simulateEmailFailure]
  );

  const enqueueAndSendTransitionAlerts = useCallback(
    async (
      transitions: Array<{
        paper: PaperRecord;
        entry: HistoryEntry;
      }>
    ) => {
      if (transitions.length === 0) return;

      // Deduplicate by eventId so the same event ID never produces >1 email
      const alreadyQueuedEventIds = new Set(alerts.flatMap((a) => a.eventIds));
      const fresh = transitions.filter((t) => !alreadyQueuedEventIds.has(t.entry.eventId));
      if (fresh.length === 0) return;

      const nowIso = new Date().toISOString();
      const lines = fresh.map(({ paper, entry }) => {
        const linkPart = settings.includeWorkingLinkInEmail
          ? `\n   Link: ${paper.url}`
          : '';
        return (
          `• ${entry.journalName} (${entry.manuscriptNumber || 'No MS #'})\n` +
          `  Title: ${entry.paperTitle}\n` +
          `  Change: ${entry.oldStatus} → ${entry.newStatus}\n` +
          `  Page status date: ${formatDateOnly(entry.statusDateFromPage, settings.dateFormat)} | Detected: ${formatDateTime(
            entry.detectedAt,
            settings.timezone,
            settings.dateFormat
          )} | Tracker: ${entry.trackerSite}${linkPart}`
        );
      });

      const subject =
        fresh.length === 1
          ? `[Journal Update] ${fresh[0].entry.journalName}: ${fresh[0].entry.newStatus}`
          : `[Journal Updates] ${fresh.length} papers changed status`;

      const bodyText =
        `Journal Paper Dashboard detected ${fresh.length} status change(s):\n\n` +
        lines.join('\n\n') +
        `\n\nChecks run while your PC is on and the browser is open.`;

      const newAlert: EmailAlertRecord = {
        id: generateId(),
        eventIds: fresh.map((t) => t.entry.eventId),
        recipient: settings.recipientEmail || 'hssaleh@gmail.com',
        subject,
        bodyText,
        state: 'Pending',
        attempts: 0,
        createdAt: nowIso,
        lastAttemptAt: null,
        nextRetryAt: null,
        type: 'status_change',
      };

      setAlerts((prev) => [newAlert, ...prev]);

      if (settings.emailMode === 'per_change' || settings.emailMode === 'both') {
        await attemptDeliverAlert(newAlert);
      }
    },
    [alerts, attemptDeliverAlert, settings]
  );

  // Retry failed emails & 24h stale paper check every 60s
  useEffect(() => {
    const timer = setInterval(() => {
      if (!isOnline) return;
      const now = Date.now();
      alerts.forEach((a) => {
        if (a.state === 'Failed' && a.nextRetryAt && new Date(a.nextRetryAt).getTime() <= now) {
          void attemptDeliverAlert(a);
        }
      });

      // 24h stale paper low-frequency notification
      const staleCandidates = papers.filter((p) => {
        if (p.paused || p.url === 'manual://entry' || p.isTestRecord) return false;
        const lastOk = p.lastSuccessfulReadAt ? new Date(p.lastSuccessfulReadAt).getTime() : 0;
        if (!lastOk || now - lastOk < 24 * 3600000) return false;
        const lastStaleSent = p.staleAlertSentAt ? new Date(p.staleAlertSentAt).getTime() : 0;
        return !lastStaleSent || now - lastStaleSent >= 24 * 3600000;
      });

      if (staleCandidates.length > 0 && gmailConnected) {
        const nowIso = new Date().toISOString();
        const alert: EmailAlertRecord = {
          id: generateId(),
          eventIds: [],
          recipient: settings.recipientEmail || 'hssaleh@gmail.com',
          subject: `[Journal Dashboard] ${staleCandidates.length} paper(s) not read in 24h`,
          bodyText:
            `The following paper(s) have not been read successfully in the last 24 hours:\n\n` +
            staleCandidates
              .map((p) => `• ${p.journalName} (${p.manuscriptNumber || 'No MS #'}) — ${p.health}`)
              .join('\n'),
          state: 'Pending',
          attempts: 0,
          createdAt: nowIso,
          lastAttemptAt: null,
          nextRetryAt: null,
          type: 'stale_24h',
        };
        setAlerts((prev) => [alert, ...prev]);
        setPapers((prev) =>
          prev.map((p) =>
            staleCandidates.some((s) => s.id === p.id) ? { ...p, staleAlertSentAt: nowIso } : p
          )
        );
        void attemptDeliverAlert(alert);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [alerts, attemptDeliverAlert, gmailConnected, isOnline, papers, settings.recipientEmail]);

  /* ------------------------------------------------------------------------ */
  /* Core Paper Merging & Creation Helper                                     */
  /* ------------------------------------------------------------------------ */
  const createRecordFromExtracted = (
    ext: ExtractedPaper,
    sourceUrl: string,
    trackerSite: string,
    sourceText: string,
    orderIndex: number,
    isListSource: boolean,
    isTestRecord = false
  ): PaperRecord => {
    const nowIso = new Date().toISOString();
    const resolvedJournal =
      ext.journalName && !isBadOrGenericJournalName(ext.journalName)
        ? ext.journalName
        : resolveJournalNameFromHints({
            pageText: sourceText,
            sourceUrl,
            manuscriptNumber: ext.manuscriptNumber,
          });
    const safeStatus =
      ext.currentStatus && !isLikelyDateString(ext.currentStatus)
        ? ext.currentStatus
        : 'Status not shown';
    const cleanedTitle =
      stripRevisionTagFromTitle(ext.title) || ext.title || 'Untitled manuscript';

    const initialSource: PaperSourceLink = {
      id: generateId(),
      url: sourceUrl,
      trackerSite,
      manuscriptNumber: ext.manuscriptNumber,
      currentStatus: safeStatus,
      statusDate: ext.statusDate,
      submissionDate: ext.submissionDate,
      reviewCount: ext.reviewCount,
      editorOrTeam: ext.editorOrTeam,
      decision: ext.decision,
      lastCheckedAt: nowIso,
      lastSuccessfulReadAt: nowIso,
      health: 'OK',
      healthMessage: null,
      healthTechnicalDetails: null,
      lastSourceText: sourceText,
      sourceListUrl: isListSource ? sourceUrl : undefined,
      consecutiveFailures: 0,
      nextRetryAt: null,
    };

    return {
      id: generateId(),
      orderIndex,
      url: sourceUrl,
      trackerSite,
      sources: [initialSource],
      journalName: resolvedJournal || 'Journal not shown',
      title: cleanedTitle,
      manuscriptNumber: ext.manuscriptNumber,
      revision: ext.revision,
      submissionType: ext.submissionType,
      submissionDate: ext.submissionDate,
      submissionDateAmbiguous: ext.submissionDateAmbiguous,
      currentStatus: safeStatus,
      statusDate: ext.statusDate,
      statusDateAmbiguous: ext.statusDateAmbiguous,
      editorOrTeam: ext.editorOrTeam,
      reviewCount: ext.reviewCount,
      decision: ext.decision,
      notes: '',
      paused: false,
      userEditedFields: {},
      allowAutoOverwriteFields: {},
      uncertainFields: ext.uncertainFields || [],
      lastSourceText: sourceText,
      firstSeenAt: nowIso,
      statusFirstSeenAt: nowIso,
      lastCheckedAt: nowIso,
      lastSuccessfulReadAt: nowIso,
      lastChangedAt: null,
      health: 'OK',
      healthMessage: null,
      healthTechnicalDetails: null,
      hasUnseenChange: false,
      unseenDetectedAt: null,
      hasMinorUpdate: false,
      minorUpdateAt: null,
      consecutiveFailures: 0,
      nextRetryAt: null,
      staleAlertSentAt: null,
      sourceListUrl: isListSource ? sourceUrl : undefined,
      isTestRecord,
    };
  };

  const applyExtractedUpdateToPaper = useCallback(
    (
      existing: PaperRecord,
      ext: ExtractedPaper,
      sourceText: string,
      checkSource: 'manual' | 'scheduled' | 'test',
      newUrl?: string,
      sourceTrackerSite?: string
    ): {
      updated: PaperRecord;
      transitionEntry: HistoryEntry | null;
      minorEntry: HistoryEntry | null;
    } => {
      const nowIso = new Date().toISOString();
      const canOverwrite = (field: string) =>
        !existing.userEditedFields[field] || Boolean(existing.allowAutoOverwriteFields[field]);

      const effectiveUrl = newUrl || existing.url;
      const effectiveSite =
        sourceTrackerSite || (newUrl ? inferTrackerSite(newUrl) : existing.trackerSite);

      const rawIncomingStatus = ext.currentStatus?.trim();
      const incomingStatus =
        rawIncomingStatus && !isLikelyDateString(rawIncomingStatus) ? rawIncomingStatus : undefined;

      const existingSources = getPaperSources(existing);
      const targetKey = normalizeSourceComparisonKey(effectiveUrl, effectiveSite);
      const updatedSources = [...existingSources];
      const matchedSrcIdx = updatedSources.findIndex(
        (s) => normalizeSourceComparisonKey(s.url, s.trackerSite) === targetKey
      );

      const nextSourcePatch: PaperSourceLink = {
        id: matchedSrcIdx !== -1 ? updatedSources[matchedSrcIdx].id : generateId(),
        url: effectiveUrl,
        trackerSite: effectiveSite,
        manuscriptNumber: ext.manuscriptNumber || updatedSources[matchedSrcIdx]?.manuscriptNumber || null,
        currentStatus: incomingStatus || updatedSources[matchedSrcIdx]?.currentStatus || 'Status not shown',
        statusDate: ext.statusDate || updatedSources[matchedSrcIdx]?.statusDate || null,
        submissionDate: ext.submissionDate || updatedSources[matchedSrcIdx]?.submissionDate || null,
        reviewCount: ext.reviewCount ?? updatedSources[matchedSrcIdx]?.reviewCount ?? null,
        editorOrTeam: ext.editorOrTeam || updatedSources[matchedSrcIdx]?.editorOrTeam || null,
        decision: ext.decision || updatedSources[matchedSrcIdx]?.decision || null,
        lastCheckedAt: nowIso,
        lastSuccessfulReadAt: nowIso,
        health: existing.paused ? 'Paused' : 'OK',
        healthMessage: null,
        healthTechnicalDetails: null,
        lastSourceText: sourceText,
        sourceListUrl: updatedSources[matchedSrcIdx]?.sourceListUrl,
        consecutiveFailures: 0,
        nextRetryAt: null,
      };

      if (matchedSrcIdx !== -1) {
        updatedSources[matchedSrcIdx] = nextSourcePatch;
      } else {
        updatedSources.push(nextSourcePatch);
      }

      const next: PaperRecord = {
        ...existing,
        url: existing.url && existing.url !== 'manual://entry' ? existing.url : effectiveUrl,
        sources: updatedSources,
        lastCheckedAt: nowIso,
        lastSuccessfulReadAt: nowIso,
        health: existing.paused ? 'Paused' : 'OK',
        healthMessage: null,
        healthTechnicalDetails: null,
        consecutiveFailures: 0,
        nextRetryAt: null,
        lastSourceText:
          sourceText.length >= (existing.lastSourceText || '').length ||
          effectiveSite === existing.trackerSite
            ? sourceText
            : existing.lastSourceText,
        uncertainFields: ext.uncertainFields || [],
      };

      const minorChangedFields: string[] = [];
      const updateField = <K extends keyof PaperRecord>(
        field: K,
        incoming: PaperRecord[K] | null | undefined,
        label: string
      ) => {
        if (incoming === null || incoming === undefined || incoming === '') return;
        if (!canOverwrite(String(field))) return;
        if (existing[field] !== incoming) {
          next[field] = incoming;
          minorChangedFields.push(label);
        }
      };

      const resolvedJournal =
        ext.journalName && !isBadOrGenericJournalName(ext.journalName)
          ? ext.journalName
          : resolveJournalNameFromHints({
              pageText: sourceText,
              sourceUrl: effectiveUrl,
              manuscriptNumber: ext.manuscriptNumber || existing.manuscriptNumber,
            });
      if (
        resolvedJournal &&
        !isBadOrGenericJournalName(resolvedJournal) &&
        (isBadOrGenericJournalName(existing.journalName) ||
          effectiveSite === existing.trackerSite)
      ) {
        updateField('journalName', resolvedJournal, 'journal');
      }

      const cleanedIncomingTitle = ext.title
        ? stripRevisionTagFromTitle(ext.title) || ext.title
        : null;
      const incomingTitleValid =
        cleanedIncomingTitle &&
        cleanedIncomingTitle.toLowerCase() !== 'untitled manuscript' &&
        cleanedIncomingTitle.toLowerCase() !== 'untitled';
      const existingTitleGeneric =
        !existing.title ||
        existing.title.toLowerCase() === 'untitled manuscript' ||
        existing.title.toLowerCase() === 'untitled';
      if (
        incomingTitleValid &&
        (existingTitleGeneric || cleanedIncomingTitle!.length >= existing.title.length)
      ) {
        updateField('title', cleanedIncomingTitle, 'title');
      }

      updateField('manuscriptNumber', ext.manuscriptNumber, 'manuscript number');
      updateField('revision', ext.revision, 'revision');
      updateField('submissionType', ext.submissionType, 'submission type');
      updateField('submissionDate', ext.submissionDate, 'submission date');
      if (canOverwrite('submissionDate')) {
        next.submissionDateAmbiguous = ext.submissionDateAmbiguous;
      }
      if (ext.statusDate && (!existing.statusDate || ext.statusDate >= existing.statusDate)) {
        updateField('statusDate', ext.statusDate, 'status date');
      }
      if (canOverwrite('statusDate')) {
        next.statusDateAmbiguous = ext.statusDateAmbiguous;
      }
      updateField('editorOrTeam', ext.editorOrTeam, 'editor');
      if (ext.reviewCount !== null && canOverwrite('reviewCount') && existing.reviewCount !== ext.reviewCount) {
        next.reviewCount = ext.reviewCount;
        minorChangedFields.push('reviews');
      }
      updateField('decision', ext.decision, 'decision');

      let transitionEntry: HistoryEntry | null = null;
      let minorEntry: HistoryEntry | null = null;

      const statusUncertain = (ext.uncertainFields || []).includes('currentStatus');

      if (
        incomingStatus &&
        canOverwrite('currentStatus') &&
        incomingStatus !== existing.currentStatus
      ) {
        next.currentStatus = incomingStatus;
        next.statusFirstSeenAt = nowIso;
        next.lastChangedAt = nowIso;

        if (!statusUncertain) {
          next.hasUnseenChange = true;
          next.unseenDetectedAt = nowIso;
          transitionEntry = {
            eventId: generateId(),
            paperId: existing.id,
            paperTitle: next.title,
            journalName: next.journalName,
            manuscriptNumber: next.manuscriptNumber,
            trackerSite: effectiveSite,
            detectedAt: nowIso,
            oldStatus: existing.currentStatus,
            newStatus: incomingStatus,
            statusDateFromPage: next.statusDate,
            otherChangedFields: minorChangedFields,
            checkSource,
            isMinorUpdate: false,
          };
        }
      } else if (minorChangedFields.length > 0) {
        next.hasMinorUpdate = true;
        next.minorUpdateAt = nowIso;
        minorEntry = {
          eventId: generateId(),
          paperId: existing.id,
          paperTitle: next.title,
          journalName: next.journalName,
          manuscriptNumber: next.manuscriptNumber,
          trackerSite: effectiveSite,
          detectedAt: nowIso,
          oldStatus: existing.currentStatus,
          newStatus: existing.currentStatus,
          statusDateFromPage: next.statusDate,
          otherChangedFields: minorChangedFields,
          checkSource,
          isMinorUpdate: true,
        };
      }

      return { updated: next, transitionEntry, minorEntry };
    },
    []
  );

  /* ------------------------------------------------------------------------ */
  /* Refresh Single Paper (Multi-source reload-first, never wipes data)       */
  /* ------------------------------------------------------------------------ */
  const refreshSinglePaper = useCallback(
    async (
      paperId: string,
      checkSource: 'manual' | 'scheduled' | 'test' = 'manual',
      overrideUrl?: string,
      sessionCache?: {
        captures: Map<string, PageCaptureResult>;
        extractions: Map<string, ExtractionResponse>;
      }
    ) => {
      if (readingIdsRef.current.has(paperId)) return;
      const targetPaper = papers.find((p) => p.id === paperId);
      if (!targetPaper) return;

      const sourcesToRead: PaperSourceLink[] = overrideUrl
        ? [
            {
              id: `${targetPaper.id}-override`,
              url: overrideUrl,
              trackerSite: inferTrackerSite(overrideUrl),
              lastCheckedAt: targetPaper.lastCheckedAt,
              lastSuccessfulReadAt: targetPaper.lastSuccessfulReadAt,
              health: targetPaper.health,
              healthMessage: targetPaper.healthMessage,
            },
          ]
        : getPaperSources(targetPaper).filter((s) => s.url && s.url !== 'manual://entry');

      if (sourcesToRead.length === 0) {
        setBannerMessage({
          type: 'info',
          text: `"${targetPaper.title}" was added by hand without a tracker URL.`,
        });
        return;
      }

      readingIdsRef.current.add(paperId);
      setReadingPaperIds(new Set(readingIdsRef.current));

      try {
        let workingPaper: PaperRecord = targetPaper;
        let succeededCount = 0;
        const failureState: {
          health: HealthState;
          msg: string;
          tech: string | null;
        } = {
          health: 'Layout changed',
          msg: 'Could not read page. Saved data kept intact.',
          tech: null,
        };
        const newTransitions: Array<{ paper: PaperRecord; entry: HistoryEntry }> = [];
        const newMinorEntries: HistoryEntry[] = [];

        const recordSourceFailure = (
          src: PaperSourceLink,
          health: HealthState,
          message: string,
          techDetails?: string | null,
          capturedText?: string
        ) => {
          const nowIso = new Date().toISOString();
          failureState.health = health;
          failureState.msg = message;
          failureState.tech = techDetails || null;

          const currentSources = getPaperSources(workingPaper);
          const nextFailures = (src.consecutiveFailures ?? workingPaper.consecutiveFailures) + 1;
          const retryDelayMs =
            nextFailures === 1 ? 60000 : nextFailures === 2 ? 5 * 60000 : null;
          const nextRetryAt =
            retryDelayMs && health !== 'Sign-in needed' && health !== 'Tab not open'
              ? new Date(Date.now() + retryDelayMs).toISOString()
              : null;

          const updatedSources = currentSources.map((item) =>
            item.id === src.id ||
            normalizeSourceComparisonKey(item.url, item.trackerSite) ===
              normalizeSourceComparisonKey(src.url, src.trackerSite)
              ? {
                  ...item,
                  lastCheckedAt: nowIso,
                  health,
                  healthMessage: message,
                  healthTechnicalDetails: techDetails || null,
                  consecutiveFailures: nextFailures,
                  nextRetryAt,
                  lastSourceText: capturedText || item.lastSourceText,
                }
              : item
          );

          workingPaper = {
            ...workingPaper,
            sources: updatedSources,
            lastCheckedAt: nowIso,
            lastSourceText: capturedText || workingPaper.lastSourceText,
          };
        };

        const findMatchedPaper = (extraction: ExtractionResponse, src: PaperSourceLink): ExtractedPaper | null => {
          if (extraction.papers.length === 0) return null;
          for (const candidate of extraction.papers) {
            const m = matchExtractedPaperToExisting(
              candidate,
              [workingPaper],
              src.url,
              src.trackerSite,
              rememberedIdentities
            );
            if (m.match?.id === workingPaper.id) {
              return candidate;
            }
          }
          if (extraction.papers.length === 1 && !src.sourceListUrl) {
            const only = extraction.papers[0];
            const candMs = normalizeManuscriptNumber(only.manuscriptNumber);
            const workMs = normalizeManuscriptNumber(workingPaper.manuscriptNumber);
            if (!candMs || !workMs || candMs === workMs) {
              return only;
            }
          }
          return null;
        };

        for (const src of sourcesToRead) {
          const cacheKey = normalizeSourceComparisonKey(src.url, src.trackerSite);
          const hints = {
            manuscriptNumber: workingPaper.manuscriptNumber,
            title: workingPaper.title,
          };
          const hadCachedCapture = Boolean(sessionCache?.captures.has(cacheKey));
          let capture = sessionCache?.captures.get(cacheKey);
          if (!capture) {
            capture = await captureTrackerPageText(src.url, 12000, hints);
            if (sessionCache) {
              sessionCache.captures.set(cacheKey, capture);
            }
          }

          if (!capture.ok || !capture.text) {
            const health: HealthState =
              capture.code === 'NO_OPEN_TAB'
                ? 'Tab not open'
                : capture.code === 'TIMEOUT'
                ? 'Timed out'
                : capture.code === 'SIGN_IN_NEEDED'
                ? 'Sign-in needed'
                : capture.code === 'NOT_FOUND'
                ? 'Not found'
                : 'Layout changed';
            recordSourceFailure(
              src,
              health,
              capture.error || 'Could not read page. Saved data kept intact.',
              capture.technicalDetails
            );
            continue;
          }

          let extraction = sessionCache?.extractions.get(cacheKey);
          if (!extraction) {
            extraction = await extractPapersFromCapturedText({
              pageText: capture.text,
              sourceUrl: src.url,
              pageTitle: capture.title,
              provider: settings.aiProvider,
            });
            if (sessionCache && extraction.ok) {
              sessionCache.extractions.set(cacheKey, extraction);
            }
          }

          if (!extraction.ok || extraction.pageState === 'ai_error') {
            recordSourceFailure(
              src,
              'AI error',
              extraction.error || 'AI could not read this page. Saved data kept intact.',
              extraction.technicalDetails,
              capture.text
            );
            continue;
          }

          if (extraction.pageState === 'sign_in_needed') {
            recordSourceFailure(
              src,
              'Sign-in needed',
              'Your session expired. Open the page and sign in again.',
              null,
              capture.text
            );
            continue;
          }

          if (extraction.pageState === 'not_found') {
            recordSourceFailure(
              src,
              'Not found',
              'Tracker page returned Not Found. Saved data kept intact.',
              null,
              capture.text
            );
            continue;
          }

          let capturedText = capture.text;
          let matchedExt: ExtractedPaper | null = findMatchedPaper(extraction, src);

          // If a cached portal tab didn't list this paper, ask the extension to check other open tabs for the same portal
          if (!matchedExt && hadCachedCapture && !src.url.includes('/api/test-tracker/')) {
            const altCapture = await captureTrackerPageText(src.url, 12000, hints);
            if (altCapture.ok && altCapture.text && altCapture.text !== capturedText) {
              const altText = altCapture.text;
              const altExtraction = await extractPapersFromCapturedText({
                pageText: altText,
                sourceUrl: src.url,
                pageTitle: altCapture.title,
                provider: settings.aiProvider,
              });
              if (altExtraction.ok && altExtraction.pageState === 'ok') {
                const altMatch = findMatchedPaper(altExtraction, src);
                if (altMatch) {
                  capture = altCapture;
                  capturedText = altText;
                  extraction = altExtraction;
                  matchedExt = altMatch;
                }
              }
            }
          }

          if (!matchedExt) {
            recordSourceFailure(
              src,
              'Not found',
              'Not in list, check page. Last saved data kept intact.',
              null,
              capturedText
            );
            continue;
          }

          const { updated, transitionEntry, minorEntry } = applyExtractedUpdateToPaper(
            workingPaper,
            matchedExt,
            capturedText,
            checkSource,
            src.url,
            src.trackerSite
          );
          workingPaper = updated;
          succeededCount++;
          if (transitionEntry) {
            newTransitions.push({ paper: updated, entry: transitionEntry });
          } else if (minorEntry) {
            newMinorEntries.push(minorEntry);
          }
        }

        const anyOtherSourceOk = getPaperSources(workingPaper).some((s) => s.health === 'OK');

        if (succeededCount === 0 && !anyOtherSourceOk) {
          const nextFailures = workingPaper.consecutiveFailures + 1;
          const retryDelayMs =
            nextFailures === 1 ? 60000 : nextFailures === 2 ? 5 * 60000 : null;
          workingPaper = {
            ...workingPaper,
            health: workingPaper.paused ? 'Paused' : failureState.health,
            healthMessage: failureState.msg,
            healthTechnicalDetails: failureState.tech,
            consecutiveFailures: nextFailures,
            nextRetryAt:
              retryDelayMs &&
              failureState.health !== 'Sign-in needed' &&
              failureState.health !== 'Tab not open'
                ? new Date(Date.now() + retryDelayMs).toISOString()
                : null,
          };
        } else if (succeededCount === 0 && anyOtherSourceOk) {
          workingPaper = {
            ...workingPaper,
            health: workingPaper.paused ? 'Paused' : 'OK',
            healthMessage: `A linked portal had an issue (${failureState.health}), while another linked source remains OK.`,
            healthTechnicalDetails: failureState.tech,
          };
        } else if (succeededCount < sourcesToRead.length) {
          workingPaper = {
            ...workingPaper,
            health: workingPaper.paused ? 'Paused' : 'OK',
            healthMessage: `Updated ${succeededCount}/${sourcesToRead.length} linked portal(s). Another linked portal could not be read (${failureState.msg}).`,
            healthTechnicalDetails: failureState.tech,
          };
        }

        setPapers((prev) => prev.map((p) => (p.id === paperId ? workingPaper : p)));
        if (newTransitions.length > 0) {
          setHistory((prev) => [...newTransitions.map((t) => t.entry), ...prev]);
          await enqueueAndSendTransitionAlerts(newTransitions);
        } else if (newMinorEntries.length > 0) {
          setHistory((prev) => [...newMinorEntries, ...prev]);
        }
      } finally {
        readingIdsRef.current.delete(paperId);
        setReadingPaperIds(new Set(readingIdsRef.current));
      }
    },
    [
      applyExtractedUpdateToPaper,
      enqueueAndSendTransitionAlerts,
      papers,
      rememberedIdentities,
      settings.aiProvider,
    ]
  );

  /* ------------------------------------------------------------------------ */
  /* Add Paper by Link or Pasted Page Text                                    */
  /* ------------------------------------------------------------------------ */
  const processCapturedPageForAdd = useCallback(
    async (
      rawUrl: string,
      pageText: string,
      pageTitle?: string,
      isTestRecord = false
    ) => {
      const trackerSite = inferTrackerSite(rawUrl);
      const extraction = await extractPapersFromCapturedText({
        pageText,
        sourceUrl: rawUrl,
        pageTitle,
        provider: settings.aiProvider,
      });

      if (!extraction.ok || extraction.pageState === 'ai_error') {
        setShowBannerDetails(false);
        setBannerMessage({
          type: 'error',
          text:
            extraction.error ||
            'Could not read manuscript fields from this page. Try "Add by hand" if needed.',
          technicalDetails: extraction.technicalDetails,
        });
        return;
      }

      if (extraction.pageState === 'sign_in_needed') {
        setBannerMessage({
          type: 'error',
          text: 'Sign-in needed: this page shows a login screen. Sign in inside your browser and connect the companion extension, or use "Paste text".',
        });
        return;
      }

      if (extraction.pageState === 'not_found') {
        setBannerMessage({
          type: 'error',
          text: 'That tracker link returned Not Found (404). No paper was added.',
        });
        return;
      }

      const found = extraction.papers;
      if (found.length > 1) {
        // Multi-paper page: show "Found N papers", mark already tracked ticked & greyed!
        // Also silently link/update any matched existing paper if this portal wasn't attached yet.
        const matchedUpdates = new Map<string, PaperRecord>();
        const items: DiscoveredPaperItem[] = found.map((ext) => {
          const m = matchExtractedPaperToExisting(
            ext,
            papers,
            rawUrl,
            trackerSite,
            rememberedIdentities
          );
          if (m.match) {
            const { updated } = applyExtractedUpdateToPaper(
              matchedUpdates.get(m.match.id) || m.match,
              ext,
              pageText,
              'manual',
              rawUrl,
              trackerSite
            );
            matchedUpdates.set(m.match.id, updated);
            return { extracted: ext, alreadyTrackedPaper: updated };
          }
          return { extracted: ext, alreadyTrackedPaper: null };
        });

        if (matchedUpdates.size > 0) {
          setPapers((prev) => prev.map((p) => matchedUpdates.get(p.id) || p));
        }

        setMultiPickerState({
          sourceUrl: rawUrl,
          trackerSite,
          sourceText: pageText,
          items,
        });
        return;
      }

      // Single paper found
      const ext = found[0];
      const matchRes = matchExtractedPaperToExisting(
        ext,
        papers,
        rawUrl,
        trackerSite,
        rememberedIdentities
      );

      if (matchRes.ambiguousCandidates.length > 1) {
        setAmbiguousQueue((prev) => [
          ...prev,
          {
            id: generateId(),
            extracted: ext,
            sourceUrl: rawUrl,
            trackerSite,
            sourceText: pageText,
            candidates: matchRes.ambiguousCandidates,
          },
        ]);
        return;
      }

      if (matchRes.match) {
        const { updated, transitionEntry, minorEntry } = applyExtractedUpdateToPaper(
          matchRes.match,
          ext,
          pageText,
          'manual',
          rawUrl,
          trackerSite
        );
        setPapers((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        if (transitionEntry) {
          setHistory((prev) => [transitionEntry, ...prev]);
          await enqueueAndSendTransitionAlerts([{ paper: updated, entry: transitionEntry }]);
        } else if (minorEntry) {
          setHistory((prev) => [minorEntry, ...prev]);
        }
        const sourceCount = getPaperSources(updated).length;
        setBannerMessage({
          type: 'info',
          text:
            sourceCount > 1
              ? `Merged "${trackerSite}" into "${updated.title}" (${sourceCount} linked portals in one box).`
              : `Paper "${updated.title}" is already tracked — refreshed its data without creating a duplicate.`,
        });
        return;
      }

      const nextOrder = papers.reduce((max, p) => Math.max(max, p.orderIndex), -1) + 1;
      const newRecord = createRecordFromExtracted(
        ext,
        rawUrl,
        trackerSite,
        pageText,
        nextOrder,
        false,
        isTestRecord
      );
      setPapers((prev) => [...prev, newRecord]);
      setBannerMessage({
        type: 'success',
        text: `Added "${newRecord.title}" (${newRecord.journalName}). Starting status recorded.`,
      });
    },
    [
      applyExtractedUpdateToPaper,
      enqueueAndSendTransitionAlerts,
      papers,
      rememberedIdentities,
      settings.aiProvider,
    ]
  );

  const handleAddLink = useCallback(
    async (rawInput: string, isTestRecord = false) => {
      const trimmed = rawInput.trim();
      if (!isValidWebUrl(trimmed)) {
        setBannerMessage({
          type: 'error',
          text: 'Please paste a valid web address starting with https:// or http://. No record was created.',
        });
        return;
      }

      setIsAddingUrl(true);
      setBannerMessage(null);

      // Show a temporary "Reading..." placeholder row immediately while fetching (Spec 5.12)
      const tempId = `reading-${generateId()}`;
      const tempOrder = papers.reduce((max, p) => Math.max(max, p.orderIndex), -1) + 1;
      const placeholder: PaperRecord = {
        id: tempId,
        orderIndex: tempOrder,
        url: trimmed,
        trackerSite: inferTrackerSite(trimmed),
        journalName: 'Reading…',
        title: maskTrackingUrl(trimmed),
        manuscriptNumber: null,
        revision: null,
        submissionType: null,
        submissionDate: null,
        submissionDateAmbiguous: false,
        currentStatus: 'Reading…',
        statusDate: null,
        statusDateAmbiguous: false,
        editorOrTeam: null,
        reviewCount: null,
        decision: null,
        notes: '',
        paused: false,
        userEditedFields: {},
        allowAutoOverwriteFields: {},
        uncertainFields: [],
        lastSourceText: '',
        firstSeenAt: new Date().toISOString(),
        statusFirstSeenAt: new Date().toISOString(),
        lastCheckedAt: null,
        lastSuccessfulReadAt: null,
        lastChangedAt: null,
        health: 'OK',
        healthMessage: null,
        healthTechnicalDetails: null,
        hasUnseenChange: false,
        unseenDetectedAt: null,
        hasMinorUpdate: false,
        minorUpdateAt: null,
        consecutiveFailures: 0,
        nextRetryAt: null,
        staleAlertSentAt: null,
      };

      setPapers((prev) => [...prev, placeholder]);
      readingIdsRef.current.add(tempId);
      setReadingPaperIds(new Set(readingIdsRef.current));

      try {
        const capture = await captureTrackerPageText(trimmed);
        // Remove temporary placeholder before inserting real / picker result
        setPapers((prev) => prev.filter((p) => p.id !== tempId));
        readingIdsRef.current.delete(tempId);
        setReadingPaperIds(new Set(readingIdsRef.current));

        if (!capture.ok || !capture.text) {
          setBannerMessage({
            type: 'error',
            text:
              capture.error ||
              'Could not read that URL. For signed-in portals, install the companion extension or use "Paste text".',
          });
          return;
        }

        setUrlInput('');
        await processCapturedPageForAdd(trimmed, capture.text, capture.title, isTestRecord);
      } finally {
        setPapers((prev) => prev.filter((p) => p.id !== tempId));
        readingIdsRef.current.delete(tempId);
        setReadingPaperIds(new Set(readingIdsRef.current));
        setIsAddingUrl(false);
      }
    },
    [papers, processCapturedPageForAdd]
  );

  // Listen for companion browser extension connection & pushed tab captures
  useEffect(() => {
    const unsubStatus = subscribeExtensionStatus(setExtensionConnected);
    const unsubBridge = initExtensionBridge((payload) => {
      if (payload?.text && payload?.url) {
        void processCapturedPageForAdd(payload.url, payload.text, payload.title);
      }
    });
    return () => {
      unsubStatus();
      unsubBridge();
    };
  }, [processCapturedPageForAdd]);

  /* ------------------------------------------------------------------------ */
  /* Refresh All (Cancellable queue) & Hourly Auto-Check Scheduler            */
  /* ------------------------------------------------------------------------ */
  const handleRefreshAll = useCallback(
    async (checkSource: 'manual' | 'scheduled' = 'manual') => {
      if (isRefreshingAll) return;
      const eligible = papers.filter(
        (p) => !p.paused && p.url && p.url !== 'manual://entry' && !p.id.startsWith('reading-')
      );
      if (eligible.length === 0) return;

      cancelRefreshAllRef.current = false;
      setIsRefreshingAll(true);
      setRefreshProgress({ done: 0, total: eligible.length });

      const sessionCache = {
        captures: new Map<string, PageCaptureResult>(),
        extractions: new Map<string, ExtractionResponse>(),
      };

      for (let i = 0; i < eligible.length; i++) {
        if (cancelRefreshAllRef.current) break;
        await refreshSinglePaper(eligible[i].id, checkSource, undefined, sessionCache);
        setRefreshProgress({ done: i + 1, total: eligible.length });
      }

      setIsRefreshingAll(false);
    },
    [isRefreshingAll, papers, refreshSinglePaper]
  );

  const handleRecheckProblems = useCallback(async () => {
    if (isRefreshingAll) return;
    const failing = papers.filter((p) => {
      if (p.paused || !p.url || p.url === 'manual://entry' || p.id.startsWith('reading-')) {
        return false;
      }
      const eff = getEffectivePaperHealth(p);
      return eff !== 'OK' && eff !== 'Paused';
    });
    if (failing.length === 0) return;

    cancelRefreshAllRef.current = false;
    setIsRefreshingAll(true);
    setRefreshProgress({ done: 0, total: failing.length });

    const sessionCache = {
      captures: new Map<string, PageCaptureResult>(),
      extractions: new Map<string, ExtractionResponse>(),
    };

    for (let i = 0; i < failing.length; i++) {
      if (cancelRefreshAllRef.current) break;
      await refreshSinglePaper(failing[i].id, 'manual', undefined, sessionCache);
      setRefreshProgress({ done: i + 1, total: failing.length });
    }

    setIsRefreshingAll(false);
  }, [isRefreshingAll, papers, refreshSinglePaper]);

  // Automatic scheduled checks while browser is open + retry failed reads (1m -> 5m)
  useEffect(() => {
    const intervalMs = Math.max(15, settings.checkIntervalMinutes || 60) * 60000;
    const scheduler = setInterval(() => {
      if (!isOnline || settings.autoCheckPausedAll || isRefreshingAll) return;
      void handleRefreshAll('scheduled');
    }, intervalMs);

    const retryPoller = setInterval(() => {
      if (!isOnline || settings.autoCheckPausedAll || isRefreshingAll) return;
      const now = Date.now();
      const due = papers.find(
        (p) => !p.paused && p.nextRetryAt && new Date(p.nextRetryAt).getTime() <= now
      );
      if (due) {
        void refreshSinglePaper(due.id, 'scheduled');
      }
    }, 30000);

    return () => {
      clearInterval(scheduler);
      clearInterval(retryPoller);
    };
  }, [
    handleRefreshAll,
    isOnline,
    isRefreshingAll,
    papers,
    refreshSinglePaper,
    settings.autoCheckPausedAll,
    settings.checkIntervalMinutes,
  ]);

  /* ------------------------------------------------------------------------ */
  /* Acceptance Sandbox Scenarios                                             */
  /* ------------------------------------------------------------------------ */
  const handleTriggerStatusChangeTest = async () => {
    setActiveTab('papers');
    const existingTest = papers.find((p) => p.isTestRecord && p.manuscriptNumber === 'TEST-SANDBOX-001');
    const step1Url = `${window.location.origin}/api/test-tracker/status-change-v1`;
    const step2Url = `${window.location.origin}/api/test-tracker/status-change-v2`;

    if (!existingTest) {
      await handleAddLink(step1Url, true);
      setBannerMessage({
        type: 'info',
        text: 'Step 1 complete: Added isolated sandbox paper ("With Editor"). Click "Test status change" again in Setup to trigger Step 2 ("Under Review" + highlight + history + 1 email).',
      });
    } else {
      await refreshSinglePaper(existingTest.id, 'test', step2Url);
      setBannerMessage({
        type: 'success',
        text: 'Step 2 complete: Sandbox paper transitioned to "Under Review" — highlighted NEW, logged in history, and queued 1 deduplicated email.',
      });
    }
  };

  const handleRunSandboxScenario = async (scenario: string) => {
    setActiveTab('papers');
    const url = `${window.location.origin}/api/test-tracker/${scenario}`;
    let sandboxPaper = papers.find((p) => p.isTestRecord);
    if (!sandboxPaper) {
      await handleAddLink(`${window.location.origin}/api/test-tracker/status-change-v1`, true);
      setBannerMessage({
        type: 'info',
        text: `Created isolated sandbox paper first. Run "${scenario}" again to apply it to the sandbox paper without touching real papers.`,
      });
      return;
    }
    await refreshSinglePaper(sandboxPaper.id, 'test', url);
    setBannerMessage({
      type: 'info',
      text: `Ran sandbox scenario "${scenario}" on isolated test paper. Saved fields remained intact.`,
    });
  };

  /* ------------------------------------------------------------------------ */
  /* Filtering, Searching & Sorting                                           */
  /* ------------------------------------------------------------------------ */
  const uniqueJournals = useMemo(
    () => Array.from(new Set(papers.map((p) => p.journalName).filter(Boolean))).sort(),
    [papers]
  );

  const visiblePapers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = papers.filter((p) => {
      if (journalFilter !== 'all' && p.journalName !== journalFilter) return false;
      if (kpiFilter === 'changed' && !p.hasUnseenChange) return false;
      if (kpiFilter === 'problems') {
        const eff = getEffectivePaperHealth(p);
        if (eff === 'OK' || eff === 'Paused') return false;
      }
      if (
        kpiFilter === 'submitted_editor' ||
        kpiFilter === 'under_review' ||
        kpiFilter === 'revision_requested' ||
        kpiFilter === 'accepted' ||
        kpiFilter === 'rejected'
      ) {
        if (resolveStatusGroup(p.currentStatus, settings).key !== kpiFilter) return false;
      }

      if (q) {
        const hay = `${p.journalName} ${p.title} ${p.manuscriptNumber || ''} ${p.currentStatus} ${p.notes}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const sorted = [...filtered];
    if (sortBy === 'manual') {
      sorted.sort((a, b) => a.orderIndex - b.orderIndex);
    } else if (sortBy === 'journal') {
      sorted.sort((a, b) => a.journalName.localeCompare(b.journalName));
    } else if (sortBy === 'days_in_status') {
      sorted.sort((a, b) => computeDaysInStatus(b).days - computeDaysInStatus(a).days);
    } else if (sortBy === 'last_changed') {
      sorted.sort(
        (a, b) =>
          new Date(b.lastChangedAt || 0).getTime() - new Date(a.lastChangedAt || 0).getTime()
      );
    }
    return sorted;
  }, [journalFilter, kpiFilter, papers, searchQuery, settings, sortBy]);

  const unseenCount = useMemo(() => papers.filter((p) => p.hasUnseenChange).length, [papers]);
  const failedEmailCount = useMemo(
    () => alerts.filter((a) => a.state === 'Failed' || a.state === 'Not delivered').length,
    [alerts]
  );
  const problemCount = useMemo(
    () =>
      papers.filter((p) => {
        const eff = getEffectivePaperHealth(p);
        return eff !== 'OK' && eff !== 'Paused';
      }).length,
    [papers]
  );

  const handleClearAllProblems = useCallback(() => {
    setPapers((prev) =>
      prev.map((p) => {
        const eff = getEffectivePaperHealth(p);
        if (eff === 'OK' || eff === 'Paused') return p;
        const clearedSources = getPaperSources(p).map((s) =>
          s.health !== 'OK' && s.health !== 'Paused'
            ? { ...s, health: 'OK' as HealthState, healthMessage: null, healthTechnicalDetails: null }
            : s
        );
        return {
          ...p,
          health: 'OK',
          healthMessage: null,
          healthTechnicalDetails: null,
          consecutiveFailures: 0,
          nextRetryAt: null,
          sources: clearedSources,
        };
      })
    );
    setBannerMessage({
      type: 'success',
      text: 'Cleared tracking health warnings and marked papers as OK.',
    });
  }, []);

  const handleResetHealth = useCallback((paperId: string) => {
    setPapers((prev) =>
      prev.map((p) => {
        if (p.id !== paperId) return p;
        const clearedSources = getPaperSources(p).map((s) =>
          s.health !== 'OK' && s.health !== 'Paused'
            ? { ...s, health: 'OK' as HealthState, healthMessage: null, healthTechnicalDetails: null }
            : s
        );
        return {
          ...p,
          health: 'OK',
          healthMessage: null,
          healthTechnicalDetails: null,
          consecutiveFailures: 0,
          nextRetryAt: null,
          sources: clearedSources,
        };
      })
    );
    setBannerMessage({
      type: 'success',
      text: 'Marked paper health as OK.',
    });
  }, []);

  const handleRemovePaperSource = useCallback((paperId: string, sourceId: string) => {
    setPapers((prev) =>
      prev.map((p) => {
        if (p.id !== paperId) return p;
        const existingSources = getPaperSources(p);
        if (existingSources.length <= 1) return p;
        const remaining = existingSources.filter((s) => s.id !== sourceId);
        if (remaining.length === 0 || remaining.length === existingSources.length) return p;
        const primarySrc = remaining[0];
        const nextPaper: PaperRecord = {
          ...p,
          url: primarySrc.url,
          trackerSite: primarySrc.trackerSite,
          sources: remaining,
        };
        const effHealth = getEffectivePaperHealth(nextPaper);
        return {
          ...nextPaper,
          health: effHealth,
          healthMessage: effHealth === 'OK' ? null : primarySrc.healthMessage || p.healthMessage,
        };
      })
    );
    setBannerMessage({
      type: 'info',
      text: 'Removed linked portal source from paper.',
    });
  }, []);

  const activeDetailPaper = detailModal
    ? papers.find((p) => p.id === detailModal.paperId) || null
    : null;

  /* ------------------------------------------------------------------------ */
  /* Reordering, Deletion, Restore, Import                                    */
  /* ------------------------------------------------------------------------ */
  const handleReorderPapers = (sourceId: string, targetId: string) => {
    setPapers((prev) => {
      const ordered = [...prev].sort((a, b) => a.orderIndex - b.orderIndex);
      const fromIdx = ordered.findIndex((p) => p.id === sourceId);
      const toIdx = ordered.findIndex((p) => p.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = ordered.splice(fromIdx, 1);
      ordered.splice(toIdx, 0, moved);
      return ordered.map((p, idx) => ({ ...p, orderIndex: idx }));
    });
  };

  const handleMoveToEdge = (paperId: string, edge: 'top' | 'bottom') => {
    setPapers((prev) => {
      const ordered = [...prev].sort((a, b) => a.orderIndex - b.orderIndex);
      const idx = ordered.findIndex((p) => p.id === paperId);
      if (idx === -1) return prev;
      const [moved] = ordered.splice(idx, 1);
      if (edge === 'top') ordered.unshift(moved);
      else ordered.push(moved);
      return ordered.map((p, i) => ({ ...p, orderIndex: i }));
    });
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    const paperHist = history.filter((h) => h.paperId === deleteTarget.id);
    setDeletedPapers((prev) => [
      { paper: deleteTarget, history: paperHist, deletedAt: new Date().toISOString() },
      ...prev,
    ]);
    setPapers((prev) => prev.filter((p) => p.id !== deleteTarget.id));
    setHistory((prev) => prev.filter((h) => h.paperId !== deleteTarget.id));
    setDeleteTarget(null);
  };

  const handleRestoreDeleted = (paperId: string) => {
    const entry = deletedPapers.find((d) => d.paper.id === paperId);
    if (!entry) return;
    const maxOrder = papers.reduce((m, p) => Math.max(m, p.orderIndex), -1) + 1;
    setPapers((prev) => [...prev, { ...entry.paper, orderIndex: maxOrder }]);
    setHistory((prev) =>
      [...prev, ...entry.history].sort(
        (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
      )
    );
    setDeletedPapers((prev) => prev.filter((d) => d.paper.id !== paperId));
  };

  const handleImportMerge = (bundle: ExportBundle) => {
    const merged = applyMergeImport(papers, history, bundle);
    const dedup = deduplicateAndMergePapers(merged.papers);
    setPapers(dedup.merged);
    setHistory(remapHistoryIds(merged.history, dedup.idRemap));
    setBannerMessage({
      type: 'success',
      text: 'Merge import complete. Existing records kept and newer updates applied.',
    });
  };

  const handleImportReplace = (bundle: ExportBundle) => {
    const nextBackups = createBackupSnapshot(
      'Before Replace import',
      papers,
      deletedPapers,
      history,
      settings,
      rememberedIdentities,
      backups
    );
    setBackups(nextBackups);
    const dedup = deduplicateAndMergePapers(bundle.papers);
    setPapers(dedup.merged);
    setDeletedPapers(bundle.deletedPapers || []);
    setHistory(remapHistoryIds(bundle.history, dedup.idRemap));
    if (bundle.settings) setSettings({ ...DEFAULT_SETTINGS, ...bundle.settings });
    if (bundle.rememberedIdentities) setRememberedIdentities(bundle.rememberedIdentities);
    setBannerMessage({
      type: 'success',
      text: 'Replace import applied. Previous data was backed up automatically.',
    });
  };

  const handleExportExcel = useCallback(async () => {
    try {
      const blob = await generateDashboardExcelBlob({
        papers,
        history,
        alerts,
        deletedPapers,
        settings,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `journal-paper-dashboard-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setBannerMessage({
        type: 'success',
        text: `Exported Excel workbook with ${papers.length} paper(s), history, alerts, and settings.`,
      });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not generate Excel export.',
      });
    }
  }, [alerts, deletedPapers, history, papers, settings]);

  return (
    <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        unseenCount={unseenCount}
        failedEmailCount={failedEmailCount}
        isRefreshingAll={isRefreshingAll}
        refreshProgress={refreshProgress}
        onRefreshAll={() => void handleRefreshAll('manual')}
        onCancelRefreshAll={() => {
          cancelRefreshAllRef.current = true;
        }}
        hasPapers={papers.length > 0}
        aiProvider={settings.aiProvider}
        onChangeAiProvider={(provider) =>
          setSettings((s) => ({ ...s, aiProvider: provider }))
        }
        geminiConfigured={geminiConfigured}
      />

      {!isOnline && (
        <div className="bg-amber-100 dark:bg-amber-950/60 border-b border-amber-300 dark:border-amber-800 px-6 py-2 flex items-center gap-2 text-[14px] font-medium text-amber-900 dark:text-amber-200 shrink-0">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>Offline — showing last saved data. Live checks will resume when back online.</span>
        </div>
      )}

      {bannerMessage && (
        <div
          className={`px-6 py-2.5 border-b text-[14px] shrink-0 ${
            bannerMessage.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              : bannerMessage.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200'
          }`}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span>{bannerMessage.text}</span>
              {bannerMessage.technicalDetails && (
                <button
                  type="button"
                  onClick={() => setShowBannerDetails((v) => !v)}
                  className="text-[13px] underline hover:no-underline font-medium"
                >
                  {showBannerDetails ? 'Hide details' : 'Details'}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setBannerMessage(null);
                setShowBannerDetails(false);
              }}
              className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {showBannerDetails && bannerMessage.technicalDetails && (
            <pre className="mt-2 p-2.5 rounded bg-white/80 dark:bg-slate-950 border border-rose-200 dark:border-rose-800 text-[12px] font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {bannerMessage.technicalDetails}
            </pre>
          )}
        </div>
      )}

      <main className="flex-1 min-h-0 flex flex-col p-4 md:px-6 md:py-4 gap-3.5 overflow-y-auto">
        {activeTab === 'papers' && (
          <>
            <KpiStrip
              papers={papers}
              settings={settings}
              activeFilter={kpiFilter}
              onSelectFilter={setKpiFilter}
            />

            {problemCount > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2 text-[14px] text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>
                    <strong>{problemCount} tracking issue(s) detected</strong> across papers with no working portal read. Sign in to portals or recheck failed rows.
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleClearAllProblems}
                    className="px-3 py-1 text-[13px] font-medium bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 rounded-md hover:bg-amber-100 dark:hover:bg-slate-800"
                  >
                    Clear warnings / Mark OK
                  </button>
                  <button
                    type="button"
                    disabled={isRefreshingAll}
                    onClick={() => void handleRecheckProblems()}
                    className="px-3 py-1 text-[13px] font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50"
                  >
                    Recheck problems
                  </button>
                </div>
              </div>
            )}

            {settings.showGraphs && papers.length > 0 && (
              <AnalyticsGraphs
                papers={papers}
                settings={settings}
                activeKpiFilter={kpiFilter}
                activeJournalFilter={journalFilter}
                onSelectStatusFilter={setKpiFilter}
                onSelectJournalFilter={setJournalFilter}
              />
            )}

            {/* Compact Workspace Toolbar (No separate large AI scan panel!) */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAddLink(urlInput);
                }}
                className="flex items-center gap-2 flex-1 min-w-[280px] max-w-xl"
              >
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="Paste tracker link (Editorial Manager, AuthorHub, Research Square)…"
                  aria-label="Paste tracker link"
                  className="flex-1 px-3 py-1.5 text-[14px] bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="submit"
                  disabled={isAddingUrl}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[14px] font-medium text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 rounded-lg disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isAddingUrl ? 'Reading…' : 'Add'}</span>
                </button>
              </form>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search papers…"
                    aria-label="Search papers"
                    className="pl-8 pr-3 py-1.5 w-44 text-[14px] bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                </div>

                <select
                  value={journalFilter}
                  onChange={(e) => setJournalFilter(e.target.value)}
                  aria-label="Filter by journal"
                  className="px-2.5 py-1.5 text-[14px] bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg max-w-[170px]"
                >
                  <option value="all">All journals</option>
                  {uniqueJournals.map((j) => (
                    <option key={j} value={j}>
                      {j}
                    </option>
                  ))}
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  aria-label="Sort papers"
                  className="px-2.5 py-1.5 text-[14px] bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg"
                >
                  <option value="manual">Manual order</option>
                  <option value="last_changed">Last changed</option>
                  <option value="days_in_status">Days in status</option>
                  <option value="journal">Journal A–Z</option>
                </select>

                {(kpiFilter !== 'all' || journalFilter !== 'all' || searchQuery.trim() !== '') && (
                  <button
                    type="button"
                    onClick={() => {
                      setKpiFilter('all');
                      setJournalFilter('all');
                      setSearchQuery('');
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[13px] font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-950/60"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Clear filters</span>
                  </button>
                )}

                {unseenCount > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setPapers((prev) =>
                        prev.map((p) => ({
                          ...p,
                          hasUnseenChange: false,
                          unseenDetectedAt: null,
                        }))
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-100"
                  >
                    <CheckCheck className="w-4 h-4" />
                    <span>Mark all seen</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowPasteTextModal(true)}
                  title="Paste copied page text directly"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <ClipboardPaste className="w-4 h-4" />
                  <span className="hidden xl:inline">Paste text</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowManualAdd(true)}
                  className="px-2.5 py-1.5 text-[13px] font-medium bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Add by hand
                </button>

                <button
                  type="button"
                  onClick={() => void handleExportExcel()}
                  title="Export entire dashboard data to Excel (.xlsx)"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg transition-colors"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Export Excel</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setSettings((s) => ({ ...s, showGraphs: !s.showGraphs }))
                  }
                  title={settings.showGraphs ? 'Collapse graphs' : 'Show graphs'}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <BarChart2 className="w-4 h-4" />
                  <span>{settings.showGraphs ? 'Hide graphs' : 'Show graphs'}</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setSettings((s) => ({
                      ...s,
                      density: s.density === 'compact' ? 'comfortable' : 'compact',
                    }))
                  }
                  title="Toggle compact / comfortable rows"
                  className="p-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Columns className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setSettings((s) => ({
                      ...s,
                      theme: s.theme === 'light' ? 'dark' : 'light',
                    }))
                  }
                  title="Toggle light / dark mode"
                  className="p-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  {settings.theme === 'light' ? (
                    <Moon className="w-4 h-4" />
                  ) : (
                    <Sun className="w-4 h-4" />
                  )}
                </button>

                {deletedPapers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowDeletedDrawer(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[13px] font-medium bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Deleted ({deletedPapers.length})</span>
                  </button>
                )}
              </div>
            </div>

            <PapersTable
              papers={visiblePapers}
              totalPaperCount={papers.length}
              settings={settings}
              readingPaperIds={readingPaperIds}
              isInitialLoading={false}
              isManualOrder={sortBy === 'manual'}
              onRefreshPaper={(id) => void refreshSinglePaper(id, 'manual')}
              onMarkSeen={(id) =>
                setPapers((prev) =>
                  prev.map((p) =>
                    p.id === id
                      ? { ...p, hasUnseenChange: false, unseenDetectedAt: null }
                      : p
                  )
                )
              }
              onOpenDetail={(paper, tab = 'details') =>
                setDetailModal({ paperId: paper.id, tab })
              }
              onDeleteRequest={(paper) => setDeleteTarget(paper)}
              onReorderPapers={handleReorderPapers}
              onMoveToEdge={handleMoveToEdge}
              onQuickAddUrl={(url) => void handleAddLink(url)}
              onOpenManualAdd={() => setShowManualAdd(true)}
            />
          </>
        )}

        {activeTab === 'history' && (
          <HistoryAndAlertsView
            history={history}
            alerts={alerts}
            settings={settings}
            gmailUserEmail={gmailUserEmail}
            gmailConnected={gmailConnected}
            isSigningInGmail={isSigningInGmail}
            onSignInGmail={() => void handleSignInGmail()}
            onSignOutGmail={() => void handleSignOutGmail()}
            onToggleSimulateFailure={(val) =>
              setSettings((s) => ({ ...s, simulateEmailFailure: val }))
            }
            onSendTestEmail={async () => {
              const nowIso = new Date().toISOString();
              const testAlert: EmailAlertRecord = {
                id: generateId(),
                eventIds: [],
                recipient: settings.recipientEmail || 'hssaleh@gmail.com',
                subject: 'Journal Paper Dashboard — Test Email',
                bodyText: `This is a live test email from your Journal Paper Dashboard.\n\nTime (${settings.timezone}): ${formatDateTime(
                  nowIso,
                  settings.timezone,
                  settings.dateFormat
                )}\nTracked papers: ${papers.length}`,
                state: 'Pending',
                attempts: 0,
                createdAt: nowIso,
                lastAttemptAt: null,
                nextRetryAt: null,
                type: 'test',
              };
              setAlerts((prev) => [testAlert, ...prev]);
              const res = await attemptDeliverAlert(testAlert);
              return res.ok
                ? {
                    ok: true,
                    message: `Test email sent to ${testAlert.recipient} (Message ID: ${res.messageId || 'OK'}).`,
                  }
                : {
                    ok: false,
                    message: `Delivery failed: ${res.error}. Queued for automatic retry.`,
                  };
            }}
            onResendAlert={(id) => {
              const found = alerts.find((a) => a.id === id);
              if (found) void attemptDeliverAlert(found);
            }}
            onClearHistory={() => setHistory([])}
          />
        )}

        {activeTab === 'setup' && (
          <SetupView
            papers={papers}
            extensionConnected={extensionConnected}
            gmailConnected={gmailConnected}
            onRunSandboxScenario={(scen) => void handleRunSandboxScenario(scen)}
            onTriggerStatusChangeTest={() => void handleTriggerStatusChangeTest()}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            settings={settings}
            papers={papers}
            deletedPapers={deletedPapers}
            history={history}
            rememberedIdentities={rememberedIdentities}
            backups={backups}
            onUpdateSettings={setSettings}
            onImportMerge={handleImportMerge}
            onImportReplace={handleImportReplace}
            onExportExcel={() => void handleExportExcel()}
            onRestoreBackup={(snap) => {
              try {
                const parsed = JSON.parse(snap.payload) as ExportBundle;
                const dedup = deduplicateAndMergePapers(parsed.papers);
                setPapers(dedup.merged);
                setDeletedPapers(parsed.deletedPapers || []);
                setHistory(remapHistoryIds(parsed.history || [], dedup.idRemap));
                if (parsed.settings) setSettings({ ...DEFAULT_SETTINGS, ...parsed.settings });
                setBannerMessage({
                  type: 'success',
                  text: `Restored backup from ${formatDateTime(
                    snap.createdAt,
                    settings.timezone,
                    settings.dateFormat
                  )}.`,
                });
              } catch {
                setBannerMessage({ type: 'error', text: 'Could not restore backup snapshot.' });
              }
            }}
          />
        )}
      </main>

      {/* Modals */}
      {multiPickerState && (
        <MultiPaperPickerModal
          sourceUrl={multiPickerState.sourceUrl}
          items={multiPickerState.items}
          onClose={() => setMultiPickerState(null)}
          onConfirmAdd={(selected) => {
            let nextOrder = papers.reduce((m, p) => Math.max(m, p.orderIndex), -1) + 1;
            const created: PaperRecord[] = selected.map((ext) =>
              createRecordFromExtracted(
                ext,
                multiPickerState.sourceUrl,
                multiPickerState.trackerSite,
                multiPickerState.sourceText,
                nextOrder++,
                true
              )
            );
            setPapers((prev) => [...prev, ...created]);
            setMultiPickerState(null);
            setBannerMessage({
              type: 'success',
              text: `Added ${created.length} paper(s) from ${multiPickerState.trackerSite}.`,
            });
          }}
        />
      )}

      {showManualAdd && (
        <ManualAddModal
          onClose={() => setShowManualAdd(false)}
          onSave={(data) => {
            const nowIso = new Date().toISOString();
            const nextOrder = papers.reduce((m, p) => Math.max(m, p.orderIndex), -1) + 1;
            const record: PaperRecord = {
              id: generateId(),
              orderIndex: nextOrder,
              url: data.url,
              trackerSite: inferTrackerSite(data.url),
              journalName: data.journalName,
              title: data.title,
              manuscriptNumber: data.manuscriptNumber || null,
              revision: data.revision || null,
              submissionType: null,
              submissionDate: data.submissionDate || null,
              submissionDateAmbiguous: false,
              currentStatus: data.currentStatus,
              statusDate: data.statusDate || null,
              statusDateAmbiguous: false,
              editorOrTeam: null,
              reviewCount: null,
              decision: null,
              notes: data.notes,
              paused: false,
              userEditedFields: {},
              allowAutoOverwriteFields: {},
              uncertainFields: [],
              lastSourceText: '',
              firstSeenAt: nowIso,
              statusFirstSeenAt: nowIso,
              lastCheckedAt: nowIso,
              lastSuccessfulReadAt: nowIso,
              lastChangedAt: null,
              health: 'OK',
              healthMessage: null,
              healthTechnicalDetails: null,
              hasUnseenChange: false,
              unseenDetectedAt: null,
              hasMinorUpdate: false,
              minorUpdateAt: null,
              consecutiveFailures: 0,
              nextRetryAt: null,
              staleAlertSentAt: null,
            };
            setPapers((prev) => [...prev, record]);
            setShowManualAdd(false);
          }}
        />
      )}

      {showPasteTextModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-xl w-full p-5 shadow-xl space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-[18px] font-semibold">Read copied tracker page text</h2>
              <button
                type="button"
                onClick={() => setShowPasteTextModal(false)}
                className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[13px] text-slate-600 dark:text-slate-400">
              If a signed-in portal isn’t connected via the browser extension yet, press Ctrl+A then Ctrl+C on the open tracker page and paste the text below. Only plain text is sent to the AI.
            </p>
            <input
              type="text"
              value={pasteTextUrl}
              onChange={(e) => setPasteTextUrl(e.target.value)}
              placeholder="Tracker URL (optional, e.g. https://track.authorhub.elsevier.com/...)"
              className="w-full px-3 py-2 text-[14px] bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
            />
            <textarea
              rows={7}
              value={pasteTextContent}
              onChange={(e) => setPasteTextContent(e.target.value)}
              placeholder="Paste full page text here…"
              className="w-full px-3 py-2 text-[13px] font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
            />
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowPasteTextModal(false)}
                className="px-4 py-2 text-[14px] bg-slate-100 dark:bg-slate-800 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const targetUrl = isValidWebUrl(pasteTextUrl)
                    ? pasteTextUrl.trim()
                    : 'https://pasted-tracker.local/';
                  const text = pasteTextContent;
                  setShowPasteTextModal(false);
                  setPasteTextContent('');
                  setPasteTextUrl('');
                  await processCapturedPageForAdd(targetUrl, text);
                }}
                className="px-4 py-2 text-[14px] font-medium text-white bg-slate-900 dark:bg-blue-600 rounded-lg"
              >
                Extract &amp; add
              </button>
            </div>
          </div>
        </div>
      )}

      {activeDetailPaper && (
        <PaperDetailModal
          paper={activeDetailPaper}
          history={history}
          settings={settings}
          initialTab={detailModal!.tab}
          onClose={() => setDetailModal(null)}
          onSaveEdits={(updated) => {
            setPapers((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          }}
          onConfirmUncertainField={(paperId, field) => {
            setPapers((prev) =>
              prev.map((p) => {
                if (p.id !== paperId) return p;
                return {
                  ...p,
                  submissionDateAmbiguous:
                    field === 'submissionDate' ? false : p.submissionDateAmbiguous,
                  statusDateAmbiguous:
                    field === 'statusDate' ? false : p.statusDateAmbiguous,
                  uncertainFields: p.uncertainFields.filter((f) => f !== field),
                };
              })
            );
          }}
          onTogglePause={(paperId) => {
            setPapers((prev) =>
              prev.map((p) => {
                if (p.id !== paperId) return p;
                const nextPaused = !p.paused;
                return {
                  ...p,
                  paused: nextPaused,
                  health: nextPaused ? 'Paused' : 'OK',
                  healthMessage: nextPaused ? 'Auto-checks paused for this paper.' : null,
                };
              })
            );
          }}
          onResetHealth={handleResetHealth}
          onRefreshSource={(pId, srcUrl) => {
            void refreshSinglePaper(pId, 'manual', srcUrl);
          }}
          onRemoveSource={handleRemovePaperSource}
        />
      )}

      {ambiguousQueue.length > 0 && (
        <AmbiguousIdentityModal
          prompt={ambiguousQueue[0]}
          onResolve={async (choice) => {
            const current = ambiguousQueue[0];
            setAmbiguousQueue((prev) => prev.slice(1));
            const key = getCandidateKey(current.extracted, current.trackerSite, current.sourceUrl);
            if (choice.action === 'link' && choice.targetPaperId) {
              if (choice.remember) {
                setRememberedIdentities((prev) => ({ ...prev, [key]: choice.targetPaperId! }));
              }
              const target = papers.find((p) => p.id === choice.targetPaperId);
              if (target) {
                const { updated, transitionEntry, minorEntry } = applyExtractedUpdateToPaper(
                  target,
                  current.extracted,
                  current.sourceText,
                  'manual',
                  current.sourceUrl,
                  current.trackerSite
                );
                setPapers((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
                if (transitionEntry) {
                  setHistory((prev) => [transitionEntry, ...prev]);
                  await enqueueAndSendTransitionAlerts([{ paper: updated, entry: transitionEntry }]);
                } else if (minorEntry) {
                  setHistory((prev) => [minorEntry, ...prev]);
                }
              }
            } else {
              const nextOrder = papers.reduce((m, p) => Math.max(m, p.orderIndex), -1) + 1;
              const created = createRecordFromExtracted(
                current.extracted,
                current.sourceUrl,
                current.trackerSite,
                current.sourceText,
                nextOrder,
                false
              );
              if (choice.remember) {
                setRememberedIdentities((prev) => ({ ...prev, [key]: created.id }));
              }
              setPapers((prev) => [...prev, created]);
            }
          }}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          paper={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
        />
      )}

      {showDeletedDrawer && (
        <RecentlyDeletedModal
          deletedPapers={deletedPapers}
          settings={settings}
          onClose={() => setShowDeletedDrawer(false)}
          onRestore={handleRestoreDeleted}
          onPermanentDelete={(id) =>
            setDeletedPapers((prev) => prev.filter((d) => d.paper.id !== id))
          }
        />
      )}
    </div>
  );
}
