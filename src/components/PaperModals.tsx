import React, { useState } from 'react';
import { X, AlertTriangle, RotateCcw, Trash2, Check, RefreshCw } from 'lucide-react';
import type {
  AmbiguousMatchPrompt,
  DashboardSettings,
  DeletedPaperRecord,
  ExtractedPaper,
  HistoryEntry,
  PaperRecord,
} from '../types';
import {
  computeDaysInStatus,
  computeDaysSinceSubmission,
  formatDateOnly,
  formatDateTime,
  formatRelativeTime,
  getEffectivePaperHealth,
  getPaperSources,
  maskTrackingUrl,
} from '../utils/paperLogic';

/* -------------------------------------------------------------------------- */
/* 1. Multi-Paper Selection Modal ("Found N papers")                          */
/* -------------------------------------------------------------------------- */
export interface DiscoveredPaperItem {
  extracted: ExtractedPaper;
  alreadyTrackedPaper: PaperRecord | null;
}

export const MultiPaperPickerModal: React.FC<{
  sourceUrl: string;
  items: DiscoveredPaperItem[];
  onClose: () => void;
  onConfirmAdd: (selected: ExtractedPaper[]) => void;
}> = ({ sourceUrl, items, onClose, onConfirmAdd }) => {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    items.forEach((item, idx) => {
      if (!item.alreadyTrackedPaper) initial.add(idx);
    });
    return initial;
  });

  const untrackedCount = items.filter((i) => !i.alreadyTrackedPaper).length;

  const toggleIndex = (idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
              Found {items.length} papers
            </h2>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
              Source: {maskTrackingUrl(sourceUrl)}. Already-tracked papers are ticked and locked to prevent duplicates.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-2.5">
          {items.map((item, idx) => {
            const isTracked = Boolean(item.alreadyTrackedPaper);
            const isChecked = isTracked || selectedIndices.has(idx);
            return (
              <label
                key={idx}
                className={`flex items-start gap-3 p-3.5 rounded-lg border transition-colors ${
                  isTracked
                    ? 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 opacity-65 cursor-not-allowed'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={isTracked}
                  onChange={() => toggleIndex(idx)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {item.extracted.journalName || 'Journal not shown'}
                    </span>
                    <span className="text-[12px] font-mono text-slate-500 dark:text-slate-400 shrink-0">
                      {item.extracted.manuscriptNumber || 'No MS #'}
                    </span>
                  </div>
                  <p className="text-[14px] text-slate-800 dark:text-slate-200 mt-0.5">
                    {item.extracted.title || 'Untitled manuscript'}
                  </p>
                  <div className="text-[13px] text-slate-600 dark:text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                    <span>Status: {item.extracted.currentStatus || 'Not shown'}</span>
                    {isTracked && (
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        · Already tracked
                      </span>
                    )}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[14px] font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={untrackedCount === 0 || selectedIndices.size === 0}
            onClick={() => {
              const chosen = items
                .filter((_, idx) => selectedIndices.has(idx))
                .map((i) => i.extracted);
              onConfirmAdd(chosen);
            }}
            className="px-4 py-2 text-[14px] font-medium text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 disabled:opacity-45 rounded-lg"
          >
            Add {selectedIndices.size} selected
          </button>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 2. Manual "Add by hand" Modal                                              */
/* -------------------------------------------------------------------------- */
export const ManualAddModal: React.FC<{
  onClose: () => void;
  onSave: (data: {
    journalName: string;
    title: string;
    manuscriptNumber: string;
    revision: string;
    submissionDate: string;
    currentStatus: string;
    statusDate: string;
    url: string;
    notes: string;
  }) => void;
}> = ({ onClose, onSave }) => {
  const [journalName, setJournalName] = useState('');
  const [title, setTitle] = useState('');
  const [manuscriptNumber, setManuscriptNumber] = useState('');
  const [revision, setRevision] = useState('');
  const [submissionDate, setSubmissionDate] = useState('');
  const [currentStatus, setCurrentStatus] = useState('Submitted');
  const [statusDate, setStatusDate] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!journalName.trim() || !title.trim() || !currentStatus.trim()) {
      setError('Please enter at least the journal name, title, and current status.');
      return;
    }
    onSave({
      journalName: journalName.trim(),
      title: title.trim(),
      manuscriptNumber: manuscriptNumber.trim(),
      revision: revision.trim(),
      submissionDate: submissionDate.trim(),
      currentStatus: currentStatus.trim(),
      statusDate: statusDate.trim(),
      url: url.trim() || 'manual://entry',
      notes: notes.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-xl w-full shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
            Add paper by hand
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-[14px]">
          {error && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Journal name *
              </label>
              <input
                type="text"
                value={journalName}
                onChange={(e) => setJournalName(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Manuscript number
              </label>
              <input
                type="text"
                value={manuscriptNumber}
                onChange={(e) => setManuscriptNumber(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Paper title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Current status *
              </label>
              <input
                type="text"
                value={currentStatus}
                onChange={(e) => setCurrentStatus(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Submitted date
              </label>
              <input
                type="date"
                value={submissionDate}
                onChange={(e) => setSubmissionDate(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-mono"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Status date
              </label>
              <input
                type="date"
                value={statusDate}
                onChange={(e) => setStatusDate(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Revision / Round
              </label>
              <input
                type="text"
                value={revision}
                placeholder="e.g. R1"
                onChange={(e) => setRevision(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Tracker URL (optional)
              </label>
              <input
                type="url"
                value={url}
                placeholder="https://..."
                onChange={(e) => setUrl(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Your notes
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[14px] font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-[14px] font-medium text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-500"
            >
              Save paper
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 3. Paper Detail / Edit / Source / Timeline Modal                           */
/* -------------------------------------------------------------------------- */
export const PaperDetailModal: React.FC<{
  paper: PaperRecord;
  history: HistoryEntry[];
  settings: DashboardSettings;
  initialTab: 'details' | 'edit' | 'history' | 'source';
  onClose: () => void;
  onSaveEdits: (updated: PaperRecord) => void;
  onConfirmUncertainField: (paperId: string, field: string) => void;
  onTogglePause: (paperId: string) => void;
  onResetHealth?: (paperId: string) => void;
  onRefreshSource?: (paperId: string, sourceUrl: string) => void;
  onRemoveSource?: (paperId: string, sourceId: string) => void;
}> = ({
  paper,
  history,
  settings,
  initialTab,
  onClose,
  onSaveEdits,
  onConfirmUncertainField,
  onTogglePause,
  onResetHealth,
  onRefreshSource,
  onRemoveSource,
}) => {
  const [tab, setTab] = useState<'details' | 'edit' | 'history' | 'source'>(initialTab);
  const [showTechDetails, setShowTechDetails] = useState(false);

  const [form, setForm] = useState({
    journalName: paper.journalName,
    title: paper.title,
    manuscriptNumber: paper.manuscriptNumber || '',
    revision: paper.revision || '',
    submissionType: paper.submissionType || '',
    submissionDate: paper.submissionDate || '',
    currentStatus: paper.currentStatus,
    statusDate: paper.statusDate || '',
    editorOrTeam: paper.editorOrTeam || '',
    reviewCount: paper.reviewCount !== null ? String(paper.reviewCount) : '',
    decision: paper.decision || '',
    url: paper.url,
    notes: paper.notes,
  });

  const [allowOverwrite, setAllowOverwrite] = useState<Record<string, boolean>>(
    paper.allowAutoOverwriteFields || {}
  );

  const { days: daysInStatus, basis } = computeDaysInStatus(paper);
  const daysSinceSub = computeDaysSinceSubmission(paper);
  const paperHistory = history.filter((h) => h.paperId === paper.id);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const nextEdited = { ...paper.userEditedFields };
    const trackField = (key: string, newVal: string, oldVal: string) => {
      if (newVal.trim() !== oldVal.trim()) {
        nextEdited[key] = true;
      }
    };
    trackField('journalName', form.journalName, paper.journalName);
    trackField('title', form.title, paper.title);
    trackField('manuscriptNumber', form.manuscriptNumber, paper.manuscriptNumber || '');
    trackField('revision', form.revision, paper.revision || '');
    trackField('submissionType', form.submissionType, paper.submissionType || '');
    trackField('submissionDate', form.submissionDate, paper.submissionDate || '');
    trackField('currentStatus', form.currentStatus, paper.currentStatus);
    trackField('statusDate', form.statusDate, paper.statusDate || '');
    trackField('editorOrTeam', form.editorOrTeam, paper.editorOrTeam || '');
    trackField('decision', form.decision, paper.decision || '');

    onSaveEdits({
      ...paper,
      journalName: form.journalName.trim() || paper.journalName,
      title: form.title.trim() || paper.title,
      manuscriptNumber: form.manuscriptNumber.trim() || null,
      revision: form.revision.trim() || null,
      submissionType: form.submissionType.trim() || null,
      submissionDate: form.submissionDate.trim() || null,
      submissionDateAmbiguous:
        form.submissionDate.trim() !== (paper.submissionDate || '')
          ? false
          : paper.submissionDateAmbiguous,
      currentStatus: form.currentStatus.trim() || paper.currentStatus,
      statusDate: form.statusDate.trim() || null,
      statusDateAmbiguous:
        form.statusDate.trim() !== (paper.statusDate || '')
          ? false
          : paper.statusDateAmbiguous,
      editorOrTeam: form.editorOrTeam.trim() || null,
      reviewCount: form.reviewCount.trim() ? Number(form.reviewCount) : null,
      decision: form.decision.trim() || null,
      url: form.url.trim() || paper.url,
      notes: form.notes,
      userEditedFields: nextEdited,
      allowAutoOverwriteFields: allowOverwrite,
    });
    onClose();
  };

  const renderFieldLabel = (key: string, label: string) => {
    const isEdited = paper.userEditedFields[key];
    const isUncertain =
      paper.uncertainFields.includes(key) ||
      (key === 'submissionDate' && paper.submissionDateAmbiguous) ||
      (key === 'statusDate' && paper.statusDateAmbiguous);

    return (
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
          {label}
          {isEdited && (
            <span className="ml-1.5 text-[11px] font-semibold text-blue-700 dark:text-blue-400">
              (edited by you)
            </span>
          )}
          {isUncertain && (
            <span className="ml-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
              [check]
            </span>
          )}
        </span>
        {isEdited && (
          <label className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(allowOverwrite[key])}
              onChange={(e) =>
                setAllowOverwrite((prev) => ({ ...prev, [key]: e.target.checked }))
              }
            />
            <span>Allow auto-overwrite</span>
          </label>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-xl">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-blue-700 dark:text-blue-400">
              {paper.journalName} · {paper.manuscriptNumber || 'No MS #'}
            </div>
            <h2 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100 mt-0.5 leading-snug">
              {paper.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub-tabs */}
        <div className="flex items-center justify-between gap-4 px-5 py-2.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            {(['details', 'edit', 'history', 'source'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-[13px] font-medium rounded-md capitalize transition-colors ${
                  tab === t
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {t === 'source' ? 'Show source' : t}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onTogglePause(paper.id)}
            className="px-3 py-1.5 text-[13px] font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {paper.paused ? 'Resume auto-check' : 'Pause auto-check'}
          </button>
        </div>

        <div className="overflow-y-auto p-5 flex-1 text-[14px]">
          {tab === 'details' && (
            <div className="space-y-5">
              {getEffectivePaperHealth(paper) !== 'OK' && (
                <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-amber-900 dark:text-amber-200">
                      Health: {getEffectivePaperHealth(paper)}
                    </div>
                    <p className="text-[13px] text-amber-800 dark:text-amber-300 mt-1">
                      {paper.healthMessage || 'Check the tracker page in your browser.'}
                    </p>
                    {paper.healthTechnicalDetails && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => setShowTechDetails((v) => !v)}
                          className="text-[12px] underline text-amber-900 dark:text-amber-300"
                        >
                          {showTechDetails ? 'Hide details' : 'Technical details'}
                        </button>
                        {showTechDetails && (
                          <pre className="mt-1.5 p-2 rounded bg-white/80 dark:bg-slate-950 text-[12px] font-mono overflow-x-auto">
                            {paper.healthTechnicalDetails}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                  {onResetHealth && (
                    <button
                      type="button"
                      onClick={() => onResetHealth(paper.id)}
                      className="px-3 py-1.5 text-[13px] font-medium bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 rounded-md hover:bg-amber-100 dark:hover:bg-slate-800 shrink-0"
                    >
                      Mark OK / Dismiss
                    </button>
                  )}
                </div>
              )}

              {/* Uncertain values confirmation prompt */}
              {(paper.uncertainFields.length > 0 ||
                paper.submissionDateAmbiguous ||
                paper.statusDateAmbiguous) && (
                <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 text-[14px]">
                    Values marked “check” (confirm before alerts use them)
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {paper.submissionDateAmbiguous && (
                      <button
                        type="button"
                        onClick={() => onConfirmUncertainField(paper.id, 'submissionDate')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-[13px] hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        Confirm submission date ({formatDateOnly(paper.submissionDate, settings.dateFormat)})
                      </button>
                    )}
                    {paper.statusDateAmbiguous && (
                      <button
                        type="button"
                        onClick={() => onConfirmUncertainField(paper.id, 'statusDate')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-[13px] hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        Confirm status date ({formatDateOnly(paper.statusDate, settings.dateFormat)})
                      </button>
                    )}
                    {paper.uncertainFields
                      .filter((f) => f !== 'submissionDate' && f !== 'statusDate')
                      .map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => onConfirmUncertainField(paper.id, f)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-[13px] hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          Confirm {f}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* Three field groups: Observed, Calculated, Local */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2.5">
                  <h3 className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">
                    Observed from page
                  </h3>
                  <dl className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-2">
                    <div className="flex justify-between gap-4">
                      <dt className="text-slate-500 dark:text-slate-400">Current status</dt>
                      <dd className="font-semibold text-slate-900 dark:text-slate-100 text-right">
                        {paper.currentStatus}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-slate-500 dark:text-slate-400">Status date</dt>
                      <dd className="font-mono text-slate-900 dark:text-slate-100">
                        {formatDateOnly(paper.statusDate, settings.dateFormat)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-slate-500 dark:text-slate-400">Submission date</dt>
                      <dd className="font-mono text-slate-900 dark:text-slate-100">
                        {formatDateOnly(paper.submissionDate, settings.dateFormat)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-slate-500 dark:text-slate-400">Revision / Round</dt>
                      <dd className="text-slate-900 dark:text-slate-100">
                        {paper.revision || 'Not shown'}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-slate-500 dark:text-slate-400">Submission type</dt>
                      <dd className="text-slate-900 dark:text-slate-100">
                        {paper.submissionType || 'Not shown'}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-slate-500 dark:text-slate-400">Editor / team</dt>
                      <dd className="text-slate-900 dark:text-slate-100">
                        {paper.editorOrTeam || 'Not shown'}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-slate-500 dark:text-slate-400">Reviews completed</dt>
                      <dd className="font-mono text-slate-900 dark:text-slate-100">
                        {paper.reviewCount !== null ? paper.reviewCount : 'Not shown'}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-slate-500 dark:text-slate-400">Decision</dt>
                      <dd className="text-slate-900 dark:text-slate-100">
                        {paper.decision || 'Not shown'}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2.5">
                    <h3 className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">
                      Calculated by dashboard
                    </h3>
                    <dl className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-2">
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500 dark:text-slate-400">Days in status</dt>
                        <dd className="font-mono text-slate-900 dark:text-slate-100">
                          {daysInStatus} days (from {basis})
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500 dark:text-slate-400">Days since submission</dt>
                        <dd className="font-mono text-slate-900 dark:text-slate-100">
                          {daysSinceSub !== null ? `${daysSinceSub} days` : 'Not shown'}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500 dark:text-slate-400">First seen</dt>
                        <dd className="font-mono text-slate-900 dark:text-slate-100">
                          {formatDateTime(paper.firstSeenAt, settings.timezone, settings.dateFormat)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500 dark:text-slate-400">Last checked</dt>
                        <dd className="font-mono text-slate-900 dark:text-slate-100">
                          {formatDateTime(paper.lastCheckedAt, settings.timezone, settings.dateFormat)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500 dark:text-slate-400">Last changed</dt>
                        <dd className="font-mono text-slate-900 dark:text-slate-100">
                          {formatDateTime(paper.lastChangedAt, settings.timezone, settings.dateFormat)}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="space-y-1.5">
                    <h3 className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">
                      Local fields
                    </h3>
                    <div className="border-t border-slate-200 dark:border-slate-800 pt-2 space-y-1.5 text-[13px]">
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Link (masked): </span>
                        <span className="font-mono text-slate-800 dark:text-slate-200">
                          {maskTrackingUrl(paper.url)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Your notes: </span>
                        <span className="text-slate-800 dark:text-slate-200">
                          {paper.notes || 'None'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Merged Portal Sources */}
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <h3 className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">
                  Tracked portal sources ({getPaperSources(paper).length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {getPaperSources(paper).map((src, _idx, allSources) => (
                    <div
                      key={src.id}
                      className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[13px] space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {src.trackerSite}
                        </span>
                        <span
                          className={`text-[12px] font-medium ${
                            src.health === 'OK'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {src.health}
                        </span>
                      </div>
                      <div className="text-slate-700 dark:text-slate-300">
                        Status: <strong>{src.currentStatus || 'Not shown'}</strong>
                        {src.statusDate ? ` · ${formatDateOnly(src.statusDate, settings.dateFormat)}` : ''}
                      </div>
                      <div className="text-[12px] font-mono text-slate-500 dark:text-slate-400 truncate">
                        {maskTrackingUrl(src.url)}
                      </div>
                      {src.lastSuccessfulReadAt && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          Last read: {formatRelativeTime(src.lastSuccessfulReadAt)}
                        </div>
                      )}
                      {src.healthMessage && src.health !== 'OK' && (
                        <div className="text-[12px] text-amber-700 dark:text-amber-400">
                          {src.healthMessage}
                        </div>
                      )}
                      {(onRefreshSource || (onRemoveSource && allSources.length > 1)) && (
                        <div className="flex items-center gap-2 pt-1">
                          {onRefreshSource && src.url && src.url !== 'manual://entry' && (
                            <button
                              type="button"
                              onClick={() => onRefreshSource(paper.id, src.url)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Refresh source
                            </button>
                          )}
                          {onRemoveSource && allSources.length > 1 && (
                            <button
                              type="button"
                              onClick={() => onRemoveSource(paper.id, src.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-700 dark:text-rose-400"
                            >
                              <Trash2 className="w-3 h-3" />
                              Remove
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'edit' && (
            <form onSubmit={handleSave} className="space-y-3.5">
              <p className="text-[13px] text-slate-600 dark:text-slate-400">
                Fields you change manually are marked “edited by you” and protected from automatic overwrite unless you check “Allow auto-overwrite”.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  {renderFieldLabel('journalName', 'Journal name')}
                  <input
                    type="text"
                    value={form.journalName}
                    onChange={(e) => setForm({ ...form, journalName: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  {renderFieldLabel('manuscriptNumber', 'Manuscript number')}
                  <input
                    type="text"
                    value={form.manuscriptNumber}
                    onChange={(e) => setForm({ ...form, manuscriptNumber: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div>
                {renderFieldLabel('title', 'Title')}
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  {renderFieldLabel('currentStatus', 'Current status')}
                  <input
                    type="text"
                    value={form.currentStatus}
                    onChange={(e) => setForm({ ...form, currentStatus: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  {renderFieldLabel('submissionDate', 'Submission date (YYYY-MM-DD)')}
                  <input
                    type="date"
                    value={form.submissionDate}
                    onChange={(e) => setForm({ ...form, submissionDate: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg font-mono"
                  />
                </div>
                <div>
                  {renderFieldLabel('statusDate', 'Status date (YYYY-MM-DD)')}
                  <input
                    type="date"
                    value={form.statusDate}
                    onChange={(e) => setForm({ ...form, statusDate: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  {renderFieldLabel('revision', 'Revision / Round')}
                  <input
                    type="text"
                    value={form.revision}
                    onChange={(e) => setForm({ ...form, revision: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  {renderFieldLabel('editorOrTeam', 'Editor / Team')}
                  <input
                    type="text"
                    value={form.editorOrTeam}
                    onChange={(e) => setForm({ ...form, editorOrTeam: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  {renderFieldLabel('decision', 'Decision')}
                  <input
                    type="text"
                    value={form.decision}
                    onChange={(e) => setForm({ ...form, decision: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Saved tracker URL (overwrite if open tab changed)
                </label>
                <input
                  type="text"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg font-mono text-[13px]"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Your notes (local)
                </label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-[14px] font-medium bg-slate-100 dark:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-[14px] font-medium text-white bg-slate-900 dark:bg-blue-600 rounded-lg"
                >
                  Save changes
                </button>
              </div>
            </form>
          )}

          {tab === 'history' && (
            <div className="space-y-2.5">
              {paperHistory.length === 0 ? (
                <p className="text-slate-500 dark:text-slate-400">
                  No status changes recorded yet for this paper. The starting status was logged when first added.
                </p>
              ) : (
                paperHistory.map((h) => (
                  <div
                    key={h.eventId}
                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {h.isMinorUpdate ? (
                          <span>Updated: {h.otherChangedFields.join(', ')}</span>
                        ) : (
                          <span>
                            {h.oldStatus} → <strong className="text-blue-700 dark:text-blue-400">{h.newStatus}</strong>
                          </span>
                        )}
                      </div>
                      <div className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Source: {h.checkSource} check · Page status date: {formatDateOnly(h.statusDateFromPage, settings.dateFormat)}
                      </div>
                    </div>
                    <div className="font-mono text-[12px] text-slate-600 dark:text-slate-400 shrink-0">
                      {formatDateTime(h.detectedAt, settings.timezone, settings.dateFormat)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'source' && (
            <div className="space-y-2">
              <p className="text-[13px] text-slate-600 dark:text-slate-400">
                Captured page text from the most recent successful read (only this plain text is ever sent to the AI):
              </p>
              <pre className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[13px] font-mono whitespace-pre-wrap break-words max-h-[50vh] overflow-y-auto text-slate-800 dark:text-slate-200">
                {paper.lastSourceText || 'No captured source text yet (manual entry or not read yet).'}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 4. Ambiguous Paper Identity Modal                                          */
/* -------------------------------------------------------------------------- */
export const AmbiguousIdentityModal: React.FC<{
  prompt: AmbiguousMatchPrompt;
  onResolve: (choice: { action: 'link' | 'new'; targetPaperId?: string; remember: boolean }) => void;
}> = ({ prompt, onResolve }) => {
  const [selectedId, setSelectedId] = useState<string>(prompt.candidates[0]?.id || '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-lg w-full p-5 shadow-xl space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-[17px] font-semibold text-slate-900 dark:text-slate-100">
              Confirm paper identity
            </h2>
            <p className="text-[14px] text-slate-600 dark:text-slate-300 mt-1">
              We found a paper that could match more than one existing record. We never merge silently—choose how to handle this paper and we’ll remember your answer.
            </p>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[13px]">
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            Incoming: {prompt.extracted.title || 'Untitled'}
          </div>
          <div className="text-slate-600 dark:text-slate-400 mt-0.5">
            {prompt.extracted.journalName} · {prompt.extracted.manuscriptNumber || 'No MS #'} · {prompt.extracted.currentStatus}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
            Match to existing paper:
          </p>
          {prompt.candidates.map((c) => (
            <label
              key={c.id}
              className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
            >
              <input
                type="radio"
                name="ambiguousTarget"
                checked={selectedId === c.id}
                onChange={() => setSelectedId(c.id)}
                className="mt-1"
              />
              <div className="text-[13px]">
                <div className="font-semibold text-slate-900 dark:text-slate-100">{c.title}</div>
                <div className="text-slate-500 dark:text-slate-400">
                  {c.journalName} · {c.manuscriptNumber || 'No MS #'} · {c.currentStatus}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={() => onResolve({ action: 'new', remember: true })}
            className="px-4 py-2 text-[14px] font-medium bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            Add as separate new paper
          </button>
          <button
            type="button"
            onClick={() => onResolve({ action: 'link', targetPaperId: selectedId, remember: true })}
            className="px-4 py-2 text-[14px] font-medium text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-500"
          >
            Update selected paper
          </button>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 5. Delete Confirmation & Recently Deleted 30-day Drawer                    */
/* -------------------------------------------------------------------------- */
export const DeleteConfirmModal: React.FC<{
  paper: PaperRecord;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ paper, onCancel, onConfirm }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 shadow-xl space-y-4">
      <h2 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
        Move paper to Recently deleted?
      </h2>
      <p className="text-[14px] text-slate-600 dark:text-slate-300">
        <strong>{paper.title}</strong> ({paper.journalName}) and its change history will be kept in Recently deleted for 30 days so you can restore it anytime.
      </p>
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-[14px] font-medium bg-slate-100 dark:bg-slate-800 rounded-lg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="px-4 py-2 text-[14px] font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
        >
          Delete paper
        </button>
      </div>
    </div>
  </div>
);

export const RecentlyDeletedModal: React.FC<{
  deletedPapers: DeletedPaperRecord[];
  settings: DashboardSettings;
  onClose: () => void;
  onRestore: (paperId: string) => void;
  onPermanentDelete: (paperId: string) => void;
}> = ({ deletedPapers, settings, onClose, onRestore, onPermanentDelete }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-xl">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
            Recently deleted (kept 30 days)
          </h2>
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            Restoring a paper also restores its full status change history.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="overflow-y-auto p-5 space-y-2.5">
        {deletedPapers.length === 0 ? (
          <p className="text-[14px] text-slate-500 dark:text-slate-400 py-4 text-center">
            Recently deleted is empty.
          </p>
        ) : (
          deletedPapers.map((item) => (
            <div
              key={item.paper.id}
              className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {item.paper.title}
                </div>
                <div className="text-[13px] text-slate-500 dark:text-slate-400">
                  {item.paper.journalName} · Deleted {formatDateTime(item.deletedAt, settings.timezone, settings.dateFormat)} · {item.history.length} history entries
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onRestore(item.paper.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium bg-slate-900 dark:bg-blue-600 text-white rounded-md"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Restore
                </button>
                <button
                  type="button"
                  onClick={() => onPermanentDelete(item.paper.id)}
                  title="Remove permanently"
                  className="p-1.5 rounded text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  </div>
);
