import React from 'react';
import { RefreshCw, X } from 'lucide-react';
import type { AiProviderOption } from '../types';

export type ActiveTab = 'papers' | 'history' | 'setup' | 'settings';

export const AI_AGENT_OPTIONS: Array<{ value: AiProviderOption; label: string }> = [
  { value: 'auto_free', label: 'Smart Local + Free Open AI' },
  { value: 'local_reader', label: 'Built-in Local Reader (Offline)' },
  { value: 'pollinations', label: 'Free Open AI (Pollinations)' },
  { value: 'ollama', label: 'Local Ollama' },
  { value: 'gemini', label: 'Gemini AI (Google)' },
];

interface TopBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  unseenCount: number;
  failedEmailCount: number;
  isRefreshingAll: boolean;
  refreshProgress: { done: number; total: number };
  onRefreshAll: () => void;
  onCancelRefreshAll: () => void;
  hasPapers: boolean;
  aiProvider: AiProviderOption;
  onChangeAiProvider: (provider: AiProviderOption) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  unseenCount,
  failedEmailCount,
  isRefreshingAll,
  refreshProgress,
  onRefreshAll,
  onCancelRefreshAll,
  hasPapers,
  aiProvider,
  onChangeAiProvider,
}) => {
  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: 'papers', label: unseenCount > 0 ? `Papers (${unseenCount} new)` : 'Papers' },
    {
      id: 'history',
      label: failedEmailCount > 0 ? `History & Alerts (${failedEmailCount})` : 'History & Alerts',
    },
    { id: 'setup', label: 'Setup & Extension' },
    { id: 'settings', label: 'Settings' },
  ];

  const statusLegend = [
    { label: 'Submitted / With Editor', color: '#2563EB' },
    { label: 'Under Review', color: '#D97706' },
    { label: 'Revision Requested', color: '#EA580C' },
    { label: 'Accepted', color: '#16A34A' },
    { label: 'Rejected', color: '#DC2626' },
  ];

  return (
    <header className="flex flex-col bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
      <div className="flex items-center justify-between gap-4 px-6 py-3">
        <button
          type="button"
          onClick={() => onSelectTab('papers')}
          className="text-[19px] font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
        >
          Journal Paper Dashboard
        </button>

        <nav className="flex items-center gap-6 overflow-x-auto" aria-label="Primary navigation">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-1 text-[15px] font-medium whitespace-nowrap shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded ${
                  isActive
                    ? 'text-blue-700 dark:text-blue-400 underline underline-offset-8 decoration-2'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="hidden md:flex items-center gap-1.5">
            <label
              htmlFor="topbar-ai-agent"
              className="text-[12px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap"
            >
              AI agent:
            </label>
            <select
              id="topbar-ai-agent"
              aria-label="Select AI agent"
              value={aiProvider}
              onChange={(e) => onChangeAiProvider(e.target.value as AiProviderOption)}
              className="px-2.5 py-1.5 text-[13px] font-medium bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {AI_AGENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {isRefreshingAll ? (
            <button
              type="button"
              onClick={onCancelRefreshAll}
              className="inline-flex items-center gap-2 px-4 py-2 text-[14px] font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            >
              <X className="w-4 h-4" />
              <span>
                Cancel ({refreshProgress.done}/{refreshProgress.total})
              </span>
            </button>
          ) : (
            <button
              type="button"
              disabled={!hasPapers}
              onClick={onRefreshAll}
              className="inline-flex items-center gap-2 px-4 py-2 text-[14px] font-medium text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 disabled:opacity-45 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Refresh all</span>
            </button>
          )}
        </div>
      </div>

      {/* Status Legend Box */}
      <div className="flex items-center gap-x-4 gap-y-1.5 px-6 py-2 bg-slate-50 dark:bg-slate-950/70 border-t border-slate-200 dark:border-slate-800 text-[12px] font-medium text-slate-600 dark:text-slate-400 overflow-x-auto shrink-0">
        <span className="font-semibold text-slate-700 dark:text-slate-300 shrink-0">Status Legend:</span>
        <div className="flex items-center gap-4 flex-wrap">
          {statusLegend.map((leg) => (
            <div key={leg.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: leg.color }}
                aria-hidden="true"
              />
              <span className="text-slate-700 dark:text-slate-300">{leg.label}</span>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
};
