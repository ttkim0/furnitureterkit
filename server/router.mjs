// Pick a furniture template from a free-text prompt.
//
// Strategy: try the LLM router first (when ANTHROPIC_API_KEY is set); fall
// back to keyword matching. Both return one of the IDs registered in
// templates.mjs. Default is "table".

import { listTemplates } from "./templates.mjs";
import {
  pickTemplateWithLLM,
  isLLMConfigured,
  LLMUnavailable,
} from "./llm.mjs";

const KEYWORDS = [
  ["lamp", ["lamp", "lantern", "sconce", "lighting"]],
  ["bed", ["bed", "mattress", "bunk", "cot", "headboard"]],
  ["chair", ["chair", "stool", "armchair", "seat", "throne"]],
  ["desk", ["desk", "writing", "workstation", "office", "vanity"]],
  ["table", ["table", "dining", "coffee table", "side table", "console"]],
];

export function pickTemplateByKeyword(prompt) {
  const text = String(prompt).toLowerCase();
  for (const [tpl, words] of KEYWORDS) {
    for (const w of words) {
      if (text.includes(w)) return { templateId: tpl, source: "keyword" };
    }
  }
  return { templateId: "table", source: "keyword-default" };
}

export async function pickTemplate(prompt) {
  if (isLLMConfigured()) {
    try {
      const templateId = await pickTemplateWithLLM(prompt, listTemplates());
      return { templateId, source: "anthropic-claude" };
    } catch (e) {
      if (!(e instanceof LLMUnavailable)) {
        console.warn(
          "[ariadne] LLM template router failed, falling back to keywords:",
          e.message
        );
      }
    }
  }
  return pickTemplateByKeyword(prompt);
}
