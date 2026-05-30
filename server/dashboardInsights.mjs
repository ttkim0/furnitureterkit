// AI-generated dashboard insights — Claude reads the creator's raw metrics
// and returns 2–3 actionable sentences. Not vague platitudes, real specifics
// that reference the numbers ("Berlin and Paris drove 60% of your visits but
// 0 purchases — your shipping to EU may be discouraging them").
//
// Cost: ~$0.005 per dashboard load (Haiku 4.5 input ~800 tokens + output ~300).
// Cached: client passes a hash of the metric values; if hash matches the
// cached response from the last hour, return cached. (Not implemented in v1
// — the LLM call is cheap enough that caching adds complexity without
// material savings.)

import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_INSIGHTS_MODEL ?? "claude-haiku-4-5-20251015";

let _client = null;
function client() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }
  _client = new Anthropic();
  return _client;
}

const SYSTEM_PROMPT = `You are a senior e-commerce analyst writing dashboard commentary for an independent furniture maker who sells through the Ariadne marketplace.

You receive a JSON object of real metrics from their store. Your job is to produce 2-3 SPECIFIC, ACTIONABLE insights — not generic advice.

Rules:
- Reference SPECIFIC numbers from the data ("47 visits from Germany this month")
- Compare meaningful pairs ("Your conversion rate of 1.2% is below the marketplace average of ~2%, suggesting product photography may need work")
- Suggest ONE concrete next action per insight, not a list of tips
- If the data is empty or near-empty (new store), acknowledge that and tell them what to focus on first ("Share your store link in 2-3 places to get the first 50 visitors — that's when patterns start to emerge")
- NEVER fabricate numbers, comparisons, or industry benchmarks you don't have data for
- Tone: warm, direct, brief. Like a smart friend who happens to know retail. Not a McKinsey deck.
- Format as plain markdown with each insight as a bulleted line. No headers, no preamble.

Output: just the bulleted insights. 2-3 bullets, max 30 words each. No section headers, no "Here are your insights:" preamble.`;

/**
 * @param {object} metrics - The computed metrics object from the frontend.
 * @returns {Promise<{ insights: string, elapsed_ms: number, model: string }>}
 */
export async function generateDashboardInsights(metrics) {
  const t0 = Date.now();

  const userMessage = `Here are the metrics for ${metrics.storeName ?? "the store"} (slug: ${metrics.storeSlug ?? "?"}):

\`\`\`json
${JSON.stringify(metrics, null, 2)}
\`\`\`

Give 2-3 specific actionable insights based ONLY on this data. Reference the numbers. Suggest concrete next moves. Stay under 30 words per insight.`;

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return {
    insights: text,
    elapsed_ms: Date.now() - t0,
    model: response.model,
    input_tokens: response.usage?.input_tokens,
    output_tokens: response.usage?.output_tokens,
  };
}
