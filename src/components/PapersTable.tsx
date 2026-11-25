import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  FileText,
  GripVertical,
  History,
  KeyRound,
  PauseCircle,
  Pencil,
  RefreshCw,
  SearchX,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { DashboardSettings, HealthState, PaperRecord } from '../types';
import {
  computeDaysInStatus,
  formatDateOnly,
  formatRelativeTime,
  getEffectivePaperHealth,
  getPaperSources,
  maskTrackingUrl,
  resolveStatusGroup,
} from '../utils/paperLogic';

interface PapersTableProps {
  papers: PaperRecord[];
  totalPaperCount: number;
  settings: DashboardSettings;
  readingPaperIds: Set<string>;
  isInitialLoading: boolean;
  isManualOrder: boolean;
  onRefreshPaper: (paperId: string) => void;
  onMarkSeen: (paperId: string) => void;
  onOpenDetail: (paper: PaperRecord, initialTab?: 'details' | 'edit' | 'history' | 'source') => void;
  onDeleteRequest: (paper: PaperRecord) => void;
  onReorderPapers: (sourceId: string, targetId: string) => void;
  onMoveToEdge: (paperId: string, edge: 'top' | 'bottom') => void;
  onQuickAddUrl: (url: string) => void;
  onOpenManualAdd: () => void;
}

function renderHealthIndicator(health: HealthState, message: string | null) {
  switch (health) {
    case 'OK':
      return (
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>OK</span>
        </span>
      );
    case 'Sign-in needed':
      return (
        <span
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-amber-700 dark:text-amber-400"
          title={message || 'Sign-in needed in your browser'}
        >
          <KeyRound className="w-4 h-4 shrink-0" />
          <span className="whitespace-nowrap">Sign-in needed</span>
        </span>
      );
    case 'Tab not open':
      return (
        <span
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-amber-700 dark:text-amber-400"
          title={message || 'Open this portal tab in your browser so the extension can reload and read it.'}
        >
          <Clock className="w-4 h-4 shrink-0" />
          <span className="whitespace-nowrap">Tab not open</span>
        </span>
      );
    case 'Timed out':
      return (
        <span
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-amber-700 dark:text-amber-400"
          title={message || 'Page timed out'}
        >
          <Clock className="w-4 h-4 shrink-0" />
          <span className="whitespace-nowrap">Timed out</span>
        </span>
      );
    case 'Not found':
      return (
        <span
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-700 dark:text-slate-300"
          title={message || 'Not in list, check page'}
        >
          <SearchX className="w-4 h-4 shrink-0" />
          <span className="whitespace-nowrap">Not in list</span>
        </span>
      );
    case 'AI error':
      return (
        <span
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-rose-700 dark:text-rose-400"
          title={message || 'AI could not read page'}
        >
          <XCircle className="w-4 h-4 shrink-0" />
          <span className="whitespace-nowrap">AI error</span>
        </span>
      );
    case 'Layout changed':
      return (
        <span
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-amber-700 dark:text-amber-400"
          title={message || 'Tracker layout changed'}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="whitespace-nowrap">Layout changed</span>
        </span>
      );
    case 'Paused':
      return (
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-400">
          <PauseCircle className="w-4 h-4 shrink-0" />
          <span>Paused</span>
        </span>
      );
  }
}

function getSourceColorClass(trackerSite: string): string {
  const lower = (trackerSite || '').toLowerCase();
  if (lower.includes('editorial manager')) return 'text-blue-700 dark:text-blue-400';
  if (lower.includes('authorhub') || lower.includes('elsevier')) {
    return 'text-orange-700 dark:text-orange-400';
  }
  if (lower.includes('research square')) return 'text-emerald-700 dark:text-emerald-400';
  if (lower.includes('scholarone')) return 'text-indigo-700 dark:text-indigo-400';
  return 'text-purple-700 dark:text-purple-400';
}

export const PapersTable: React.FC<PapersTableProps> = ({
  papers,
  totalPaperCount,
  settings,
  readingPaperIds,
  isInitialLoading,
  isManualOrder,
  onRefreshPaper,
  onMarkSeen,
  onOpenDetail,
  onDeleteRequest,
  onReorderPapers,
  onMoveToEdge,
  onQuickAddUrl,
  onOpenManualAdd,
}) => {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [emptyInput, setEmptyInput] = useState('');
  const [copiedPaperId, setCopiedPaperId] = useState<string | null>(null);

  const handleCopyTrackerUrl = async (paper: PaperRecord) => {
    if (!paper.url || paper.url === 'manual://entry') return;
    try {
      await navigator.clipboard.writeText(paper.url);
      setCopiedPaperId(paper.id);
      setTimeout(() => {
        setCopiedPaperId((prev) => (prev === paper.id ? null : prev));
      }, 1500);
    } catch {
      // Ignore clipboard permission errors silently
    }
  };

  const isCompact = settings.density === 'compact';
  const cellPad = isCompact ? 'py-2 px-2.5' : 'py-3 px-3';

  if (isInitialLoading) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-2.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-10 rounded bg-slate-100 dark:bg-slate-800 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (totalPaperCount === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-center max-w-3xl mx-auto my-6">
        <h2 className="text-[20px] font-semibold text-slate-900 dark:text-slate-100">
          Add your first journal tracker link
        </h2>
        <p className="mt-2 text-[15px] text-slate-600 dark:text-slate-300 max-w-xl mx-auto">
          Paste a link from Editorial Manager, Elsevier AuthorHub, Research Square, or any journal portal. The AI reads the page text automatically—no selector picking needed.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onQuickAddUrl(emptyInput);
          }}
          className="mt-5 flex flex-col sm:flex-row gap-2.5 max-w-xl mx-auto"
        >
          <input
            type="text"
            value={emptyInput}
            onChange={(e) => setEmptyInput(e.target.value)}
            placeholder="https://www.editorialmanager.com/..."
            aria-label="Tracker URL"
            className="flex-1 px-3.5 py-2.5 text-[15px] bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <button
            type="submit"
            className="px-5 py-2.5 text-[15px] font-medium text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Read &amp; add
          </button>
          <button
            type="button"
            onClick={onOpenManualAdd}
            className="px-4 py-2.5 text-[14px] font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Add by hand
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800">
          <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400 mb-2.5">
            Try built-in test tracker pages (safe sandbox, never touches real accounts):
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => onQuickAddUrl(`${window.location.origin}/api/test-tracker/editorial-manager`)}
              className="px-3 py-1.5 text-[13px] font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Test Editorial Manager (2 papers)
            </button>
            <button
              type="button"
              onClick={() => onQuickAddUrl(`${window.location.origin}/api/test-tracker/research-square`)}
              className="px-3 py-1.5 text-[13px] font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Test Research Square
            </button>
            <button
              type="button"
              onClick={() => onQuickAddUrl(`${window.location.origin}/api/test-tracker/elsevier-authorhub`)}
              className="px-3 py-1.5 text-[13px] font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Test Elsevier AuthorHub
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (papers.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-center">
        <p className="text-[15px] text-slate-600 dark:text-slate-300">
          No papers match your current filter or search. Showing 0 of {totalPaperCount} papers.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col min-h-0 flex-1 overflow-hidden">
      <div className="overflow-auto dashboard-scroll flex-1">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[13px] font-semibold text-slate-600 dark:text-slate-300">
            <tr>
              <th className={`${cellPad} w-14`} title="Reorder papers">
                Order
              </th>
              <th className={`${cellPad} min-w-[160px]`}>Journal</th>
              <th className={`${cellPad} min-w-[130px]`}>MS #</th>
              <th className={`${cellPad} min-w-[240px] max-w-[360px]`}>Title</th>
              <th className={`${cellPad} whitespace-nowrap`}>Submitted</th>
              <th className={`${cellPad} min-w-[200px]`}>Status</th>
              <th className={`${cellPad} whitespace-nowrap`}>Status date</th>
              <th className={`${cellPad} text-right whitespace-nowrap`}>Days</th>
              <th className={`${cellPad} whitespace-nowrap`}>Changed</th>
              <th className={`${cellPad} whitespace-nowrap`}>Checked</th>
              <th className={`${cellPad} whitespace-nowrap`}>Health</th>
              <th className={`${cellPad} text-right whitespace-nowrap`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-[14px]">
            {papers.map((paper, idx) => {
              const isReading = readingPaperIds.has(paper.id);
              const group = resolveStatusGroup(paper.currentStatus, settings);
              const { days, basis } = computeDaysInStatus(paper);
              const sources = getPaperSources(paper);
              const distinctOtherStatuses = sources.filter(
                (s) =>
                  s.currentStatus &&
                  s.currentStatus.trim().toLowerCase() !== paper.currentStatus.trim().toLowerCase()
              );
              const isDragTarget = dragOverId === paper.id && draggedId !== paper.id;

              return (
                <tr
                  key={paper.id}
                  draggable={isManualOrder}
                  onDragStart={() => setDraggedId(paper.id)}
                  onDragOver={(e) => {
                    if (!isManualOrder) return;
                    e.preventDefault();
                    setDragOverId(paper.id);
                  }}
                  onDragLeave={() => {
                    if (dragOverId === paper.id) setDragOverId(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (isManualOrder && draggedId && draggedId !== paper.id) {
                      onReorderPapers(draggedId, paper.id);
                    }
                    setDraggedId(null);
                    setDragOverId(null);
                  }}
                  onDragEnd={() => {
                    setDraggedId(null);
                    setDragOverId(null);
                  }}
                  className={`transition-colors ${
                    isDragTarget
                      ? 'bg-blue-50 dark:bg-blue-950/40'
                      : paper.hasUnseenChange
                      ? 'bg-indigo-50/70 dark:bg-indigo-950/30 hover:bg-indigo-50 dark:hover:bg-indigo-950/45'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  {/* Order Handle + Top/Bottom shortcuts */}
                  <td className={`${cellPad} align-middle`}>
                    <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500">
                      <span
                        className={isManualOrder ? 'cursor-grab active:cursor-grabbing hover:text-slate-700 dark:hover:text-slate-200' : 'opacity-30'}
                        title={isManualOrder ? 'Drag to reorder' : 'Switch sort to Manual order to drag'}
                      >
                        <GripVertical className="w-4 h-4" />
                      </span>
                      {isManualOrder && (
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => onMoveToEdge(paper.id, 'top')}
                            title="Move to top"
                            className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-25 text-slate-500 dark:text-slate-400"
                          >
                            <ArrowUpToLine className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === papers.length - 1}
                            onClick={() => onMoveToEdge(paper.id, 'bottom')}
                            title="Move to bottom"
                            className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-25 text-slate-500 dark:text-slate-400"
                          >
                            <ArrowDownToLine className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Journal Name & Merged Portal Sources */}
                  <td className={`${cellPad} align-middle`}>
                    <div className="font-semibold text-[15px] text-slate-900 dark:text-slate-100 leading-snug max-w-[215px] truncate" title={paper.journalName}>
                      {paper.journalName || 'Not shown'}
                    </div>
                    <div className="text-[12px] font-medium max-w-[215px] flex flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-tight">
                      {sources.length === 1 ? (
                        <span
                          className={`truncate ${getSourceColorClass(sources[0].trackerSite)}`}
                          title={maskTrackingUrl(sources[0].url)}
                        >
                          {sources[0].trackerSite}
                        </span>
                      ) : (
                        sources.map((src, sIdx) => (
                          <React.Fragment key={src.id}>
                            {sIdx > 0 && (
                              <span className="text-slate-400 dark:text-slate-500" aria-hidden="true">
                                ·
                              </span>
                            )}
                            {src.url && src.url !== 'manual://entry' ? (
                              <button
                                type="button"
                                onClick={() => onOpenDetail(paper, 'details')}
                                title={`${src.trackerSite}: ${src.currentStatus || 'OK'} (${src.health}) — ${maskTrackingUrl(src.url)} (click for details)`}
                                className={`hover:underline focus:outline-none ${getSourceColorClass(src.trackerSite)}`}
                              >
                                {src.trackerSite}
                              </button>
                            ) : (
                              <span className={getSourceColorClass(src.trackerSite)}>
                                {src.trackerSite}
                              </span>
                            )}
                          </React.Fragment>
                        ))
                      )}
                    </div>
                  </td>

                  {/* Manuscript # & Revision */}
                  <td className={`${cellPad} align-middle font-mono tabular-nums text-[13px] text-slate-700 dark:text-slate-300 whitespace-nowrap`}>
                    <span>{paper.manuscriptNumber || 'Not shown'}</span>
                    {paper.revision && (
                      <span className="ml-1.5 text-[12px] font-semibold text-slate-500 dark:text-slate-400">
                        ({paper.revision})
                      </span>
                    )}
                  </td>

                  {/* Title (1 line with hover & click) */}
                  <td className={`${cellPad} align-middle max-w-[340px]`}>
                    <button
                      type="button"
                      onClick={() => onOpenDetail(paper, 'details')}
                      title={paper.title}
                      className="text-left w-full truncate font-medium text-[14px] text-slate-800 dark:text-slate-200 hover:text-blue-700 dark:hover:text-blue-400 transition-colors block focus:outline-none focus-visible:underline"
                    >
                      {paper.title}
                    </button>
                  </td>

                  {/* Submitted Date */}
                  <td className={`${cellPad} align-middle font-mono tabular-nums text-[13px] text-slate-700 dark:text-slate-300 whitespace-nowrap`}>
                    <span>{formatDateOnly(paper.submissionDate, settings.dateFormat)}</span>
                    {paper.submissionDateAmbiguous && (
                      <span className="ml-1.5 text-[12px] font-sans font-semibold text-amber-700 dark:text-amber-400" title="Ambiguous day/month order — click Edit to confirm">
                        [check]
                      </span>
                    )}
                  </td>

                  {/* Current Status (coloured swatch + exact verbatim text + merged source statuses) */}
                  <td className={`${cellPad} align-middle`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: group.color }}
                        aria-hidden="true"
                      />
                      <span
                        className="font-medium text-[14px]"
                        style={{ color: group.color }}
                      >
                        {isReading ? 'Reading…' : paper.currentStatus}
                      </span>
                      {paper.uncertainFields.includes('currentStatus') && (
                        <span className="text-[12px] font-semibold text-amber-700 dark:text-amber-400" title="AI is unsure about this value">
                          [check]
                        </span>
                      )}
                      {paper.hasUnseenChange && (
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-700 dark:text-indigo-300">
                          <span>NEW · {formatRelativeTime(paper.unseenDetectedAt)}</span>
                          <button
                            type="button"
                            onClick={() => onMarkSeen(paper.id)}
                            className="underline hover:no-underline text-indigo-800 dark:text-indigo-200"
                          >
                            Seen
                          </button>
                        </span>
                      )}
                      {!paper.hasUnseenChange && paper.hasMinorUpdate && (
                        <span className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                          · updated
                        </span>
                      )}
                    </div>
                    {distinctOtherStatuses.length > 0 && (
                      <div className="text-[12px] font-medium text-slate-600 dark:text-slate-400 mt-0.5 leading-snug flex flex-wrap items-center gap-x-1.5">
                        {distinctOtherStatuses.map((s, sIdx) => (
                          <React.Fragment key={s.id}>
                            {sIdx > 0 && (
                              <span className="text-slate-400 dark:text-slate-500" aria-hidden="true">
                                ·
                              </span>
                            )}
                            <span>
                              <span className={getSourceColorClass(s.trackerSite)}>
                                {s.trackerSite}:
                              </span>{' '}
                              <span className="text-slate-600 dark:text-slate-300">
                                {s.currentStatus}
                              </span>
                            </span>
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </td>

                  {/* Status Date */}
                  <td className={`${cellPad} align-middle font-mono tabular-nums text-[13px] text-slate-700 dark:text-slate-300 whitespace-nowrap`}>
                    <span>{formatDateOnly(paper.statusDate, settings.dateFormat)}</span>
                    {paper.statusDateAmbiguous && (
                      <span className="ml-1.5 text-[12px] font-sans font-semibold text-amber-700 dark:text-amber-400" title="Ambiguous day/month order — click Edit to confirm">
                        [check]
                      </span>
                    )}
                  </td>

                  {/* Days in status */}
                  <td
                    className={`${cellPad} align-middle text-right font-mono tabular-nums text-[13px] text-slate-800 dark:text-slate-200 whitespace-nowrap`}
                    title={`Calculated from ${basis}`}
                  >
                    <span className="font-semibold">{days}d</span>
                    <span className="ml-1 text-[11px] font-sans text-slate-500 dark:text-slate-400">
                      ({basis === 'page date' ? 'page' : 'seen'})
                    </span>
                  </td>

                  {/* Last Changed */}
                  <td className={`${cellPad} align-middle font-mono tabular-nums text-[13px] text-slate-600 dark:text-slate-400 whitespace-nowrap`}>
                    {formatRelativeTime(paper.lastChangedAt)}
                  </td>

                  {/* Last Checked */}
                  <td className={`${cellPad} align-middle font-mono tabular-nums text-[13px] text-slate-600 dark:text-slate-400 whitespace-nowrap`}>
                    {formatRelativeTime(paper.lastCheckedAt)}
                  </td>

                  {/* Health */}
                  <td className={`${cellPad} align-middle whitespace-nowrap`}>
                    <button
                      type="button"
                      onClick={() => onOpenDetail(paper, 'details')}
                      className="text-left hover:underline focus:outline-none"
                    >
                      {renderHealthIndicator(getEffectivePaperHealth(paper), paper.healthMessage)}
                    </button>
                  </td>

                  {/* Row Actions */}
                  <td className={`${cellPad} align-middle text-right whitespace-nowrap`}>
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        disabled={isReading}
                        onClick={() => onRefreshPaper(paper.id)}
                        title={isReading ? 'Reading…' : 'Refresh this paper'}
                        className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-45"
                      >
                        <RefreshCw className={`w-4 h-4 ${isReading ? 'animate-spin text-blue-600' : ''}`} />
                      </button>

                      {paper.url && paper.url !== 'manual://entry' && (
                        <button
                          type="button"
                          onClick={() => handleCopyTrackerUrl(paper)}
                          title={copiedPaperId === paper.id ? 'Tracker link copied' : 'Copy tracker link'}
                          aria-label={copiedPaperId === paper.id ? 'Tracker link copied' : 'Copy tracker link'}
                          className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          {copiedPaperId === paper.id ? (
                            <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onOpenDetail(paper, 'edit')}
                        title="Edit paper fields"
                        className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onOpenDetail(paper, 'source')}
                        title="Show source page text"
                        className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <FileText className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onOpenDetail(paper, 'history')}
                        title="View paper history"
                        className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <History className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteRequest(paper)}
                        title="Delete paper"
                        className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer counter & honest background check notice */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 text-[13px] text-slate-600 dark:text-slate-400 shrink-0">
        <span className="font-medium font-mono tabular-nums">
          Showing {papers.length} of {totalPaperCount}
        </span>
        <span>
          Checks run while this PC is on and the browser is open. Transitions that happen and revert between checks may be missed unless shown in the page’s own event log.
        </span>
      </div>
    </div>
  );
};
