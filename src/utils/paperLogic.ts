import type {
  BackupSnapshot,
  DashboardSettings,
  DateFormatOption,
  DeletedPaperRecord,
  ExportBundle,
  ExtractedPaper,
  HistoryEntry,
  PaperRecord,
  PaperSourceLink,
  StatusGroupConfig,
  StatusGroupKey,
} from '../types';
import {
  isBadOrGenericJournalName,
  isLikelyDateString,
  resolveJournalNameFromHints,
  stripRevisionTagFromTitle,
  titlesMatchForMerge,
} from './journalLookup';

export const DEFAULT_STATUS_GROUPS: StatusGroupConfig[] = [
  {
    key: 'submitted_editor',
    label: 'Submitted / With Editor',
    color: '#2563EB',
    keywords: ['submitted', 'with editor', 'editor assigned', 'initial', 'handling', 'processing', 'awaiting admin', 'editorial assessment'],
  },
  {
    key: 'under_review',
    label: 'Under Review',
    color: '#D97706',
    keywords: ['under review', 'peer review', 'reviewers invited', 'review completed', 'awaiting editor decision', 'evaluating', 'in review'],
  },
  {
    key: 'revision_requested',
    label: 'Revision Requested',
    color: '#EA580C',
    keywords: ['revision', 'revise', 'major revision', 'minor revision', 'resubmit', 'amendment'],
  },
  {
    key: 'accepted',
    label: 'Accepted',
    color: '#16A34A',
    keywords: ['accept', 'accepted', 'in press', 'production', 'published', 'proof'],
  },
  {
    key: 'rejected',
    label: 'Rejected',
    color: '#DC2626',
    keywords: ['reject', 'rejected', 'declined', 'withdrawn', 'desk reject'],
  },
  {
    key: 'unknown',
    label: 'Unknown / Unmatched',
    color: '#64748B',
    keywords: [],
  },
];

export const DEFAULT_SETTINGS: DashboardSettings = {
  theme: 'light',
  density: 'compact',
  showGraphs: true,
  dateFormat: 'YYYY-MM-DD',
  timezone: 'Asia/Riyadh',
  recipientEmail: 'hssaleh@gmail.com',
  emailMode: 'per_change',
  includeWorkingLinkInEmail: false,
  checkIntervalMinutes: 60,
  fasterCheckingApproved: false,
  autoCheckPausedAll: false,
  aiProvider: 'auto_free',
  statusGroups: DEFAULT_STATUS_GROUPS,
  customStatusMappings: {},
  simulateEmailFailure: false,
};

export const TIMEZONE_OPTIONS = [
  { value: 'Asia/Riyadh', label: 'Riyadh (UTC+3)' },
  { value: 'UTC', label: 'Universal Time (UTC)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  { value: 'America/New_York', label: 'New York (ET)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
  { value: 'Asia/Dubai', label: 'Dubai (UTC+4)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (UTC+9)' },
];

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isValidWebUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function inferTrackerSite(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (host.includes('editorialmanager.com')) return 'Editorial Manager';
    if (host.includes('researchsquare.com')) return 'Research Square';
    if (host.includes('authorhub.elsevier.com')) return 'Elsevier AuthorHub';
    if (u.pathname.startsWith('/api/test-tracker/')) {
      const scen = u.pathname.replace('/api/test-tracker/', '');
      if (scen.includes('editorial')) return 'Editorial Manager (Sandbox)';
      if (scen.includes('research')) return 'Research Square (Sandbox)';
      if (scen.includes('elsevier')) return 'Elsevier AuthorHub (Sandbox)';
      return 'Sandbox Tracker';
    }
    return host.replace(/^www\./, '');
  } catch {
    return 'Manual Entry';
  }
}

export function maskTrackingUrl(rawUrl: string): string {
  if (!rawUrl || rawUrl === 'manual://entry') return 'Manual entry';
  try {
    const u = new URL(rawUrl);
    const site = inferTrackerSite(rawUrl);
    const pathAndQuery = `${u.pathname}${u.search}`;
    if (u.search || u.pathname.length > 24) {
      const ending = pathAndQuery.slice(-6);
      return `${site} (…${ending})`;
    }
    return `${site}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return 'Masked link';
  }
}

export function formatDateOnly(isoDate: string | null | undefined, format: DateFormatOption): string {
  if (!isoDate) return 'Not shown';
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoDate;
  const [, yyyy, mm, dd] = match;
  if (format === 'YYYY-MM-DD') return `${yyyy}-${mm}-${dd}`;
  if (format === 'DD/MM/YYYY') return `${dd}/${mm}/${yyyy}`;
  if (format === 'MM/DD/YYYY') return `${mm}/${dd}/${yyyy}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIdx = Math.max(0, Math.min(11, Number(mm) - 1));
  return `${dd} ${months[monthIdx]} ${yyyy}`;
}

export function formatDateTime(
  utcIso: string | null | undefined,
  timezone: string,
  dateFormat: DateFormatOption
): string {
  if (!utcIso) return 'Never';
  const dt = new Date(utcIso);
  if (Number.isNaN(dt.getTime())) return 'Unknown';

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'Asia/Riyadh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(dt);

    const map: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    const isoPart = `${map.year}-${map.month}-${map.day}`;
    const formattedDate = formatDateOnly(isoPart, dateFormat);
    return `${formattedDate} ${map.hour}:${map.minute}`;
  } catch {
    return utcIso.slice(0, 16).replace('T', ' ');
  }
}

export function formatRelativeTime(utcIso: string | null | undefined): string {
  if (!utcIso) return 'Never';
  const dt = new Date(utcIso);
  if (Number.isNaN(dt.getTime())) return 'Unknown';
  const diffMs = Date.now() - dt.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function computeDaysInStatus(paper: PaperRecord): {
  days: number;
  basis: 'page date' | 'first seen';
} {
  const now = new Date();
  if (paper.statusDate) {
    const dt = new Date(`${paper.statusDate}T00:00:00Z`);
    if (!Number.isNaN(dt.getTime())) {
      const diff = Math.max(0, Math.floor((now.getTime() - dt.getTime()) / 86400000));
      return { days: diff, basis: 'page date' };
    }
  }
  const seenDt = new Date(paper.statusFirstSeenAt || paper.firstSeenAt);
  const diff = Math.max(0, Math.floor((now.getTime() - seenDt.getTime()) / 86400000));
  return { days: diff, basis: 'first seen' };
}

export function computeDaysSinceSubmission(paper: PaperRecord): number | null {
  if (!paper.submissionDate) return null;
  const dt = new Date(`${paper.submissionDate}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - dt.getTime()) / 86400000));
}

export function resolveStatusGroup(
  statusText: string,
  settings: DashboardSettings
): StatusGroupConfig {
  const normalized = (statusText || '').trim().toLowerCase();
  const mappedKey = settings.customStatusMappings[normalized];
  if (mappedKey) {
    const found = settings.statusGroups.find((g) => g.key === mappedKey);
    if (found) return found;
  }

  // Order matters: check accepted/rejected/revision before broader editor/review keywords
  const priority: StatusGroupKey[] = [
    'accepted',
    'rejected',
    'revision_requested',
    'under_review',
    'submitted_editor',
  ];

  for (const key of priority) {
    const group = settings.statusGroups.find((g) => g.key === key);
    if (!group) continue;
    if (group.keywords.some((kw) => normalized.includes(kw.toLowerCase()))) {
      return group;
    }
  }

  return (
    settings.statusGroups.find((g) => g.key === 'unknown') || DEFAULT_STATUS_GROUPS[5]
  );
}

export function normalizeManuscriptNumber(raw: string | null | undefined): string {
  if (!raw) return '';
  // Strip revision suffixes like R1, R2, -R1 so revisions match the same paper identity!
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+R\d+$/i, '')
    .replace(/\s+/g, '');
}

export function stripUrlForComparison(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.origin}${u.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

export function getCandidateKey(
  extracted: ExtractedPaper,
  trackerSite: string,
  sourceUrl: string
): string {
  const normMs = normalizeManuscriptNumber(extracted.manuscriptNumber);
  return `${trackerSite.toLowerCase()}::${normMs || 'NO_MS'}::${(extracted.title || '').slice(0, 40).toLowerCase()}::${stripUrlForComparison(sourceUrl)}`;
}

export function getPaperSources(paper: PaperRecord): PaperSourceLink[] {
  if (Array.isArray(paper.sources) && paper.sources.length > 0) {
    return paper.sources;
  }
  return [
    {
      id: `${paper.id}-primary`,
      url: paper.url,
      trackerSite: paper.trackerSite,
      manuscriptNumber: paper.manuscriptNumber,
      currentStatus: paper.currentStatus,
      statusDate: paper.statusDate,
      submissionDate: paper.submissionDate,
      reviewCount: paper.reviewCount,
      editorOrTeam: paper.editorOrTeam,
      decision: paper.decision,
      lastCheckedAt: paper.lastCheckedAt,
      lastSuccessfulReadAt: paper.lastSuccessfulReadAt,
      health: paper.health,
      healthMessage: paper.healthMessage,
      healthTechnicalDetails: paper.healthTechnicalDetails,
      lastSourceText: paper.lastSourceText,
      sourceListUrl: paper.sourceListUrl,
      consecutiveFailures: paper.consecutiveFailures,
      nextRetryAt: paper.nextRetryAt,
    },
  ];
}

export function normalizeSourceComparisonKey(url: string, trackerSite: string): string {
  const normUrl = stripUrlForComparison(url);
  try {
    const u = new URL(url);
    const uuid = u.searchParams.get('uuid');
    if (uuid) return `${normUrl}?uuid=${uuid.toLowerCase()}::${trackerSite.toLowerCase()}`;
  } catch {
    // ignore
  }
  return `${normUrl}::${trackerSite.toLowerCase()}`;
}

function chooseBetterJournalName(a: string | null | undefined, b: string | null | undefined, ms: string | null, url: string, text: string): string {
  const validA = a && !isBadOrGenericJournalName(a) ? a.trim() : null;
  const validB = b && !isBadOrGenericJournalName(b) ? b.trim() : null;
  if (validA) return validA;
  if (validB) return validB;
  const resolved = resolveJournalNameFromHints({
    pageText: text,
    sourceUrl: url,
    manuscriptNumber: ms,
  });
  return resolved || 'Journal not shown';
}

function chooseBetterTitle(a: string | null | undefined, b: string | null | undefined): string {
  const clean = (t: string | null | undefined) => {
    if (!t) return '';
    const trimmed = t.trim();
    if (!trimmed || trimmed.toLowerCase() === 'untitled manuscript' || trimmed.toLowerCase() === 'untitled') {
      return '';
    }
    return stripRevisionTagFromTitle(trimmed) || trimmed;
  };
  const ca = clean(a);
  const cb = clean(b);
  if (!ca) return cb || 'Untitled manuscript';
  if (!cb) return ca;
  return cb.length > ca.length ? cb : ca;
}

export function mergeTwoPaperRecords(primary: PaperRecord, incoming: PaperRecord): PaperRecord {
  const existingSources = getPaperSources(primary);
  const incomingSources = getPaperSources(incoming);

  const mergedSources = [...existingSources];
  for (const src of incomingSources) {
    const key = normalizeSourceComparisonKey(src.url, src.trackerSite);
    const idx = mergedSources.findIndex(
      (s) => normalizeSourceComparisonKey(s.url, s.trackerSite) === key
    );
    if (idx === -1) {
      mergedSources.push(src);
    } else {
      const prev = mergedSources[idx];
      const prevOk = prev.lastSuccessfulReadAt ? new Date(prev.lastSuccessfulReadAt).getTime() : 0;
      const srcOk = src.lastSuccessfulReadAt ? new Date(src.lastSuccessfulReadAt).getTime() : 0;
      mergedSources[idx] = srcOk >= prevOk ? { ...prev, ...src } : { ...src, ...prev };
    }
  }

  const ms = primary.manuscriptNumber || incoming.manuscriptNumber || null;
  const journalName = chooseBetterJournalName(
    primary.journalName,
    incoming.journalName,
    ms,
    primary.url || incoming.url,
    `${primary.lastSourceText || ''}\n${incoming.lastSourceText || ''}`
  );
  const title = chooseBetterTitle(primary.title, incoming.title);

  const validDate = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const subDate = validDate(primary.submissionDate) || validDate(incoming.submissionDate);

  const dA = validDate(primary.statusDate);
  const dB = validDate(incoming.statusDate);
  const statusDate =
    dA && dB ? (dB > dA ? dB : dA) : dA || dB;

  const isStatusUseful = (s: string | null | undefined) =>
    Boolean(s && s !== 'Status not shown' && s !== 'Reading…' && !isLikelyDateString(s));

  const primaryOkTime = primary.lastSuccessfulReadAt
    ? new Date(primary.lastSuccessfulReadAt).getTime()
    : 0;
  const incomingOkTime = incoming.lastSuccessfulReadAt
    ? new Date(incoming.lastSuccessfulReadAt).getTime()
    : 0;

  let currentStatus = primary.currentStatus;
  if (!isStatusUseful(primary.currentStatus) && isStatusUseful(incoming.currentStatus)) {
    currentStatus = incoming.currentStatus;
  } else if (
    isStatusUseful(incoming.currentStatus) &&
    incoming.health === 'OK' &&
    (primary.health !== 'OK' || incomingOkTime > primaryOkTime)
  ) {
    currentStatus = incoming.currentStatus;
  }

  const healthySource = mergedSources.find((s) => s.health === 'OK');
  const combinedHealth = healthySource
    ? 'OK'
    : primary.paused
    ? 'Paused'
    : primary.health;

  const latestCheckedMs = Math.max(
    primary.lastCheckedAt ? new Date(primary.lastCheckedAt).getTime() : 0,
    incoming.lastCheckedAt ? new Date(incoming.lastCheckedAt).getTime() : 0
  );
  const latestOkMs = Math.max(primaryOkTime, incomingOkTime);

  return {
    ...primary,
    orderIndex: Math.min(primary.orderIndex, incoming.orderIndex),
    journalName,
    title,
    manuscriptNumber: ms,
    revision: primary.revision || incoming.revision,
    submissionType: primary.submissionType || incoming.submissionType,
    submissionDate: subDate,
    statusDate,
    currentStatus,
    editorOrTeam: primary.editorOrTeam || incoming.editorOrTeam,
    reviewCount:
      primary.reviewCount !== null && incoming.reviewCount !== null
        ? Math.max(primary.reviewCount, incoming.reviewCount)
        : primary.reviewCount ?? incoming.reviewCount,
    decision: primary.decision || incoming.decision,
    notes:
      primary.notes && incoming.notes && primary.notes !== incoming.notes
        ? `${primary.notes}\n${incoming.notes}`
        : primary.notes || incoming.notes,
    lastSourceText:
      (incoming.lastSourceText || '').length > (primary.lastSourceText || '').length
        ? incoming.lastSourceText
        : primary.lastSourceText,
    lastCheckedAt: latestCheckedMs > 0 ? new Date(latestCheckedMs).toISOString() : primary.lastCheckedAt,
    lastSuccessfulReadAt:
      latestOkMs > 0 ? new Date(latestOkMs).toISOString() : primary.lastSuccessfulReadAt,
    health: combinedHealth,
    healthMessage: combinedHealth === 'OK' ? null : primary.healthMessage || incoming.healthMessage,
    hasUnseenChange: primary.hasUnseenChange || incoming.hasUnseenChange,
    unseenDetectedAt: primary.unseenDetectedAt || incoming.unseenDetectedAt,
    sources: mergedSources,
  };
}

export function deduplicateAndMergePapers(papers: PaperRecord[]): {
  merged: PaperRecord[];
  idRemap: Record<string, string>;
  didMerge: boolean;
} {
  const ordered = [...papers].sort((a, b) => a.orderIndex - b.orderIndex);
  const merged: PaperRecord[] = [];
  const idRemap: Record<string, string> = {};
  let didMerge = false;

  for (const item of ordered) {
    const itemMs = normalizeManuscriptNumber(item.manuscriptNumber);
    const matchIdx = merged.findIndex((existing) => {
      const exMs = normalizeManuscriptNumber(existing.manuscriptNumber);
      if (itemMs && exMs && itemMs === exMs) return true;
      if (titlesMatchForMerge(existing.title, item.title)) return true;
      return false;
    });

    if (matchIdx === -1) {
      merged.push({
        ...item,
        sources: getPaperSources(item),
      });
    } else {
      const target = merged[matchIdx];
      merged[matchIdx] = mergeTwoPaperRecords(target, item);
      idRemap[item.id] = target.id;
      didMerge = true;
    }
  }

  return {
    merged: merged.map((p, idx) => ({ ...p, orderIndex: idx })),
    idRemap,
    didMerge,
  };
}

export function matchExtractedPaperToExisting(
  extracted: ExtractedPaper,
  existingPapers: PaperRecord[],
  sourceUrl: string,
  trackerSite: string,
  rememberedIdentities: Record<string, string>
): {
  match: PaperRecord | null;
  ambiguousCandidates: PaperRecord[];
} {
  const key = getCandidateKey(extracted, trackerSite, sourceUrl);
  const rememberedId = rememberedIdentities[key];
  if (rememberedId) {
    const remembered = existingPapers.find((p) => p.id === rememberedId);
    if (remembered) return { match: remembered, ambiguousCandidates: [] };
  }

  const normMs = normalizeManuscriptNumber(extracted.manuscriptNumber);
  if (normMs) {
    // Cross-source MS# match: Editorial Manager + AuthorHub + Research Square merge into one box
    const msMatches = existingPapers.filter(
      (p) => normalizeManuscriptNumber(p.manuscriptNumber) === normMs
    );
    if (msMatches.length === 1) return { match: msMatches[0], ambiguousCandidates: [] };
    if (msMatches.length > 1) return { match: null, ambiguousCandidates: msMatches };
  }

  // Cross-source Title match (e.g. "Turning brine..." on Research Square matches EM NARR-D-26-02069)
  if (extracted.title) {
    const titleMatches = existingPapers.filter((p) =>
      titlesMatchForMerge(p.title, extracted.title)
    );
    if (titleMatches.length === 1) return { match: titleMatches[0], ambiguousCandidates: [] };
    if (titleMatches.length > 1) return { match: null, ambiguousCandidates: titleMatches };
  }

  // Backup identity: exact URL match across any stored source link (when single-paper URL)
  const normUrl = normalizeSourceComparisonKey(sourceUrl, trackerSite);
  const urlMatches = existingPapers.filter((p) =>
    getPaperSources(p).some(
      (s) =>
        normalizeSourceComparisonKey(s.url, s.trackerSite) === normUrl && !s.sourceListUrl
    )
  );
  if (urlMatches.length === 1) {
    if (
      normMs &&
      urlMatches[0].manuscriptNumber &&
      normalizeManuscriptNumber(urlMatches[0].manuscriptNumber) !== normMs
    ) {
      return { match: null, ambiguousCandidates: urlMatches };
    }
    return { match: urlMatches[0], ambiguousCandidates: [] };
  }

  return { match: null, ambiguousCandidates: [] };
}

export function buildExportBundle(
  papers: PaperRecord[],
  deletedPapers: DeletedPaperRecord[],
  history: HistoryEntry[],
  settings: DashboardSettings,
  rememberedIdentities: Record<string, string>,
  shareableMasked: boolean
): ExportBundle {
  const safePapers = shareableMasked
    ? papers.map((p) => ({
        ...p,
        url: maskTrackingUrl(p.url),
        sourceListUrl: p.sourceListUrl ? maskTrackingUrl(p.sourceListUrl) : undefined,
        lastSourceText: '[Masked in shareable export]',
      }))
    : papers;

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    shareableMasked,
    papers: safePapers,
    deletedPapers: shareableMasked ? [] : deletedPapers,
    history,
    settings,
    rememberedIdentities,
  };
}

export function validateExportBundle(raw: unknown): { ok: true; bundle: ExportBundle } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'File is not a valid JSON object.' };
  }
  const obj = raw as Partial<ExportBundle>;
  if (typeof obj.schemaVersion !== 'number' || !Array.isArray(obj.papers) || !Array.isArray(obj.history)) {
    return { ok: false, error: 'This file does not match the Journal Paper Dashboard export format.' };
  }
  for (const p of obj.papers) {
    if (!p || typeof p.id !== 'string' || typeof p.title !== 'string' || typeof p.currentStatus !== 'string') {
      return { ok: false, error: 'A paper record inside this export file is damaged or incomplete.' };
    }
  }
  return { ok: true, bundle: obj as ExportBundle };
}

export interface MergePreview {
  matchedUpdatedCount: number;
  newPapersCount: number;
  newHistoryEntriesCount: number;
  unchangedCount: number;
}

export function previewMergeImport(
  currentPapers: PaperRecord[],
  currentHistory: HistoryEntry[],
  incoming: ExportBundle
): MergePreview {
  let matchedUpdatedCount = 0;
  let newPapersCount = 0;
  let unchangedCount = 0;

  for (const inc of incoming.papers) {
    const match = currentPapers.find((cur) => {
      if (cur.id === inc.id) return true;
      const curMs = normalizeManuscriptNumber(cur.manuscriptNumber);
      const incMs = normalizeManuscriptNumber(inc.manuscriptNumber);
      if (curMs && incMs && curMs === incMs && cur.trackerSite === inc.trackerSite) return true;
      return stripUrlForComparison(cur.url) === stripUrlForComparison(inc.url) && cur.title === inc.title;
    });

    if (!match) {
      newPapersCount++;
    } else {
      const incTime = new Date(inc.lastCheckedAt || inc.firstSeenAt).getTime();
      const curTime = new Date(match.lastCheckedAt || match.firstSeenAt).getTime();
      if (incTime > curTime) {
        matchedUpdatedCount++;
      } else {
        unchangedCount++;
      }
    }
  }

  const existingEventIds = new Set(currentHistory.map((h) => h.eventId));
  const newHistoryEntriesCount = incoming.history.filter((h) => !existingEventIds.has(h.eventId)).length;

  return {
    matchedUpdatedCount,
    newPapersCount,
    newHistoryEntriesCount,
    unchangedCount,
  };
}

export function applyMergeImport(
  currentPapers: PaperRecord[],
  currentHistory: HistoryEntry[],
  incoming: ExportBundle
): {
  papers: PaperRecord[];
  history: HistoryEntry[];
} {
  const nextPapers = [...currentPapers];
  let maxOrder = nextPapers.reduce((acc, p) => Math.max(acc, p.orderIndex), -1);

  for (const inc of incoming.papers) {
    const idx = nextPapers.findIndex((cur) => {
      if (cur.id === inc.id) return true;
      const curMs = normalizeManuscriptNumber(cur.manuscriptNumber);
      const incMs = normalizeManuscriptNumber(inc.manuscriptNumber);
      if (curMs && incMs && curMs === incMs && cur.trackerSite === inc.trackerSite) return true;
      return stripUrlForComparison(cur.url) === stripUrlForComparison(inc.url) && cur.title === inc.title;
    });

    if (idx === -1) {
      maxOrder += 1;
      nextPapers.push({ ...inc, orderIndex: maxOrder });
    } else {
      const cur = nextPapers[idx];
      const incTime = new Date(inc.lastCheckedAt || inc.firstSeenAt).getTime();
      const curTime = new Date(cur.lastCheckedAt || cur.firstSeenAt).getTime();
      if (incTime > curTime) {
        nextPapers[idx] = {
          ...cur,
          ...inc,
          id: cur.id,
          orderIndex: cur.orderIndex,
          notes: cur.notes || inc.notes,
        };
      }
    }
  }

  const existingEventIds = new Set(currentHistory.map((h) => h.eventId));
  const dedupedNewHistory = incoming.history.filter((h) => !existingEventIds.has(h.eventId));
  const mergedHistory = [...currentHistory, ...dedupedNewHistory].sort(
    (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
  );

  return {
    papers: nextPapers,
    history: mergedHistory,
  };
}

export function createBackupSnapshot(
  reason: string,
  papers: PaperRecord[],
  deletedPapers: DeletedPaperRecord[],
  history: HistoryEntry[],
  settings: DashboardSettings,
  rememberedIdentities: Record<string, string>,
  existingBackups: BackupSnapshot[]
): BackupSnapshot[] {
  const bundle = buildExportBundle(
    papers,
    deletedPapers,
    history,
    settings,
    rememberedIdentities,
    false
  );
  const snap: BackupSnapshot = {
    id: generateId(),
    createdAt: new Date().toISOString(),
    reason,
    paperCount: papers.length,
    payload: JSON.stringify(bundle),
  };
  return [snap, ...existingBackups].slice(0, 10);
}
