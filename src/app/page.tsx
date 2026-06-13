'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { TrackMatch, Playlist, AppleMusicTrack, SourceTrack, MatchStatus } from '@/lib/types';
import TrackRow from '@/components/TrackRow';

type Step = 'input' | 'searching' | 'preview';
type Tab = 'import' | 'merge' | 'help';
type MusicPlaylist = { name: string; trackCount: number };

const SEARCH_BATCH = 5;  // matches server CONCURRENCY — keeps each API call under 2s
const AI_BATCH = 20;
const CSV_CHUNK = 200;
const batchDelay = () => 5000 + Math.random() * 2000; // 5–7s random delay

// ── localStorage cache helpers ────────────────────────────────────────────────
const LS_CACHE = 'am-cache-v1';
const LS_SKIPPED = 'am-skipped-v1';

type SlimCandidate = Pick<AppleMusicTrack, 'trackId' | 'trackName' | 'artistName' | 'collectionName' | 'artworkUrl100'>;
type CacheEntry = { source: SourceTrack; status: MatchStatus; selectedCandidate: SlimCandidate | null };

function lsKey(title: string, artist: string) {
  return `${title.trim().toLowerCase()}|||${artist.trim().toLowerCase()}`;
}

function slimCandidate(c: AppleMusicTrack): SlimCandidate {
  return { trackId: c.trackId, trackName: c.trackName, artistName: c.artistName, collectionName: c.collectionName, artworkUrl100: c.artworkUrl100 };
}

function loadLSCache(): Map<string, CacheEntry> {
  try {
    const raw = localStorage.getItem(LS_CACHE);
    if (!raw) return new Map();
    return new Map((JSON.parse(raw) as CacheEntry[]).map((m) => [lsKey(m.source.title, m.source.artist), m]));
  } catch { return new Map(); }
}

function mergeLSCache(matches: TrackMatch[]) {
  try {
    const map = loadLSCache();
    for (const m of matches) {
      map.set(lsKey(m.source.title, m.source.artist), {
        source: m.source,
        status: m.status,
        selectedCandidate: m.selectedCandidate ? slimCandidate(m.selectedCandidate) : null,
      });
    }
    localStorage.setItem(LS_CACHE, JSON.stringify(Array.from(map.values())));
  } catch {}
}

function loadLSSkippedKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_SKIPPED);
    if (!raw) return new Set();
    return new Set((JSON.parse(raw) as SourceTrack[]).map((t) => lsKey(t.title, t.artist)));
  } catch { return new Set(); }
}

function saveLSSkipped(tracks: SourceTrack[]) {
  try { localStorage.setItem(LS_SKIPPED, JSON.stringify(tracks)); } catch {}
}

export default function Home() {
  // ── import tab state ──────────────────────────────────────────────
  const [step, setStep] = useState<Step>('input');
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [matches, setMatches] = useState<TrackMatch[]>([]);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const [playlistName, setPlaylistName] = useState('');
  const [aiRunning, setAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState({ done: 0, total: 0 });
  const [retrying, setRetrying] = useState(false);
  const [retryProgress, setRetryProgress] = useState({ done: 0, total: 0 });
  const [textModal, setTextModal] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  // ── filter + retry/ai popovers ────────────────────────────────────
  const [filterStatus, setFilterStatus] = useState<MatchStatus | 'all'>('all');
  const [retryPopoverOpen, setRetryPopoverOpen] = useState(false);
  const [retryIncUncertain, setRetryIncUncertain] = useState(false);
  const [retryIncFailed, setRetryIncFailed] = useState(true);
  const retryPopoverRef = useRef<HTMLDivElement>(null);
  const [aiPopoverOpen, setAiPopoverOpen] = useState(false);
  const [aiIncUncertain, setAiIncUncertain] = useState(false);
  const [aiIncFailed, setAiIncFailed] = useState(true);
  const aiPopoverRef = useRef<HTMLDivElement>(null);

  // ── merge tab state ───────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('import');
  const [musicPlaylists, setMusicPlaylists] = useState<MusicPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<string[]>([]);
  const [mergeTarget, setMergeTarget] = useState('合并歌单');
  const [mergeRunning, setMergeRunning] = useState(false);
  const [mergeResult, setMergeResult] = useState('');
  const [mergeError, setMergeError] = useState('');

  // ── auto-save to localStorage (debounced, synchronous) ───────────
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!matches.length) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      mergeLSCache(matches.filter((m) => m.selectedCandidate && m.status !== 'skipped'));
      saveLSSkipped(matches.filter((m) => m.status === 'skipped').map((m) => m.source));
    }, 1500);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [matches]);

  // Close popovers on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (retryPopoverRef.current && !retryPopoverRef.current.contains(e.target as Node)) setRetryPopoverOpen(false);
      if (aiPopoverRef.current && !aiPopoverRef.current.contains(e.target as Node)) setAiPopoverOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── import logic ──────────────────────────────────────────────────
  const fetchPlaylist = useCallback(async () => {
    setError('');
    setProgress({ done: 0, total: 0, label: '正在获取歌单...' });
    setStep('searching');
    try {
      const res = await fetch('/api/fetch-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: playlistUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const pl: Playlist = data.playlist;
      setPlaylist(pl);
      setPlaylistName(pl.name || '迁移到appleMusic');
      setProgress({ done: 0, total: pl.tracks.length, label: '正在搜索 Apple Music...' });

      const cache = loadLSCache();
      const skippedKeys = loadLSSkippedKeys();
      const allMatches: TrackMatch[] = [];

      for (let i = 0; i < pl.tracks.length; i += SEARCH_BATCH) {
        const batch = pl.tracks.slice(i, i + SEARCH_BATCH);

        // Resolve cache / skipped hits locally
        const cacheHits = batch.map((track): TrackMatch | null => {
          const key = lsKey(track.title, track.artist);
          if (skippedKeys.has(key)) {
            return { id: crypto.randomUUID(), source: track, status: 'skipped', candidates: [], selectedCandidate: null };
          }
          const cached = cache.get(key);
          return cached ? { ...cached, id: crypto.randomUUID(), candidates: [] } : null;
        });

        const uncached = batch.filter((_, j) => !cacheHits[j]);

        let apiResults: TrackMatch[] = [];
        if (uncached.length) {
          if (allMatches.length > 0) await new Promise((r) => setTimeout(r, batchDelay()));

          const res2 = await fetch('/api/search-apple', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracks: uncached }),
          });
          const data2 = await res2.json();
          if (!res2.ok) throw new Error(data2.error);
          apiResults = data2.matches;
          mergeLSCache(apiResults.filter((m) => m.selectedCandidate));
        }

        // Interleave cache hits and API results in original order
        let apiIdx = 0;
        const batchResults = batch.map((_, j) => cacheHits[j] ?? apiResults[apiIdx++]);
        allMatches.push(...batchResults);

        setMatches([...allMatches]);
        setProgress({ done: Math.min(i + SEARCH_BATCH, pl.tracks.length), total: pl.tracks.length, label: '正在搜索 Apple Music...' });
      }

      setStep('preview');
    } catch (e: any) {
      setError(e.message);
      setStep('input');
    }
  }, [playlistUrl]);

  const runAiAssist = useCallback(async (statuses: MatchStatus[]) => {
    if (!deepseekKey) { setError('请先输入 DeepSeek API Key'); return; }
    setAiRunning(true);
    setError('');
    const failedMatches = matches.filter((m) => statuses.includes(m.status));
    setAiProgress({ done: 0, total: failedMatches.length });
    try {
      const warnings: string[] = [];
      for (let i = 0; i < failedMatches.length; i += AI_BATCH) {
        const batch = failedMatches.slice(i, i + AI_BATCH);
        const res = await fetch('/api/ai-assist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matches: batch, apiKey: deepseekKey }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (data.warnings) warnings.push(...data.warnings);
        setAiProgress({ done: Math.min(i + AI_BATCH, failedMatches.length), total: failedMatches.length });
        mergeLSCache((data.improved ?? []).filter((u: any) => u.updated && u.selectedCandidate));
        setMatches((prev) =>
          prev.map((m) => {
            const upd = (data.improved ?? []).find((u: any) => u.id === m.id);
            if (!upd || !upd.updated) return m;
            return { ...m, status: upd.status, selectedCandidate: upd.selectedCandidate ?? m.selectedCandidate, candidates: upd.candidates?.length ? upd.candidates : m.candidates, aiSuggestion: upd.aiSuggestion };
          })
        );
      }
      if (warnings.length) setError(warnings.join('\n'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAiRunning(false);
      setAiProgress({ done: 0, total: 0 });
    }
  }, [matches, deepseekKey]);

  const handleSelectCandidate = useCallback((matchId: string, candidate: AppleMusicTrack | null) => {
    setMatches((prev) => prev.map((m) => m.id === matchId ? { ...m, selectedCandidate: candidate, status: candidate ? 'manual' : 'failed' } : m));
  }, []);

  const handleSkip = useCallback((matchId: string) => {
    setMatches((prev) => prev.map((m) => m.id === matchId ? { ...m, status: m.status === 'skipped' ? 'failed' : 'skipped' } : m));
  }, []);

  const handleManualSearch = useCallback(async (matchId: string, query: string) => {
    const res = await fetch(`/api/manual-search?${new URLSearchParams({ q: query })}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.candidates?.length) {
      setMatches((prev) => prev.map((m) => m.id === matchId ? { ...m, candidates: data.candidates, selectedCandidate: data.candidates[0], status: 'manual' } : m));
    }
  }, []);

  const retrySearch = useCallback(async (statuses: MatchStatus[]) => {
    const toRetry = matches.filter((m) => statuses.includes(m.status));
    if (!toRetry.length) return;
    setRetrying(true);
    setError('');
    setRetryProgress({ done: 0, total: toRetry.length });
    try {
      for (let i = 0; i < toRetry.length; i += SEARCH_BATCH) {
        if (i > 0) await new Promise((r) => setTimeout(r, batchDelay()));
        const batch = toRetry.slice(i, i + SEARCH_BATCH);
        const res = await fetch('/api/search-apple', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: batch.map((m) => m.source), forceRefresh: true }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        mergeLSCache(data.matches);
        setMatches((prev) => {
          const next = [...prev];
          data.matches.forEach((newMatch: TrackMatch, j: number) => {
            const idx = prev.findIndex((m) => m.id === batch[j].id);
            if (idx !== -1) next[idx] = { ...newMatch, id: batch[j].id };
          });
          return next;
        });
        setRetryProgress({ done: Math.min(i + SEARCH_BATCH, toRetry.length), total: toRetry.length });
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRetrying(false);
      setRetryProgress({ done: 0, total: 0 });
    }
  }, [matches]);

  const exportList = useCallback((format: 'csv' | 'txt') => {
    const exportable = matches.filter((m) => m.status !== 'skipped' && m.selectedCandidate);
    const toExport = selectedIds.size > 0 ? exportable.filter((m) => selectedIds.has(m.id)) : exportable;
    const rows = toExport.map((m) => m.selectedCandidate!);
    if (!rows.length) { setError('没有可导出的歌曲'); return; }
    if (format === 'txt') {
      setCopied(false);
      setTextModal(rows.map((t) => `${t.trackName} - ${t.artistName}`).join('\n'));
      return;
    }
    const esc = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`;
    const header = 'Track name,Artist name,Album,ISRC,Apple Music – id';
    const seen = new Set<number>();
    const allLines = rows
      .filter((t) => { if (seen.has(t.trackId)) return false; seen.add(t.trackId); return true; })
      .map((t) => [t.trackName, t.artistName, t.collectionName, '', String(t.trackId)].map(esc).join(','));
    const base = playlistName || 'playlist';
    const totalParts = Math.ceil(allLines.length / CSV_CHUNK);
    for (let p = 0; p < totalParts; p++) {
      const chunk = allLines.slice(p * CSV_CHUNK, (p + 1) * CSV_CHUNK);
      const content = '﻿' + [header, ...chunk].join('\n');
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = totalParts > 1 ? `${base}-${p + 1}.csv` : `${base}.csv`;
      setTimeout(() => { a.click(); URL.revokeObjectURL(url); }, p * 300);
    }
  }, [matches, playlistName, selectedIds]);

  // ── merge logic ───────────────────────────────────────────────────
  const loadMusicPlaylists = useCallback(async () => {
    setPlaylistsLoading(true);
    setMergeError('');
    try {
      const res = await fetch('/api/list-playlists');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMusicPlaylists(data.playlists);
    } catch (e: any) {
      setMergeError(e.message);
    } finally {
      setPlaylistsLoading(false);
    }
  }, []);

  const toggleMergeSelect = useCallback((name: string) => {
    setMergeSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }, []);

  const moveItem = useCallback((index: number, dir: -1 | 1) => {
    setMergeSelected((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const runMerge = useCallback(async () => {
    if (!mergeSelected.length) return;
    setMergeRunning(true);
    setMergeResult('');
    setMergeError('');
    try {
      const res = await fetch('/api/merge-playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: mergeSelected, target: mergeTarget }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMergeResult(`已创建歌单「${mergeTarget}」，共 ${data.count} 首歌曲`);
      await loadMusicPlaylists();
    } catch (e: any) {
      setMergeError(e.message);
    } finally {
      setMergeRunning(false);
    }
  }, [mergeSelected, mergeTarget, loadMusicPlaylists]);

  // ── derived ───────────────────────────────────────────────────────
  const stats = {
    total: matches.length,
    matched: matches.filter((m) => m.status === 'matched' || m.status === 'manual').length,
    uncertain: matches.filter((m) => m.status === 'uncertain').length,
    failed: matches.filter((m) => m.status === 'failed').length,
    skipped: matches.filter((m) => m.status === 'skipped').length,
  };
  const visibleMatches = filterStatus === 'all' ? matches : matches.filter((m) => m.status === filterStatus);
  const toWriteCount = matches.filter((m) => m.status !== 'skipped' && m.selectedCandidate).length;
  const exportableVisible = visibleMatches.filter((m) => m.status !== 'skipped' && m.selectedCandidate);
  const allVisibleSelected = exportableVisible.length > 0 && exportableVisible.every((m) => selectedIds.has(m.id));
  const someVisibleSelected = exportableVisible.some((m) => selectedIds.has(m.id));
  const csvLabel = selectedIds.size > 0 ? `导出选中（${selectedIds.size} 首）` : `导出 CSV（${toWriteCount} 首）`;
  const progressPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const mergeTotalTracks = mergeSelected.reduce((sum, n) => {
    const pl = musicPlaylists.find((p) => p.name === n);
    return sum + (pl?.trackCount ?? 0);
  }, 0);

  return (
    <main className="min-h-screen bg-[#F5F5F7]">
      {/* Top nav */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-[#E5E5EA] sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-[#FA2D55]">
              <path d="M16 3H6C4.9 3 4 3.9 4 5v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" fill="currentColor" fillOpacity=".15"/>
              <path d="M13 7.5V12a2 2 0 11-1-1.73V8.5L9 9V13a2 2 0 11-1-1.73V8l5-1.5.5 1z" fill="currentColor"/>
            </svg>
            <span className="text-[13px] font-semibold text-[#1D1D1F] tracking-tight">歌单迁移</span>
          </div>
          <span className="text-[11px] text-[#AEAEB2]">网易云 / QQ 音乐 → Apple Music</span>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-10">

        {/* ── Tab switcher (only shown in input step) ── */}
        {step === 'input' && (
          <div className="flex justify-center mb-8">
            <div className="bg-white rounded-2xl p-1 flex gap-1 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              {([['import', '导入歌单'], ['merge', '合并歌单'], ['help', '使用说明']] as [Tab, string][]).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={`px-5 py-2 rounded-xl text-[13px] font-medium transition-colors ${
                    activeTab === t
                      ? 'bg-[#FA2D55] text-white shadow-sm'
                      : 'text-[#6E6E73] hover:text-[#1D1D1F]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════
            TAB: 导入歌单
        ══════════════════════════════════════════════ */}
        {(activeTab === 'import' || step !== 'input') && (
          <>
            {/* Input / Searching */}
            {(step === 'input' || step === 'searching') && (
              <div className="max-w-md mx-auto">
                <div className="text-center mb-8">
                  <h1 className="text-[28px] font-bold text-[#1D1D1F] tracking-tight leading-tight">导入你的歌单</h1>
                  <p className="text-[13px] text-[#6E6E73] mt-2">支持网易云音乐和 QQ 音乐公开歌单</p>
                </div>
                <div className="bg-white rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-6 space-y-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#6E6E73] uppercase tracking-wide mb-1.5">歌单链接</label>
                    <input
                      type="text"
                      value={playlistUrl}
                      onChange={(e) => setPlaylistUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && playlistUrl.trim() && step === 'input' && fetchPlaylist()}
                      placeholder="https://music.163.com/playlist?id=..."
                      className="w-full bg-[#F5F5F7] border border-transparent rounded-xl px-4 py-2.5 text-[14px] text-[#1D1D1F] placeholder-[#AEAEB2] focus:outline-none focus:border-[#FA2D55] focus:bg-white transition-all"
                      disabled={step === 'searching'}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#6E6E73] uppercase tracking-wide mb-1.5">
                      DeepSeek API Key
                      <span className="text-[10px] font-normal normal-case ml-1 text-[#AEAEB2]">可选，用于 AI 辅助匹配</span>
                    </label>
                    <input
                      type="password"
                      value={deepseekKey}
                      onChange={(e) => setDeepseekKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full bg-[#F5F5F7] border border-transparent rounded-xl px-4 py-2.5 text-[14px] text-[#1D1D1F] placeholder-[#AEAEB2] focus:outline-none focus:border-[#FA2D55] focus:bg-white transition-all"
                      disabled={step === 'searching'}
                    />
                  </div>
                  {error && <div className="text-[13px] text-[#FF3B30] bg-[#FFF0EF] rounded-xl px-4 py-3">{error}</div>}
                  {step === 'searching' ? (
                    <div className="pt-1 space-y-3">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="text-[#6E6E73]">{progress.label}</span>
                        {progress.total > 0 && <span className="text-[#AEAEB2] tabular-nums">{progress.done} / {progress.total}</span>}
                      </div>
                      <div className="w-full bg-[#E5E5EA] rounded-full h-1">
                        <div className="bg-[#FA2D55] h-1 rounded-full transition-all duration-500" style={{ width: progress.total > 0 ? `${progressPct}%` : '8%' }} />
                      </div>
                      {matches.length > 0 && <p className="text-[11px] text-[#AEAEB2] text-center">已加载 {matches.length} 首，继续搜索中...</p>}
                    </div>
                  ) : (
                    <button
                      onClick={fetchPlaylist}
                      disabled={!playlistUrl.trim()}
                      className="w-full bg-[#FA2D55] hover:bg-[#E0264C] active:bg-[#C02140] disabled:bg-[#E5E5EA] disabled:text-[#AEAEB2] text-white font-semibold py-3 rounded-xl text-[14px] transition-colors"
                    >
                      开始搜索
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Preview */}
            {step === 'preview' && playlist && (
              <div className="space-y-3">
                {/* Stats bar */}
                <div className="bg-white rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.06)] px-5 py-3.5 flex items-center gap-2 flex-wrap">
                  {/* Clickable filter pills */}
                  <button onClick={() => { setStep('input'); setMatches([]); setPlaylist(null); setFilterStatus('all'); setSelectedIds(new Set()); }} className="cursor-pointer text-[11px] text-[#AEAEB2] hover:text-[#6E6E73] transition-colors mr-1">← 重新输入</button>
                  <div className="w-px h-4 bg-[#E5E5EA]" />
                  <FilterPill label="共" value={stats.total} active={filterStatus === 'all'} onClick={() => setFilterStatus('all')} />
                  <div className="w-px h-4 bg-[#E5E5EA]" />
                  <FilterPill label="已匹配" value={stats.matched} color="text-emerald-500" active={filterStatus === 'matched' || filterStatus === 'manual'} onClick={() => setFilterStatus(filterStatus === 'matched' ? 'all' : 'matched')} />
                  <FilterPill label="待确认" value={stats.uncertain} color="text-amber-500" active={filterStatus === 'uncertain'} onClick={() => setFilterStatus(filterStatus === 'uncertain' ? 'all' : 'uncertain')} />
                  <FilterPill label="未找到" value={stats.failed} color="text-red-400" active={filterStatus === 'failed'} onClick={() => setFilterStatus(filterStatus === 'failed' ? 'all' : 'failed')} />
                  {stats.skipped > 0 && <FilterPill label="已跳过" value={stats.skipped} color="text-[#AEAEB2]" active={filterStatus === 'skipped'} onClick={() => setFilterStatus(filterStatus === 'skipped' ? 'all' : 'skipped')} />}

                  <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
                    <button
                      onClick={() => exportList('csv')}
                      disabled={toWriteCount === 0}
                      title="导出已匹配歌单为 CSV，可导入 Soundiiz 等支持官方 API 的迁移网站"
                      className="text-[12px] px-3.5 py-1.5 bg-[#007AFF] hover:bg-[#0066D6] disabled:bg-[#E5E5EA] disabled:text-[#AEAEB2] text-white rounded-xl font-medium transition-colors"
                    >
                      {csvLabel}
                    </button>
                    <button
                      onClick={() => exportList('txt')}
                      disabled={toWriteCount === 0}
                      className="text-[12px] px-3.5 py-1.5 bg-white border border-[#D1D1D6] hover:bg-[#F5F5F7] disabled:opacity-50 text-[#1D1D1F] rounded-xl font-medium transition-colors"
                    >
                      导出 TXT
                    </button>
                    <button
                      onClick={() => window.open('https://soundiiz.com/', '_blank', 'noopener')}
                      className="text-[12px] px-3.5 py-1.5 bg-[#1D1D1F] hover:bg-[#3A3A3C] text-white rounded-xl font-medium transition-colors"
                    >
                      打开 Soundiiz →
                    </button>

                    {/* Retry search with popover */}
                    {(stats.uncertain > 0 || stats.failed > 0) && (
                      <div className="relative" ref={retryPopoverRef}>
                        <button
                          onClick={() => setRetryPopoverOpen((o) => !o)}
                          disabled={retrying || aiRunning}
                          className="text-[12px] px-3.5 py-1.5 bg-[#1D1D1F] hover:bg-[#3A3A3C] disabled:bg-[#E5E5EA] disabled:text-[#AEAEB2] text-white rounded-xl font-medium transition-colors"
                        >
                          {retrying ? `重试中 ${retryProgress.done}/${retryProgress.total}...` : '重新搜索 ▾'}
                        </button>

                        {retryPopoverOpen && !retrying && (
                          <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-[#F0F0F5] p-3 z-30">
                            <p className="text-[11px] font-semibold text-[#6E6E73] uppercase tracking-wide mb-2">选择要重新搜索的状态</p>
                            <label className="flex items-center gap-2 py-1.5 cursor-pointer">
                              <input type="checkbox" checked={retryIncFailed} onChange={(e) => setRetryIncFailed(e.target.checked)} className="accent-[#FA2D55]" />
                              <span className="text-[13px] text-[#1D1D1F]">未找到</span>
                              <span className="ml-auto text-[11px] text-[#AEAEB2]">{stats.failed} 首</span>
                            </label>
                            <label className="flex items-center gap-2 py-1.5 cursor-pointer">
                              <input type="checkbox" checked={retryIncUncertain} onChange={(e) => setRetryIncUncertain(e.target.checked)} className="accent-[#FA2D55]" />
                              <span className="text-[13px] text-[#1D1D1F]">待确认</span>
                              <span className="ml-auto text-[11px] text-[#AEAEB2]">{stats.uncertain} 首</span>
                            </label>
                            <button
                              onClick={() => {
                                const statuses: MatchStatus[] = [];
                                if (retryIncFailed) statuses.push('failed');
                                if (retryIncUncertain) statuses.push('uncertain');
                                if (statuses.length) { retrySearch(statuses); setRetryPopoverOpen(false); }
                              }}
                              disabled={!retryIncFailed && !retryIncUncertain}
                              className="mt-2 w-full text-[12px] py-2 bg-[#1D1D1F] hover:bg-[#3A3A3C] disabled:bg-[#E5E5EA] disabled:text-[#AEAEB2] text-white rounded-xl font-medium transition-colors"
                            >
                              开始重新搜索
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {(stats.uncertain > 0 || stats.failed > 0) && (
                      <div className="relative" ref={aiPopoverRef}>
                        <button
                          onClick={() => setAiPopoverOpen((o) => !o)}
                          disabled={aiRunning || retrying || !deepseekKey}
                          title={!deepseekKey ? '请先输入 DeepSeek API Key' : ''}
                          className="cursor-pointer text-[12px] px-3.5 py-1.5 bg-[#7F56D9] hover:bg-[#6941C6] disabled:bg-[#E5E5EA] disabled:text-[#AEAEB2] text-white rounded-xl font-medium transition-colors"
                        >
                          {aiRunning ? `AI 搜索中 ${aiProgress.done}/${aiProgress.total}...` : 'AI 辅助搜索 ▾'}
                        </button>
                        {aiPopoverOpen && !aiRunning && (
                          <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-[#F0F0F5] p-3 z-30">
                            <p className="text-[11px] font-semibold text-[#6E6E73] uppercase tracking-wide mb-2">选择要 AI 搜索的状态</p>
                            <label className="flex items-center gap-2 py-1.5 cursor-pointer">
                              <input type="checkbox" checked={aiIncFailed} onChange={(e) => setAiIncFailed(e.target.checked)} className="accent-[#7F56D9]" />
                              <span className="text-[13px] text-[#1D1D1F]">未找到</span>
                              <span className="ml-auto text-[11px] text-[#AEAEB2]">{stats.failed} 首</span>
                            </label>
                            <label className="flex items-center gap-2 py-1.5 cursor-pointer">
                              <input type="checkbox" checked={aiIncUncertain} onChange={(e) => setAiIncUncertain(e.target.checked)} className="accent-[#7F56D9]" />
                              <span className="text-[13px] text-[#1D1D1F]">待确认</span>
                              <span className="ml-auto text-[11px] text-[#AEAEB2]">{stats.uncertain} 首</span>
                            </label>
                            <button
                              onClick={() => {
                                const statuses: MatchStatus[] = [];
                                if (aiIncFailed) statuses.push('failed');
                                if (aiIncUncertain) statuses.push('uncertain');
                                if (statuses.length) { runAiAssist(statuses); setAiPopoverOpen(false); }
                              }}
                              disabled={!aiIncFailed && !aiIncUncertain}
                              className="mt-2 w-full text-[12px] py-2 bg-[#7F56D9] hover:bg-[#6941C6] disabled:bg-[#E5E5EA] disabled:text-[#AEAEB2] text-white rounded-xl font-medium transition-colors cursor-pointer"
                            >
                              开始 AI 搜索
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {error && <div className="text-[13px] text-[#FF3B30] bg-white rounded-2xl px-5 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">{error}</div>}

                <div className="bg-white rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-x-auto">
                  <table className="w-full table-fixed">
                    <thead>
                      <tr className="border-b border-[#F0F0F5]">
                        <th className="py-2.5 pl-4 pr-2 w-8">
                          <input
                            type="checkbox"
                            className="cursor-pointer w-3.5 h-3.5 rounded accent-[#FA2D55]"
                            checked={allVisibleSelected}
                            ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                            onChange={() => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (allVisibleSelected) exportableVisible.forEach((m) => next.delete(m.id));
                                else exportableVisible.forEach((m) => next.add(m.id));
                                return next;
                              });
                            }}
                          />
                        </th>
                        <th className="py-2.5 pr-2 text-left w-10"><span className="text-[10px] font-semibold text-[#AEAEB2] uppercase tracking-wider">#</span></th>
                        <th className="py-2.5 pr-4 text-left w-36"><span className="text-[10px] font-semibold text-[#AEAEB2] uppercase tracking-wider">原始</span></th>
                        <th className="py-2.5 pr-4 text-left w-24"><span className="text-[10px] font-semibold text-[#AEAEB2] uppercase tracking-wider whitespace-nowrap">状态</span></th>
                        <th className="py-2.5 pr-4 text-left w-48"><span className="text-[10px] font-semibold text-[#AEAEB2] uppercase tracking-wider">Apple Music</span></th>
                        <th className="py-2.5 pr-5 text-left"><span className="text-[10px] font-semibold text-[#AEAEB2] uppercase tracking-wider">调整</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleMatches.map((match, i) => (
                        <TrackRow
                          key={match.id}
                          match={match}
                          index={i}
                          onSelectCandidate={handleSelectCandidate}
                          onSkip={handleSkip}
                          onManualSearch={handleManualSearch}
                          selected={selectedIds.has(match.id)}
                          onToggleSelect={match.selectedCandidate && match.status !== 'skipped' ? () => setSelectedIds((prev) => { const next = new Set(prev); next.has(match.id) ? next.delete(match.id) : next.add(match.id); return next; }) : undefined}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════
            TAB: 合并歌单
        ══════════════════════════════════════════════ */}
        {activeTab === 'merge' && step === 'input' && (
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="text-center mb-2">
              <h1 className="text-[24px] font-bold text-[#1D1D1F] tracking-tight">合并 Apple Music 歌单</h1>
              <p className="text-[13px] text-[#6E6E73] mt-1">从 Music.app 读取歌单，选择并排序后合并为一个新歌单</p>
            </div>

            {/* Load button */}
            {!musicPlaylists.length && (
              <div className="bg-white rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-[#F5F5F7] flex items-center justify-center mx-auto mb-4">
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                    <rect x="3" y="3" width="16" height="16" rx="3" stroke="#AEAEB2" strokeWidth="1.5"/>
                    <path d="M7 8h8M7 11h5M7 14h6" stroke="#AEAEB2" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </div>
                <p className="text-[14px] text-[#6E6E73] mb-5">点击下方按钮读取 Music.app 中的所有歌单</p>
                {mergeError && <p className="text-[13px] text-[#FF3B30] mb-4">{mergeError}</p>}
                <button
                  onClick={loadMusicPlaylists}
                  disabled={playlistsLoading}
                  className="bg-[#FA2D55] hover:bg-[#E0264C] disabled:bg-[#E5E5EA] disabled:text-[#AEAEB2] text-white font-semibold px-6 py-2.5 rounded-xl text-[14px] transition-colors"
                >
                  {playlistsLoading ? '读取中...' : '读取歌单列表'}
                </button>
              </div>
            )}

            {musicPlaylists.length > 0 && (
              <>
                {/* Two-column: all playlists + selected order */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Left: all playlists */}
                  <div className="bg-white rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col" style={{ maxHeight: 420 }}>
                    <div className="px-4 py-3 border-b border-[#F0F0F5] flex items-center justify-between flex-shrink-0">
                      <span className="text-[13px] font-semibold text-[#1D1D1F]">所有歌单</span>
                      <span className="text-[11px] text-[#AEAEB2]">{musicPlaylists.length} 个</span>
                    </div>
                    <div className="overflow-y-auto flex-1 py-1">
                      {musicPlaylists.map((pl) => {
                        const selected = mergeSelected.includes(pl.name);
                        return (
                          <button
                            key={pl.name}
                            onClick={() => toggleMergeSelect(pl.name)}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                              selected ? 'bg-[#FFF0F3]' : 'hover:bg-[#F5F5F7]'
                            }`}
                          >
                            <span className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border transition-colors ${
                              selected ? 'bg-[#FA2D55] border-[#FA2D55]' : 'border-[#D1D1D6]'
                            }`}>
                              {selected && (
                                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                  <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-[13px] text-[#1D1D1F] truncate">{pl.name}</span>
                              <span className="text-[11px] text-[#AEAEB2]">{pl.trackCount} 首</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right: selected order */}
                  <div className="bg-white rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.06)] flex flex-col" style={{ maxHeight: 420 }}>
                    <div className="px-4 py-3 border-b border-[#F0F0F5] flex items-center justify-between flex-shrink-0">
                      <span className="text-[13px] font-semibold text-[#1D1D1F]">合并顺序</span>
                      {mergeSelected.length > 0 && (
                        <span className="text-[11px] text-[#AEAEB2]">共约 {mergeTotalTracks} 首</span>
                      )}
                    </div>
                    <div className="overflow-y-auto flex-1 py-1">
                      {mergeSelected.length === 0 ? (
                        <div className="flex items-center justify-center h-full px-4 text-center">
                          <p className="text-[13px] text-[#AEAEB2]">从左侧勾选歌单<br/>拖拽顺序即为合并顺序</p>
                        </div>
                      ) : (
                        mergeSelected.map((name, i) => {
                          const pl = musicPlaylists.find((p) => p.name === name);
                          return (
                            <div key={name} className="flex items-center gap-2 px-4 py-2.5">
                              <span className="text-[11px] font-bold text-[#AEAEB2] w-4 text-right flex-shrink-0">{i + 1}</span>
                              <span className="flex-1 min-w-0">
                                <span className="block text-[13px] text-[#1D1D1F] truncate">{name}</span>
                                {pl && <span className="text-[11px] text-[#AEAEB2]">{pl.trackCount} 首</span>}
                              </span>
                              <div className="flex gap-1 flex-shrink-0">
                                <button
                                  onClick={() => moveItem(i, -1)}
                                  disabled={i === 0}
                                  className="w-6 h-6 rounded-lg bg-[#F5F5F7] hover:bg-[#E5E5EA] disabled:opacity-30 flex items-center justify-center transition-colors"
                                >
                                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 7L2 4h6L5 7z" fill="#6E6E73" transform="rotate(180 5 5)"/></svg>
                                </button>
                                <button
                                  onClick={() => moveItem(i, 1)}
                                  disabled={i === mergeSelected.length - 1}
                                  className="w-6 h-6 rounded-lg bg-[#F5F5F7] hover:bg-[#E5E5EA] disabled:opacity-30 flex items-center justify-center transition-colors"
                                >
                                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 3L8 6H2L5 3z" fill="#6E6E73" transform="rotate(180 5 5)"/></svg>
                                </button>
                                <button
                                  onClick={() => toggleMergeSelect(name)}
                                  className="w-6 h-6 rounded-lg bg-[#F5F5F7] hover:bg-[#FFE5EA] flex items-center justify-center transition-colors"
                                >
                                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="#FF3B30" strokeWidth="1.5" strokeLinecap="round"/></svg>
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* Target name + run */}
                <div className="bg-white rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-4 flex items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-[11px] font-semibold text-[#6E6E73] uppercase tracking-wide mb-1">新歌单名称</label>
                    <input
                      type="text"
                      value={mergeTarget}
                      onChange={(e) => setMergeTarget(e.target.value)}
                      className="w-full bg-[#F5F5F7] border border-transparent rounded-xl px-3 py-2 text-[14px] text-[#1D1D1F] focus:outline-none focus:border-[#FA2D55] focus:bg-white transition-all"
                    />
                  </div>
                  <button
                    onClick={runMerge}
                    disabled={mergeRunning || mergeSelected.length < 2 || !mergeTarget.trim()}
                    className="mt-5 bg-[#FA2D55] hover:bg-[#E0264C] disabled:bg-[#E5E5EA] disabled:text-[#AEAEB2] text-white font-semibold px-6 py-2 rounded-xl text-[14px] transition-colors whitespace-nowrap"
                  >
                    {mergeRunning ? '合并中...' : `开始合并（${mergeSelected.length} 个歌单）`}
                  </button>
                </div>

                {mergeError && <div className="text-[13px] text-[#FF3B30] bg-white rounded-2xl px-5 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">{mergeError}</div>}
                {mergeResult && (
                  <div className="bg-[#E8F9EE] rounded-2xl px-5 py-4 flex items-center gap-3">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="flex-shrink-0">
                      <circle cx="10" cy="10" r="9" fill="#34C759" fillOpacity=".15"/>
                      <path d="M6 10l3 3 5-5" stroke="#34C759" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className="text-[13px] text-[#1A7F37] font-medium">{mergeResult}</span>
                  </div>
                )}

                <div className="flex justify-center">
                  <button
                    onClick={() => { setMusicPlaylists([]); setMergeSelected([]); setMergeResult(''); setMergeError(''); }}
                    className="text-[12px] text-[#AEAEB2] hover:text-[#6E6E73] transition-colors"
                  >
                    重新加载歌单列表
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════
            TAB: 使用说明
        ══════════════════════════════════════════════ */}
        {activeTab === 'help' && step === 'input' && (
          <div className="max-w-2xl mx-auto space-y-4">
            <div className="text-center mb-2">
              <h1 className="text-[24px] font-bold text-[#1D1D1F] tracking-tight">使用说明</h1>
              <p className="text-[13px] text-[#6E6E73] mt-1">两步完成迁移：先匹配，再用 Soundiiz 导入</p>
            </div>

            {[
              {
                step: '第一步',
                title: '导入歌单并匹配',
                color: '#FA2D55',
                items: [
                  '粘贴网易云或 QQ 音乐的公开歌单链接，点击「开始搜索」',
                  '工具自动批量搜索 iTunes，将每首歌标注为「已匹配 / 待确认 / 未找到」',
                  '「待确认」「未找到」的歌可点击「重新搜索」再试一次',
                  '仍有问题的填入 DeepSeek API Key，点「AI 辅助搜索」让 AI 提供更好的搜索词',
                  '也可点击每行手动搜索，或从候选列表切换匹配结果',
                  '确认无误后点「导出 CSV」，超过 200 首自动拆分为多个文件',
                ],
              },
              {
                step: '第二步',
                title: '用 Soundiiz 导入到 Apple Music',
                color: '#007AFF',
                items: [
                  '点击「打开 Soundiiz →」跳转到 soundiiz.com，注册 / 登录',
                  '点击 Import → From File，上传导出的 CSV 文件',
                  '目标平台选 Apple Music，授权后开始导入（免费版每次限 200 首）',
                  '若有多个 CSV 文件，依次导入，每次在 Soundiiz 新建一个歌单',
                  'CSV 含 Apple Music Track ID，Soundiiz 会按 ID 精确匹配，不靠歌名模糊搜索',
                ],
              },
              {
                step: '第三步（可选）',
                title: '合并多个歌单',
                color: '#34C759',
                items: [
                  '导入后若产生多个歌单（如 playlist-1、playlist-2），切到「合并歌单」标签',
                  '点「读取歌单列表」从 Music.app 加载所有歌单',
                  '勾选要合并的歌单，用上下箭头调整顺序，输入新歌单名称',
                  '点「开始合并」，工具通过 AppleScript 将各歌单曲目依序复制到新歌单',
                ],
              },
            ].map(({ step: s, title, color, items }) => (
              <div key={s} className="bg-white rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: color }}>{s}</span>
                  <h2 className="text-[15px] font-bold text-[#1D1D1F]">{title}</h2>
                </div>
                <ol className="space-y-2.5">
                  {items.map((item, i) => (
                    <li key={i} className="flex gap-3 text-[13px] text-[#3A3A3C]">
                      <span className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-0.5" style={{ backgroundColor: color }}>{i + 1}</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}

            <div className="bg-[#F5F5F7] rounded-2xl p-4">
              <p className="text-[12px] text-[#6E6E73] font-semibold mb-2">注意事项</p>
              <ul className="space-y-1.5 text-[12px] text-[#6E6E73]">
                <li>• 歌单须为<strong className="text-[#1D1D1F]">公开</strong>歌单，私密歌单无法抓取</li>
                <li>• DeepSeek API Key 仅在本地使用，不上传或存储</li>
                <li>• 匹配结果会自动缓存，下次导入同一歌曲无需重新搜索</li>
                <li>• 合并歌单需要 Music.app 在后台运行，且已登录 Apple Music 账号</li>
                <li>• Soundiiz 免费版单次最多 200 首，故超过 200 首时自动拆分 CSV</li>
              </ul>
            </div>
          </div>
        )}

      </div>

      {/* ── TXT export modal ── */}
      {textModal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setTextModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#F0F0F5]">
              <div>
                <h3 className="text-[15px] font-bold text-[#1D1D1F]">复制歌单列表</h3>
                <p className="text-[11px] text-[#AEAEB2] mt-0.5">{textModal.split('\n').length} 首 · 格式：歌名 - 歌手</p>
              </div>
              <button onClick={() => setTextModal(null)} className="text-[#AEAEB2] hover:text-[#6E6E73] text-[20px] leading-none">×</button>
            </div>
            <textarea
              readOnly
              value={textModal}
              onFocus={(e) => e.target.select()}
              className="flex-1 m-5 mb-3 p-3 bg-[#F5F5F7] rounded-xl text-[13px] text-[#1D1D1F] font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[#FA2D55]"
              style={{ minHeight: '240px' }}
            />
            <div className="flex items-center gap-2 px-5 pb-5">
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(textModal);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    setError('复制失败，请手动全选复制');
                  }
                }}
                className="flex-1 bg-[#FA2D55] hover:bg-[#E0264C] text-white font-semibold py-2.5 rounded-xl text-[14px] transition-colors"
              >
                {copied ? '已复制 ✓' : '复制全部'}
              </button>
              <button
                onClick={() => window.open('https://soundiiz.com/', '_blank', 'noopener')}
                className="flex-1 bg-[#1D1D1F] hover:bg-[#3A3A3C] text-white font-semibold py-2.5 rounded-xl text-[14px] transition-colors"
              >
                打开 Soundiiz →
              </button>
              <button onClick={() => setTextModal(null)} className="px-4 py-2.5 bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#1D1D1F] font-medium rounded-xl text-[14px] transition-colors">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function StatPill({ label, value, color = 'text-[#1D1D1F]' }: { label: string; value: number; color?: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px]">
      <span className={`font-semibold tabular-nums ${color}`}>{value}</span>
      <span className="text-[#AEAEB2]">{label}</span>
    </span>
  );
}

function FilterPill({ label, value, color = 'text-[#1D1D1F]', active, onClick }: { label: string; value: number; color?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`cursor-pointer flex items-center gap-1.5 text-[12px] px-2 py-0.5 rounded-lg transition-colors ${active ? 'bg-[#1D1D1F]' : 'hover:bg-[#F5F5F7]'}`}
    >
      <span className={`font-semibold tabular-nums ${active ? 'text-white' : color}`}>{value}</span>
      <span className={active ? 'text-white/70' : 'text-[#AEAEB2]'}>{label}</span>
    </button>
  );
}
