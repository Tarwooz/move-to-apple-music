'use client';

import { useState } from 'react';
import { TrackMatch, AppleMusicTrack, MatchStatus } from '@/lib/types';

const STATUS_DOT: Record<MatchStatus, string> = {
  matched: 'bg-emerald-400',
  uncertain: 'bg-amber-400',
  failed: 'bg-red-400',
  manual: 'bg-blue-400',
  skipped: 'bg-gray-300',
};

const STATUS_LABEL: Record<MatchStatus, string> = {
  matched: '已匹配',
  uncertain: '待确认',
  failed: '未找到',
  manual: '手动',
  skipped: '已跳过',
};

function stripBrackets(title: string): string {
  return title.replace(/[\(（][^)）]*[\)）]/g, '').trim();
}

interface Props {
  match: TrackMatch;
  index: number;
  onSelectCandidate: (matchId: string, candidate: AppleMusicTrack | null) => void;
  onSkip: (matchId: string) => void;
  onManualSearch: (matchId: string, query: string) => Promise<void>;
}

export default function TrackRow({ match, index, onSelectCandidate, onSkip, onManualSearch }: Props) {
  const { source, status, candidates, selectedCandidate, aiSuggestion } = match;
  const [searching, setSearching] = useState(false);
  const [useTitle, setUseTitle] = useState(true);
  const [useArtist, setUseArtist] = useState(true);
  const [manualQuery, setManualQuery] = useState('');

  const autoQuery = [
    useTitle ? stripBrackets(source.title) : '',
    useArtist ? source.artist : '',
  ].filter(Boolean).join(' ');

  const effectiveQuery = manualQuery || autoQuery;

  const handleSearch = async () => {
    if (!effectiveQuery.trim()) return;
    setSearching(true);
    await onManualSearch(match.id, effectiveQuery.trim());
    setSearching(false);
  };

  const isSkipped = status === 'skipped';
  const isUncertain = status === 'uncertain';

  return (
    <tr className={`group border-b border-[#F0F0F5] transition-colors hover:bg-[#FAFAFA] ${isSkipped ? 'opacity-40' : ''}`}>
      {/* # */}
      <td className="py-3 pl-5 pr-2 text-xs text-[#AEAEB2] tabular-nums">{index + 1}</td>

      {/* Source */}
      <td className="py-3 pr-4">
        <div className="text-[13px] font-medium text-[#1D1D1F] leading-snug truncate">{source.title}</div>
        <div className="text-[11px] text-[#6E6E73] truncate mt-0.5">{source.artist}</div>
      </td>

      {/* Status */}
      <td className="py-3 pr-4 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[status]}`} />
          <span className="text-[11px] text-[#6E6E73]">{STATUS_LABEL[status]}</span>
        </div>
        {isUncertain && selectedCandidate && (
          <button
            onClick={() => onSelectCandidate(match.id, selectedCandidate)}
            className="mt-1 text-[10px] px-1.5 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-200 rounded-md font-medium transition-colors"
          >
            ✓ 确认
          </button>
        )}
        {aiSuggestion && (
          <div className="text-[10px] text-purple-400 mt-0.5 truncate" title={aiSuggestion}>AI 优化</div>
        )}
      </td>

      {/* Matched result */}
      <td className="py-3 pr-4">
        {selectedCandidate ? (
          <div className="flex items-center gap-2">
            {selectedCandidate.artworkUrl100 && (
              <img src={selectedCandidate.artworkUrl100} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0 shadow-sm" />
            )}
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-[#1D1D1F] truncate leading-snug">{selectedCandidate.trackName}</div>
              <div className="text-[11px] text-[#6E6E73] truncate mt-0.5">{selectedCandidate.artistName}</div>
            </div>
          </div>
        ) : (
          <span className="text-[12px] text-[#AEAEB2]">—</span>
        )}
      </td>

      {/* Actions */}
      <td className="py-3 pr-5">
        <div className="flex flex-col gap-1.5">
          {/* Token chips: title + artist */}
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => { setUseTitle(!useTitle); setManualQuery(''); }}
              className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors truncate max-w-[120px] ${
                useTitle
                  ? 'bg-[#FA2D55] border-[#FA2D55] text-white'
                  : 'bg-white border-[#D1D1D6] text-[#AEAEB2] line-through'
              }`}
              title={stripBrackets(source.title)}
            >
              {stripBrackets(source.title)}
            </button>
            <button
              onClick={() => { setUseArtist(!useArtist); setManualQuery(''); }}
              className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors truncate max-w-[100px] ${
                useArtist
                  ? 'bg-[#1D1D1F] border-[#1D1D1F] text-white'
                  : 'bg-white border-[#D1D1D6] text-[#AEAEB2] line-through'
              }`}
              title={source.artist}
            >
              {source.artist}
            </button>
          </div>

          {/* Search input row */}
          <div className="flex gap-1">
            <input
              value={manualQuery !== '' ? manualQuery : autoQuery}
              onChange={(e) => setManualQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1 min-w-0 text-[11px] text-[#1D1D1F] bg-[#F5F5F7] border border-[#E5E5EA] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#FA2D55] focus:border-[#FA2D55]"
              placeholder="搜索..."
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              className="text-[11px] px-2.5 py-1.5 bg-[#FA2D55] hover:bg-[#E0264C] disabled:opacity-50 text-white rounded-lg font-medium flex-shrink-0 transition-colors"
            >
              {searching ? '…' : '搜'}
            </button>
            <button
              onClick={() => onSkip(match.id)}
              className={`text-[11px] px-2.5 py-1.5 rounded-lg font-medium flex-shrink-0 transition-colors ${
                isSkipped
                  ? 'bg-[#E5E5EA] text-[#6E6E73] hover:bg-[#D8D8DD]'
                  : 'bg-[#F5F5F7] text-[#6E6E73] hover:bg-[#E5E5EA] border border-[#E5E5EA]'
              }`}
            >
              {isSkipped ? '恢复' : '跳过'}
            </button>
          </div>

          {/* Candidate select */}
          {candidates.length > 0 && (
            <select
              className="text-[11px] text-[#1D1D1F] bg-[#F5F5F7] border border-[#E5E5EA] rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-1 focus:ring-[#FA2D55] focus:border-[#FA2D55] cursor-pointer"
              value={selectedCandidate?.trackId ?? ''}
              onChange={(e) => {
                const c = candidates.find((c) => String(c.trackId) === e.target.value);
                onSelectCandidate(match.id, c ?? null);
              }}
            >
              <option value="">— 切换候选 —</option>
              {candidates.map((c) => (
                <option key={c.trackId} value={c.trackId}>
                  {c.trackName} · {c.artistName}
                </option>
              ))}
            </select>
          )}
        </div>
      </td>
    </tr>
  );
}
