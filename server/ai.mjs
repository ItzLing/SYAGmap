// AI prioritisation: Claude ranks what to fix first from aggregated reports + footfall.
// Only aggregated, anonymous data is sent (street name, problem types, counts, footfall).
// If ANTHROPIC_API_KEY is not set, the client falls back to its rule-based ranking.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';

const SYSTEM = `You are an urban accessibility analyst advising a township management team in Malaysia.
You receive clusters of resident-reported pedestrian problems, each with a pedestrian footfall index from
township-observer counts. Rank which clusters to fix FIRST. Weigh: harm to wheelchair users, elderly people,
parents with strollers and visually impaired people; severity of the problem type; how many independent reports
confirm it; how recent the reports are; and how many people walk there (footfall). Be concrete and brief.
Respond with ONLY a JSON object, no prose, in this exact shape:
{"ranking":[{"id":"<cluster id>","rank":1,"reason":"<one or two sentences>","suggestedAction":"<short action>"}],"summary":"<two sentences>"}
Include every cluster you were given, most urgent first. Never invent clusters or facts not in the input.`;

export async function prioritize({ township, clusters }) {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'no_key' };
  if (!Array.isArray(clusters) || clusters.length === 0) return { ok: false, reason: 'no_data' };

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Township: ${township}\nClusters (JSON):\n${JSON.stringify(clusters.slice(0, 25))}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') return { ok: false, reason: 'refused' };
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) return { ok: false, reason: 'bad_output' };
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return { ok: true, model: MODEL, ...parsed };
  } catch {
    return { ok: false, reason: 'bad_output' };
  }
}
