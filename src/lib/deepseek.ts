import { SourceTrack } from './types';

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';

export async function getAlternativeQueries(
  tracks: SourceTrack[],
  apiKey: string
): Promise<Record<string, string[]>> {
  const stripBrackets = (s: string) => s.replace(/[\(（][^)）]*[\)）]/g, '').trim();

  const list = tracks
    .map((t, i) => `${i + 1}. 歌名: "${stripBrackets(t.title)}", 歌手: "${t.artist}"`)
    .join('\n');

  const prompt = `你是一个音乐搜索专家。以下歌曲在 Apple Music / iTunes 上搜索失败，请为每首歌提供 2-3 个更好的搜索关键词方案，格式为英文或中文均可，优先考虑：
1. 歌曲在不同平台的官方名称差异（如简体/繁体/英文/日文名）
2. 歌手的英文名或艺名
3. 去除特殊字符后的简化名称

歌曲列表：
${list}

请以 JSON 格式回复，key 为序号（字符串），value 为搜索词数组，例如：
{"1": ["query1", "query2"], "2": ["query1", "query2"]}
只返回 JSON，不要其他内容。`;

  let res: Response | null = null;
  let lastErr = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      res = await fetch(DEEPSEEK_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        }),
      });
      clearTimeout(timer);
      break;
    } catch (e: any) {
      clearTimeout(timer);
      lastErr = e.message;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  if (!res) throw new Error(`DeepSeek 连接失败（重试3次）: ${lastErr}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API 失败 ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? '{}';

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`DeepSeek 返回格式异常: ${content.slice(0, 200)}`);
    return JSON.parse(jsonMatch[0]);
  } catch (e: any) {
    throw new Error(`DeepSeek 响应解析失败: ${e.message}`);
  }
}
