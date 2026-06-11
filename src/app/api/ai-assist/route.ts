import { NextRequest, NextResponse } from 'next/server';
import { getAlternativeQueries } from '@/lib/deepseek';
import { searchITunes, scoreMatch, verifyMatch } from '@/lib/itunes';
import { TrackMatch } from '@/lib/types';

const DEEPSEEK_BATCH = 20; // max songs per DeepSeek call

export async function POST(req: NextRequest) {
  const { matches, apiKey }: { matches: TrackMatch[]; apiKey: string } = await req.json();

  if (!apiKey) {
    return NextResponse.json({ error: '请提供 DeepSeek API Key' }, { status: 400 });
  }

  const failedMatches = matches.filter(
    (m) => m.status === 'failed' || m.status === 'uncertain'
  );

  if (!failedMatches.length) {
    return NextResponse.json({ improved: [] });
  }

  // Split into batches so DeepSeek returns clean JSON
  const improved: any[] = [];
  const errors: string[] = [];

  for (let i = 0; i < failedMatches.length; i += DEEPSEEK_BATCH) {
    const batchMatches = failedMatches.slice(i, i + DEEPSEEK_BATCH);
    const sourceTracks = batchMatches.map((m) => m.source);

    let alternatives: Record<string, string[]> = {};
    try {
      alternatives = await getAlternativeQueries(sourceTracks, apiKey);
    } catch (e: any) {
      errors.push(`DeepSeek 批次 ${i / DEEPSEEK_BATCH + 1} 失败: ${e.message}`);
      // Still continue — we'll just have empty queries for this batch
    }

    const batchResults = await Promise.all(
      batchMatches.map(async (match, idx) => {
        const queries: string[] = alternatives[String(idx + 1)] ?? [];
        if (!queries.length) {
          return { id: match.id, updated: false, debugReason: 'no_queries' };
        }

        let bestResult = match.selectedCandidate;
        // For failed tracks (null selectedCandidate), any match counts
        let bestScore = bestResult ? scoreMatch(match.source, bestResult) : -1;
        let bestCandidates = match.candidates;
        let bestQuery = '';

        for (const query of queries) {
          const candidates = await searchITunes(query, 5);
          if (!candidates.length) continue;

          const scored = candidates
            .map((c) => ({ candidate: c, score: scoreMatch(match.source, c) }))
            .sort((a, b) => b.score - a.score);

          if (scored[0].score > bestScore) {
            bestScore = scored[0].score;
            bestResult = scored[0].candidate;
            bestCandidates = candidates;
            bestQuery = query;
          }
        }

        const foundNew = bestResult !== match.selectedCandidate;
        const newStatus =
          bestScore >= 0.7 && bestResult && verifyMatch(match.source, bestResult)
            ? 'matched'
            : bestScore >= 0.4
            ? 'uncertain'
            : 'failed';

        return {
          id: match.id,
          updated: foundNew,
          selectedCandidate: bestResult,
          candidates: bestCandidates,
          status: newStatus,
          aiSuggestion: queries.join(' / '),
          usedQuery: bestQuery,
        };
      })
    );

    improved.push(...batchResults);
  }

  return NextResponse.json({
    improved,
    ...(errors.length ? { warnings: errors } : {}),
  });
}
