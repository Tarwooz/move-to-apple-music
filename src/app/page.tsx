'use client';

import { useState, useCallback } from 'react';
import { TrackMatch, Playlist, AppleMusicTrack } from '@/lib/types';
import TrackRow from '@/components/TrackRow';

type Step = 'input' | 'searching' | 'preview' | 'done';

const SEARCH_BATCH = 20;
const AI_BATCH = 20;
const CSV_CHUNK = 200; // split exported CSV into files of this many songs

export default function Home() {
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
  const [createStatus, setCreateStatus] = useState('');
  const [textModal, setTextModal] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      setPlaylistName('迁移到appleMusic');
      const tracksToSearch = pl.tracks;
      setProgress({ done: 0, total: tracksToSearch.length, label: '正在搜索 Apple Music...' });

      const allMatches: TrackMatch[] = [];
      for (let i = 0; i < tracksToSearch.length; i += SEARCH_BATCH) {
        const batch = tracksToSearch.slice(i, i + SEARCH_BATCH);
        const res2 = await fetch('/api/search-apple', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: batch }),
        });
        const data2 = await res2.json();
        if (!res2.ok) throw new Error(data2.error);
        allMatches.push(...data2.matches);
        setProgress({
          done: Math.min(i + SEARCH_BATCH, tracksToSearch.length),
          total: tracksToSearch.length,
          label: '正在搜索 Apple Music...',
        });
        setMatches([...allMatches]);
      }

      setStep('preview');
    } catch (e: any) {
      setError(e.message);
      setStep('input');
    }
  }, [playlistUrl]);

  const runAiAssist = useCallback(async () => {
    if (!deepseekKey) { setError('请先输入 DeepSeek API Key'); return; }
    setAiRunning(true);
    setError('');
    const failedMatches = matches.filter((m) => m.status === 'failed' || m.status === 'uncertain');
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
        setMatches((prev) =>
          prev.map((m) => {
            const upd = (data.improved ?? []).find((u: any) => u.id === m.id);
            if (!upd || !upd.updated) return m;
            return {
              ...m,
              status: upd.status,
              selectedCandidate: upd.selectedCandidate ?? m.selectedCandidate,
              candidates: upd.candidates?.length ? upd.candidates : m.candidates,
              aiSuggestion: upd.aiSuggestion,
            };
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
    setMatches((prev) =>
      prev.map((m) =>
        m.id === matchId ? { ...m, selectedCandidate: candidate, status: candidate ? 'manual' : 'failed' } : m
      )
    );
  }, []);

  const handleSkip = useCallback((matchId: string) => {
    setMatches((prev) =>
      prev.map((m) => m.id === matchId ? { ...m, status: m.status === 'skipped' ? 'failed' : 'skipped' } : m)
    );
  }, []);

  const handleManualSearch = useCallback(async (matchId: string, query: string) => {
    const res = await fetch(`/api/manual-search?${new URLSearchParams({ q: query })}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.candidates?.length) {
      setMatches((prev) =>
        prev.map((m) =>
          m.id === matchId ? { ...m, candidates: data.candidates, selectedCandidate: data.candidates[0], status: 'manual' } : m
        )
      );
    }
  }, []);

  const retrySearch = useCallback(async () => {
    const toRetry = matches.filter((m) => m.status === 'failed' || m.status === 'uncertain');
    if (!toRetry.length) return;
    setRetrying(true);
    setError('');
    setRetryProgress({ done: 0, total: toRetry.length });

    try {
      for (let i = 0; i < toRetry.length; i += SEARCH_BATCH) {
        const batch = toRetry.slice(i, i + SEARCH_BATCH);
        const res = await fetch('/api/search-apple', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: batch.map((m) => m.source), forceRefresh: true }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

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

  const saveSkipped = useCallback(async () => {
    const skippedTracks = matches.filter((m) => m.status === 'skipped').map((m) => m.source);
    if (!skippedTracks.length) return null;
    const res = await fetch('/api/save-skipped', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks: skippedTracks }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    return data;
  }, [matches]);

  const saveManualToCache = useCallback(async () => {
    const manualMatches = matches.filter((m) => m.status === 'manual' && m.selectedCandidate);
    if (!manualMatches.length) return;
    const res = await fetch('/api/save-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matches: manualMatches }),
    });
    const data = await res.json();
    if (res.ok) alert(`已保存 ${data.saved} 首手动匹配到本地缓存`);
    else setError(data.error);
  }, [matches]);

  const saveAiToCache = useCallback(async () => {
    const aiMatches = matches.filter((m) => m.aiSuggestion && m.selectedCandidate && m.status !== 'failed');
    if (!aiMatches.length) return;
    const res = await fetch('/api/save-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matches: aiMatches }),
    });
    const data = await res.json();
    if (res.ok) alert(`已保存 ${data.saved} 首 AI 匹配到本地缓存`);
    else setError(data.error);
  }, [matches]);

  const createPlaylist = useCallback(async () => {
    const toAdd = matches.filter((m) => m.status !== 'skipped' && m.selectedCandidate).map((m) => m.selectedCandidate!);
    if (!toAdd.length) { setError('没有可添加的歌曲'); return; }
    setCreateStatus('正在写入 Apple Music...');
    setError('');
    try {
      const res = await fetch('/api/create-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: playlistName, tracks: toAdd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await saveSkipped();
      setStep('done');
      setCreateStatus(`成功创建歌单「${playlistName}」，共 ${data.count} 首歌曲`);
    } catch (e: any) {
      setError(e.message);
      setCreateStatus('');
    }
  }, [matches, playlistName, saveSkipped]);

  const exportList = useCallback((format: 'csv' | 'txt') => {
    const rows = matches
      .filter((m) => m.status !== 'skipped' && m.selectedCandidate)
      .map((m) => m.selectedCandidate!);
    if (!rows.length) { setError('没有可导出的歌曲'); return; }

    // TXT: show in a modal for copy-paste instead of downloading
    if (format === 'txt') {
      setCopied(false);
      setTextModal(rows.map((t) => `${t.trackName} - ${t.artistName}`).join('\n'));
      return;
    }

    // CSV: download file(s) for upload. Split into chunks of CSV_CHUNK so each
    // file fits importers' single-import limits (e.g. Soundiiz free = 200).
    // Include Apple Music track id so importers that support platform+id
    // "perfect match" can locate the exact catalog track by ID. ISRC reserved.
    const esc = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`;
    const header = 'Track name,Artist name,Album,ISRC,Apple Music – id';
    const seen = new Set<number>();
    const allLines = rows
      .filter((t) => { if (seen.has(t.trackId)) return false; seen.add(t.trackId); return true; })
      .map((t) =>
        [t.trackName, t.artistName, t.collectionName, '', String(t.trackId)].map(esc).join(',')
      );
    const base = playlistName || 'playlist';
    const totalParts = Math.ceil(allLines.length / CSV_CHUNK);
    for (let p = 0; p < totalParts; p++) {
      const chunk = allLines.slice(p * CSV_CHUNK, (p + 1) * CSV_CHUNK);
      const content = '﻿' + [header, ...chunk].join('\n'); // BOM for Excel
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = totalParts > 1 ? `${base}-${p + 1}.csv` : `${base}.csv`;
      // stagger clicks so the browser doesn't drop all but the last download
      setTimeout(() => { a.click(); URL.revokeObjectURL(url); }, p * 300);
    }
  }, [matches, playlistName]);

  const stats = {
    total: matches.length,
    matched: matches.filter((m) => m.status === 'matched' || m.status === 'manual').length,
    uncertain: matches.filter((m) => m.status === 'uncertain').length,
    failed: matches.filter((m) => m.status === 'failed').length,
    skipped: matches.filter((m) => m.status === 'skipped').length,
    manual: matches.filter((m) => m.status === 'manual').length,
    aiMatched: matches.filter((m) => m.aiSuggestion && m.selectedCandidate && m.status !== 'failed').length,
  };
  const toWriteCount = matches.filter((m) => m.status !== 'skipped' && m.selectedCandidate).length;
  const progressPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <main className="min-h-screen bg-[#F5F5F7]">
      {/* Top nav bar */}
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
        {/* Input / Searching step */}
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

              {error && (
                <div className="text-[13px] text-[#FF3B30] bg-[#FFF0EF] rounded-xl px-4 py-3">{error}</div>
              )}

              {step === 'searching' ? (
                <div className="pt-1 space-y-3">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-[#6E6E73]">{progress.label}</span>
                    {progress.total > 0 && (
                      <span className="text-[#AEAEB2] tabular-nums">{progress.done} / {progress.total}</span>
                    )}
                  </div>
                  <div className="w-full bg-[#E5E5EA] rounded-full h-1">
                    <div
                      className="bg-[#FA2D55] h-1 rounded-full transition-all duration-500"
                      style={{ width: progress.total > 0 ? `${progressPct}%` : '8%' }}
                    />
                  </div>
                  {matches.length > 0 && (
                    <p className="text-[11px] text-[#AEAEB2] text-center">已加载 {matches.length} 首，继续搜索中...</p>
                  )}
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

        {/* Preview step */}
        {step === 'preview' && playlist && (
          <div className="space-y-3">
            {/* Playlist hero */}
            <div className="bg-white rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-5 flex items-center gap-4">
              {playlist.coverUrl ? (
                <img src={playlist.coverUrl} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0 shadow-sm" />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#FA2D55] to-[#FF6B9D] flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <input
                  type="text"
                  value={playlistName}
                  onChange={(e) => setPlaylistName(e.target.value)}
                  className="text-[18px] font-bold text-[#1D1D1F] focus:outline-none bg-transparent w-full border-b border-dashed border-transparent focus:border-[#E5E5EA]"
                />
                {playlist.description && (
                  <p className="text-[12px] text-[#AEAEB2] mt-0.5 truncate">{playlist.description}</p>
                )}
              </div>
              <button
                onClick={() => { setStep('input'); setMatches([]); setPlaylist(null); }}
                className="text-[12px] text-[#AEAEB2] hover:text-[#6E6E73] flex-shrink-0 transition-colors"
              >
                重新输入
              </button>
            </div>

            {/* Stats bar */}
            <div className="bg-white rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.06)] px-5 py-3.5 flex items-center gap-2 flex-wrap">
              <StatPill label="共" value={stats.total} />
              <div className="w-px h-4 bg-[#E5E5EA]" />
              <StatPill label="已匹配" value={stats.matched} color="text-emerald-500" />
              <StatPill label="待确认" value={stats.uncertain} color="text-amber-500" />
              <StatPill label="未找到" value={stats.failed} color="text-red-400" />
              {stats.skipped > 0 && <StatPill label="已跳过" value={stats.skipped} color="text-[#AEAEB2]" />}

              <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
                <button
                  onClick={() => exportList('csv')}
                  disabled={toWriteCount === 0}
                  title="导出已匹配歌单为 CSV，可导入 Soundiiz / TuneMyMusic 等支持官方 API 的迁移网站"
                  className="text-[12px] px-3.5 py-1.5 bg-[#007AFF] hover:bg-[#0066D6] disabled:bg-[#E5E5EA] disabled:text-[#AEAEB2] text-white rounded-xl font-medium transition-colors"
                >
                  导出 CSV（{toWriteCount} 首）
                </button>
                <button
                  onClick={() => exportList('txt')}
                  disabled={toWriteCount === 0}
                  title="导出为纯文本（歌名 - 歌手），可粘贴到支持文本导入的网站"
                  className="text-[12px] px-3.5 py-1.5 bg-white border border-[#D1D1D6] hover:bg-[#F5F5F7] disabled:opacity-50 text-[#1D1D1F] rounded-xl font-medium transition-colors"
                >
                  导出 TXT
                </button>
                <button
                  onClick={() => window.open('https://www.tunemymusic.com/zh-CN/transfer', '_blank', 'noopener')}
                  title="打开 TuneMyMusic，用导出的 CSV/文本导入到 Apple Music"
                  className="text-[12px] px-3.5 py-1.5 bg-[#1D1D1F] hover:bg-[#3A3A3C] text-white rounded-xl font-medium transition-colors"
                >
                  打开 TuneMyMusic →
                </button>
                {(stats.uncertain > 0 || stats.failed > 0) && (
                  <button
                    onClick={retrySearch}
                    disabled={retrying || aiRunning}
                    className="text-[12px] px-3.5 py-1.5 bg-[#1D1D1F] hover:bg-[#3A3A3C] disabled:bg-[#E5E5EA] disabled:text-[#AEAEB2] text-white rounded-xl font-medium transition-colors"
                  >
                    {retrying
                      ? `重试中 ${retryProgress.done}/${retryProgress.total}...`
                      : `重新搜索（${stats.uncertain + stats.failed} 首）`}
                  </button>
                )}
                {(stats.uncertain > 0 || stats.failed > 0) && (
                  <button
                    onClick={runAiAssist}
                    disabled={aiRunning || retrying || !deepseekKey}
                    title={!deepseekKey ? '请先输入 DeepSeek API Key' : ''}
                    className="text-[12px] px-3.5 py-1.5 bg-[#7F56D9] hover:bg-[#6941C6] disabled:bg-[#E5E5EA] disabled:text-[#AEAEB2] text-white rounded-xl font-medium transition-colors"
                  >
                    {aiRunning
                      ? `AI 搜索中 ${aiProgress.done}/${aiProgress.total}...`
                      : `AI 辅助搜索（${stats.uncertain + stats.failed} 首）`}
                  </button>
                )}
                {stats.manual > 0 && (
                  <button
                    onClick={saveManualToCache}
                    className="text-[12px] px-3.5 py-1.5 bg-[#34C759] hover:bg-[#2DB34A] text-white rounded-xl font-medium transition-colors"
                  >
                    保存手动匹配
                  </button>
                )}
                {stats.aiMatched > 0 && (
                  <button
                    onClick={saveAiToCache}
                    className="text-[12px] px-3.5 py-1.5 bg-[#7F56D9] hover:bg-[#6941C6] text-white rounded-xl font-medium transition-colors"
                  >
                    保存 AI 匹配
                  </button>
                )}
                {stats.skipped > 0 && (
                  <button
                    onClick={async () => {
                      const data = await saveSkipped();
                      if (data) alert(`已记录 ${data.saved} 首跳过歌曲`);
                    }}
                    className="text-[12px] px-3.5 py-1.5 bg-[#8E8E93] hover:bg-[#6E6E73] text-white rounded-xl font-medium transition-colors"
                  >
                    保存跳过记录
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="text-[13px] text-[#FF3B30] bg-white rounded-2xl px-5 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">{error}</div>
            )}

            {/* Track table */}
            <div className="bg-white rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-x-auto pb-24">
              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b border-[#F0F0F5]">
                    <th className="py-2.5 pl-5 pr-2 text-left w-10">
                      <span className="text-[10px] font-semibold text-[#AEAEB2] uppercase tracking-wider">#</span>
                    </th>
                    <th className="py-2.5 pr-4 text-left w-36">
                      <span className="text-[10px] font-semibold text-[#AEAEB2] uppercase tracking-wider">原始</span>
                    </th>
                    <th className="py-2.5 pr-4 text-left w-24">
                      <span className="text-[10px] font-semibold text-[#AEAEB2] uppercase tracking-wider whitespace-nowrap">状态</span>
                    </th>
                    <th className="py-2.5 pr-4 text-left w-48">
                      <span className="text-[10px] font-semibold text-[#AEAEB2] uppercase tracking-wider">Apple Music</span>
                    </th>
                    <th className="py-2.5 pr-5 text-left">
                      <span className="text-[10px] font-semibold text-[#AEAEB2] uppercase tracking-wider">调整</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((match, i) => (
                    <TrackRow
                      key={match.id}
                      match={match}
                      index={i}
                      onSelectCandidate={handleSelectCandidate}
                      onSkip={handleSkip}
                      onManualSearch={handleManualSearch}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Floating write button — shown during preview */}
        {step === 'preview' && (
          <div className="fixed bottom-6 right-6 z-20 flex flex-col items-end gap-2">
            <div className="text-[11px] text-[#6E6E73] bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm border border-[#E5E5EA]">
              {toWriteCount} 首 · 「{playlistName}」
            </div>
            <button
              onClick={createPlaylist}
              disabled={toWriteCount === 0 || !!createStatus}
              className="bg-[#FA2D55] hover:bg-[#E0264C] active:bg-[#C02140] disabled:bg-[#E5E5EA] disabled:text-[#AEAEB2] text-white font-semibold px-6 py-3 rounded-2xl text-[14px] transition-colors whitespace-nowrap shadow-[0_4px_20px_rgba(250,45,85,0.4)]"
            >
              {createStatus || '写入 Apple Music'}
            </button>
          </div>
        )}

        {/* Done step */}
        {step === 'done' && (
          <div className="max-w-sm mx-auto">
            <div className="bg-white rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-[#E8F9EE] flex items-center justify-center mx-auto mb-5">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <path d="M6 14l6 6 10-10" stroke="#34C759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h2 className="text-[20px] font-bold text-[#1D1D1F] mb-2">迁移完成</h2>
              <p className="text-[13px] text-[#6E6E73] mb-1">{createStatus}</p>
              <p className="text-[12px] text-[#AEAEB2] mb-8">请打开 Music 应用查看歌单</p>
              <button
                onClick={() => { setStep('input'); setMatches([]); setPlaylist(null); setPlaylistUrl(''); setCreateStatus(''); }}
                className="bg-[#FA2D55] hover:bg-[#E0264C] text-white font-semibold px-6 py-2.5 rounded-xl text-[14px] transition-colors"
              >
                迁移另一个歌单
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Text export modal — copy-paste list */}
      {textModal !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setTextModal(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
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
                onClick={() => window.open('https://www.tunemymusic.com/zh-CN/transfer', '_blank', 'noopener')}
                className="flex-1 bg-[#1D1D1F] hover:bg-[#3A3A3C] text-white font-semibold py-2.5 rounded-xl text-[14px] transition-colors"
              >
                打开 TuneMyMusic →
              </button>
              <button
                onClick={() => setTextModal(null)}
                className="px-4 py-2.5 bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#1D1D1F] font-medium rounded-xl text-[14px] transition-colors"
              >
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
