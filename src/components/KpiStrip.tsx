import React from 'react';
import type { DashboardSettings, PaperRecord, StatusGroupKey } from '../types';
import { formatRelativeTime, getEffectivePaperHealth, resolveStatusGroup } from '../utils/paperLogic';

export type KpiFilter =
  | 'all'
  | 'submitted_editor'
  | 'under_review'
  | 'revision_requested'
  | 'accepted'
  | 'rejected'
  | 'changed'
  | 'problems';

interface KpiStripProps {
  papers: PaperRecord[];
  settings: DashboardSettings;
  activeFilter: KpiFilter;
  onSelectFilter: (filter: KpiFilter) => void;
}

export const KpiStrip: React.FC<KpiStripProps> = ({
  papers,
  settings,
  activeFilter,
  onSelectFilter,
}) => {
  const counts: Record<StatusGroupKey, number> = {
    submitted_editor: 0,
    under_review: 0,
    revision_requested: 0,
    accepted: 0,
    rejected: 0,
    unknown: 0,
  };

  let changedCount = 0;
  let problemCount = 0;
  let latestCheckIso: string | null = null;

  for (const p of papers) {
    const group = resolveStatusGroup(p.currentStatus, settings);
    counts[group.key]++;
    if (p.hasUnseenChange) changedCount++;
    const effectiveHealth = getEffectivePaperHealth(p);
    if (effectiveHealth !== 'OK' && effectiveHealth !== 'Paused') problemCount++;
    if (p.lastCheckedAt) {
      if (!latestCheckIso || new Date(p.lastCheckedAt) > new Date(latestCheckIso)) {
        latestCheckIso = p.lastCheckedAt;
      }
    }
  }

  const items: Array<{
    id: KpiFilter | 'last_check';
    label: string;
    value: string | number;
    accent?: string;
    clickable: boolean;
  }> = [
    { id: 'all', label: 'Total papers', value: papers.length, clickable: true },
    {
      id: 'submitted_editor',
      label: 'With editor',
      value: counts.submitted_editor,
      accent: 'text-blue-700 dark:text-blue-400',
      clickable: true,
    },
    {
      id: 'under_review',
      label: 'Under review',
      value: counts.under_review,
      accent: 'text-amber-700 dark:text-amber-400',
      clickable: true,
    },
    {
      id: 'revision_requested',
      label: 'Revision needed',
      value: counts.revision_requested,
      accent: 'text-orange-700 dark:text-orange-400',
      clickable: true,
    },
    {
      id: 'accepted',
      label: 'Accepted',
      value: counts.accepted,
      accent: 'text-emerald-700 dark:text-emerald-400',
      clickable: true,
    },
    {
      id: 'rejected',
      label: 'Rejected',
      value: counts.rejected,
      accent: 'text-rose-700 dark:text-rose-400',
      clickable: true,
    },
    {
      id: 'changed',
      label: 'Changed since seen',
      value: changedCount,
      accent: changedCount > 0 ? 'text-indigo-700 dark:text-indigo-400' : undefined,
      clickable: true,
    },
    {
      id: 'last_check',
      label: 'Last check',
      value: formatRelativeTime(latestCheckIso),
      clickable: false,
    },
    {
      id: 'problems',
      label: 'Problems',
      value: problemCount,
      accent: problemCount > 0 ? 'text-rose-700 dark:text-rose-400' : undefined,
      clickable: true,
    },
  ];

  return (
    <section
      aria-label="Key paper metrics"
      className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 shrink-0"
    >
      {items.map((item) => {
        const isActive = item.clickable && activeFilter === item.id;
        if (!item.clickable) {
          return (
            <div key={item.id} className="px-3.5 py-2.5 flex flex-col justify-between">
              <span className="text-[13px] font-medium text-slate-500 dark:text-slate-400 truncate">
                {item.label}
              </span>
              <span className="mt-1 text-[17px] font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 truncate">
                {item.value}
              </span>
            </div>
          );
        }

        return (
          <button
            key={item.id}
            type="button"
            onClick={() =>
              onSelectFilter(
                isActive && item.id !== 'all' ? 'all' : (item.id as KpiFilter)
              )
            }
            className={`px-3.5 py-2.5 text-left flex flex-col justify-between transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
              isActive
                ? item.id === 'all'
                  ? 'bg-slate-100/90 dark:bg-slate-800/80'
                  : 'bg-blue-50/75 dark:bg-blue-950/35 ring-1 ring-inset ring-blue-600/30 dark:ring-blue-500/40'
                : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
            }`}
          >
            <span className="text-[13px] font-medium text-slate-600 dark:text-slate-400 truncate">
              {item.label}
            </span>
            <span
              className={`mt-1 text-[21px] leading-tight font-semibold font-mono tabular-nums ${
                item.accent || 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {item.value}
            </span>
          </button>
        );
      })}
    </section>
  );
};
