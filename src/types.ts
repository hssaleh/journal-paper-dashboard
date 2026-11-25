export type HealthState =
  | 'OK'
  | 'Sign-in needed'
  | 'Tab not open'
  | 'Timed out'
  | 'Layout changed'
  | 'Not found'
  | 'AI error'
  | 'Paused';

export type StatusGroupKey =
  | 'submitted_editor'
  | 'under_review'
  | 'revision_requested'
  | 'accepted'
  | 'rejected'
  | 'unknown';

export interface StatusGroupConfig {
  key: StatusGroupKey;
  label: string;
  color: string; // Hex color
  keywords: string[];
}

export type DateFormatOption = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD MMM YYYY';

export type EmailDeliveryState = 'Pending' | 'Sent' | 'Failed' | 'Not delivered';

export interface HistoryEntry {
  eventId: string;
  paperId: string;
  paperTitle: string;
  journalName: string;
  manuscriptNumber: string | null;
  trackerSite: string;
  detectedAt: string; // UTC ISO
  oldStatus: string;
  newStatus: string;
  statusDateFromPage: string | null;
  otherChangedFields: string[];
  checkSource: 'manual' | 'scheduled' | 'initial' | 'test';
  isMinorUpdate?: boolean;
}

export interface EmailAlertRecord {
  id: string;
  eventIds: string[];
  recipient: string;
  subject: string;
  bodyText: string;
  state: EmailDeliveryState;
  attempts: number;
  createdAt: string; // UTC ISO
  lastAttemptAt: string | null; // UTC ISO
  nextRetryAt: string | null; // UTC ISO
  lastError?: string;
  type: 'status_change' | 'daily_summary' | 'stale_24h' | 'test';
}

export interface PaperSourceLink {
  id: string;
  url: string;
  trackerSite: string;
  manuscriptNumber?: string | null;
  currentStatus?: string | null;
  statusDate?: string | null;
  submissionDate?: string | null;
  reviewCount?: number | null;
  editorOrTeam?: string | null;
  decision?: string | null;
  lastCheckedAt: string | null;
  lastSuccessfulReadAt: string | null;
  health: HealthState;
  healthMessage: string | null;
  healthTechnicalDetails?: string | null;
  lastSourceText?: string;
  sourceListUrl?: string;
  consecutiveFailures?: number;
  nextRetryAt?: string | null;
}

export interface PaperRecord {
  id: string;
  orderIndex: number;
  url: string;
  trackerSite: string;
  sources?: PaperSourceLink[];

  // Core & manuscript fields (Observed)
  journalName: string;
  title: string;
  manuscriptNumber: string | null;
  revision: string | null;
  submissionType: string | null;
  submissionDate: string | null; // YYYY-MM-DD
  submissionDateAmbiguous: boolean;
  currentStatus: string;
  statusDate: string | null; // YYYY-MM-DD
  statusDateAmbiguous: boolean;
  editorOrTeam: string | null;
  reviewCount: number | null;
  decision: string | null;

  // Local fields
  notes: string;
  paused: boolean;
  userEditedFields: Record<string, boolean>;
  allowAutoOverwriteFields: Record<string, boolean>;

  // AI uncertainty & source
  uncertainFields: string[];
  lastSourceText: string;

  // Calculated & state fields
  firstSeenAt: string; // UTC ISO
  statusFirstSeenAt: string; // UTC ISO
  lastCheckedAt: string | null; // UTC ISO
  lastSuccessfulReadAt: string | null; // UTC ISO
  lastChangedAt: string | null; // UTC ISO
  health: HealthState;
  healthMessage: string | null;
  healthTechnicalDetails: string | null;

  // Highlighting
  hasUnseenChange: boolean;
  unseenDetectedAt: string | null;
  hasMinorUpdate: boolean;
  minorUpdateAt: string | null;

  // Retry tracking for failed reads
  consecutiveFailures: number;
  nextRetryAt: string | null;
  staleAlertSentAt: string | null;

  // Ambiguity resolution key
  sourceListUrl?: string;
  isTestRecord?: boolean;
}

export interface DeletedPaperRecord {
  paper: PaperRecord;
  history: HistoryEntry[];
  deletedAt: string; // UTC ISO
}

export interface ExtractedPaper {
  journalName: string | null;
  title: string | null;
  manuscriptNumber: string | null;
  revision: string | null;
  submissionType: string | null;
  submissionDate: string | null;
  submissionDateAmbiguous: boolean;
  currentStatus: string | null;
  statusDate: string | null;
  statusDateAmbiguous: boolean;
  editorOrTeam: string | null;
  reviewCount: number | null;
  decision: string | null;
  uncertainFields: string[];
  pageEventHistory?: Array<{
    date: string | null;
    status: string;
  }>;
}

export interface ExtractionResponse {
  ok: boolean;
  pageState: 'ok' | 'sign_in_needed' | 'not_found' | 'ai_error';
  papers: ExtractedPaper[];
  error?: string;
  technicalDetails?: string;
}

export interface AmbiguousMatchPrompt {
  id: string;
  extracted: ExtractedPaper;
  sourceUrl: string;
  trackerSite: string;
  sourceText: string;
  candidates: PaperRecord[];
}

export type AiProviderOption =
  | 'auto_free'
  | 'pollinations'
  | 'local_reader'
  | 'ollama'
  | 'gemini';

export interface DashboardSettings {
  theme: 'light' | 'dark';
  density: 'compact' | 'comfortable';
  showGraphs: boolean;
  dateFormat: DateFormatOption;
  timezone: string; // e.g., 'Asia/Riyadh'
  recipientEmail: string;
  emailMode: 'per_change' | 'daily_summary' | 'both';
  includeWorkingLinkInEmail: boolean;
  checkIntervalMinutes: number; // default 60
  fasterCheckingApproved: boolean;
  autoCheckPausedAll: boolean;
  aiProvider: AiProviderOption;
  statusGroups: StatusGroupConfig[];
  customStatusMappings: Record<string, StatusGroupKey>;
  simulateEmailFailure: boolean;
}

export interface BackupSnapshot {
  id: string;
  createdAt: string;
  reason: string;
  paperCount: number;
  payload: string; // JSON stringified ExportBundle
}

export interface ExportBundle {
  schemaVersion: number;
  exportedAt: string;
  shareableMasked: boolean;
  papers: PaperRecord[];
  deletedPapers: DeletedPaperRecord[];
  history: HistoryEntry[];
  settings: DashboardSettings;
  rememberedIdentities: Record<string, string>;
}
