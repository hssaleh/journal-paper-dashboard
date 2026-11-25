import React from 'react';
import type { DashboardSettings, PaperRecord, StatusGroupKey } from '../types';
import { computeDaysInStatus, resolveStatusGroup } from '../utils/paperLogic';
import type { KpiFilter } from './KpiStrip';

interface AnalyticsGraphsProps {
  papers: PaperRecord[];
  settings: DashboardSettings;
  activeKpiFilter?: KpiFilter;
  activeJournalFilter?: string;
  onSelectStatusFilter?: (filter: KpiFilter) => void;
  onSelectJournalFilter?: (journal: string) => void;
}

export const AnalyticsGraphs: React.FC<AnalyticsGraphsProps> = ({
  papers,
  settings,
  activeKpiFilter = 'all',
  activeJournalFilter = 'all',
  onSelectStatusFilter,
  onSelectJournalFilter,
}) => {
  // 1. Papers by Status Group
  const statusMap = new Map<
    StatusGroupKey,
    { key: StatusGroupKey; label: string; color: string; count: number; totalDays: number }
  >();
  for (const g of settings.statusGroups) {
    statusMap.set(g.key, { key: g.key, label: g.label, color: g.color, count: 0, totalDays: 0 });
  }
  for (const p of papers) {
    const group = resolveStatusGroup(p.currentStatus, settings);
    const entry = statusMap.get(group.key);
    if (entry) {
      entry.count++;
      entry.totalDays += computeDaysInStatus(p).days;
    }
  }
  const statusData = Array.from(statusMap.values()).filter((d) => d.count > 0);
  const maxStatusCount = Math.max(1, ...statusData.map((d) => d.count));

  // 2. Papers by Journal (top 5)
  const journalCounts = new Map<string, number>();
  for (const p of papers) {
    const j = p.journalName || 'Unknown Journal';
    journalCounts.set(j, (journalCounts.get(j) || 0) + 1);
  }
  const journalData = Array.from(journalCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxJournalCount = Math.max(1, ...journalData.map(([, c]) => c));

  // 3. Submissions Over Time (by YYYY-MM)
  const monthCounts = new Map<string, number>();
  for (const p of papers) {
    const d = p.submissionDate;
    if (d && /^\d{4}-\d{2}/.test(d)) {
      const ym = d.slice(0, 7);
      monthCounts.set(ym, (monthCounts.get(ym) || 0) + 1);
    }
  }
  const monthData = Array.from(monthCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8);
  const maxMonthCount = Math.max(1, ...monthData.map(([, c]) => c));

  // 4. Average Days in Each Status
  const avgDaysData = statusData.map((d) => ({
    label: d.label,
    color: d.color,
    avgDays: Math.round(d.totalDays / Math.max(1, d.count)),
  }));
  const maxAvgDays = Math.max(1, ...avgDaysData.map((d) => d.avgDays));

  return (
    <section
      aria-label="Manuscript analytics graphs"
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 shrink-0 items-stretch"
    >
      {/* Chart 1: Papers by status (interactive filter) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 flex flex-col">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <h3 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">
            Papers by status
          </h3>
          {activeKpiFilter !== 'all' && onSelectStatusFilter && (
            <button
              type="button"
              onClick={() => onSelectStatusFilter('all')}
              className="text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:underline"
            >
              Reset
            </button>
          )}
        </div>
        {statusData.length === 0 ? (
          <p className="text-[13px] text-slate-500 dark:text-slate-400 py-3">No papers added yet.</p>
        ) : (
          <div className="space-y-1.5">
            {statusData.map((row) => {
              const filterable = row.key !== 'unknown' && Boolean(onSelectStatusFilter);
              const isSelected = filterable && activeKpiFilter === row.key;
              if (!filterable) {
                return (
                  <div key={row.key} className="space-y-1 px-1 py-0.5 rounded">
                    <div className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="text-slate-700 dark:text-slate-300 truncate">{row.label}</span>
                      <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {row.count}
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                      <div
                        className="h-full rounded transition-all"
                        style={{
                          width: `${(row.count / maxStatusCount) * 100}%`,
                          backgroundColor: row.color,
                        }}
                      />
                    </div>
                  </div>
                );
              }
              return (
                <button
                  key={row.key}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() =>
                    onSelectStatusFilter?.(isSelected ? 'all' : (row.key as KpiFilter))
                  }
                  title={`Filter table by ${row.label}`}
                  className={`w-full text-left space-y-1 px-1.5 py-0.5 -mx-1.5 rounded transition-colors ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-950/40 ring-1 ring-blue-600/30'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="text-slate-700 dark:text-slate-300 truncate">{row.label}</span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {row.count}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                    <div
                      className="h-full rounded transition-all"
                      style={{
                        width: `${(row.count / maxStatusCount) * 100}%`,
                        backgroundColor: row.color,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Chart 2: Papers by journal (interactive filter) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 flex flex-col">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <h3 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">
            Papers by journal
          </h3>
          {activeJournalFilter !== 'all' && onSelectJournalFilter && (
            <button
              type="button"
              onClick={() => onSelectJournalFilter('all')}
              className="text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:underline"
            >
              Reset
            </button>
          )}
        </div>
        {journalData.length === 0 ? (
          <p className="text-[13px] text-slate-500 dark:text-slate-400 py-3">No journals recorded.</p>
        ) : (
          <div className="space-y-1.5">
            {journalData.map(([journal, count]) => {
              const isSelected = activeJournalFilter === journal;
              return (
                <button
                  key={journal}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() =>
                    onSelectJournalFilter?.(isSelected ? 'all' : journal)
                  }
                  title={`Filter table by ${journal}`}
                  className={`w-full text-left space-y-1 px-1.5 py-0.5 -mx-1.5 rounded transition-colors ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-950/40 ring-1 ring-blue-600/30'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="text-slate-700 dark:text-slate-300 truncate" title={journal}>
                      {journal}
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {count}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                    <div
                      className={`h-full rounded transition-all ${
                        isSelected
                          ? 'bg-blue-600 dark:bg-blue-400'
                          : 'bg-slate-700 dark:bg-slate-400'
                      }`}
                      style={{ width: `${(count / maxJournalCount) * 100}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Chart 3: Submissions over time */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 flex flex-col justify-between">
        <h3 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 mb-2.5">
          Submissions over time
        </h3>
        {monthData.length === 0 ? (
          <p className="text-[13px] text-slate-500 dark:text-slate-400 py-3">
            No submission dates available.
          </p>
        ) : (
          <div className="flex items-end gap-2 h-24 pt-2">
            {monthData.map(([ym, count]) => {
              const heightPct = Math.max(14, Math.round((count / maxMonthCount) * 100));
              return (
                <div key={ym} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
                  <span className="text-[12px] font-mono tabular-nums text-slate-700 dark:text-slate-300 mb-1">
                    {count}
                  </span>
                  <div
                    className="w-full max-w-[28px] bg-blue-600 dark:bg-blue-500 rounded-t transition-all"
                    style={{ height: `${heightPct}%` }}
                    title={`${ym}: ${count} submission(s)`}
                  />
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 truncate w-full text-center">
                    {ym.slice(2)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Chart 4: Average days in each status */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 flex flex-col">
        <h3 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 mb-2.5">
          Average days in status
        </h3>
        {avgDaysData.length === 0 ? (
          <p className="text-[13px] text-slate-500 dark:text-slate-400 py-3">No status durations yet.</p>
        ) : (
          <div className="space-y-2">
            {avgDaysData.map((row) => (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="text-slate-700 dark:text-slate-300 truncate">{row.label}</span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                    {row.avgDays}d
                  </span>
                </div>
                <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                  <div
                    className="h-full rounded transition-all"
                    style={{
                      width: `${Math.max(6, (row.avgDays / maxAvgDays) * 100)}%`,
                      backgroundColor: row.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
