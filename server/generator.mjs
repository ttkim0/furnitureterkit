// Top-level generation: free-form LLM if available, template fallback if not.
//
// Order of preference per request:
//   1. ANTHROPIC_API_KEY set → call generateModelWithLLM (Sonnet 4.6, build_model tool)
//   2. On any failure → keyword route to a template (or default to "table")

import {
  generateModelWithLLM,
  generateScadWithLLM,
  isLLMConfigured,
  LLMUnavailable,
} from "./llm.mjs";
import { pickTemplateByKeyword } from "./router.mjs";
import { generateFromTemplate } from "./templates.mjs";
import { imageToMesh, isFalConfigured, FalUnavailable } from "./fal.mjs";
import {
  editImageWithText,
  generateImageFromText,
  isOpenAIConfigured,
  OpenAIUnavailable,
} from "./openaiImage.mjs";

// quality_preset → generation strategy
//   "max"        → if image present + Fal configured: Hunyuan3D image-to-mesh
//                  else: raw SCAD via Opus
//   "draft"      → part list via Sonnet (current default), $fn=16
//   "textureless"→ part list via Sonnet, neutral material on render
const SCAD_PRESETS = new Set(["max"]);

let meshCounter = 0;
function falModelId() {
  return `fal-mesh-${++meshCounter}-${Date.now()}`;
}

export async function generateModel(prompt, image, modelOverride, qualityPreset) {
  const preset = qualityPreset || "draft";

  // ─── Photoreal mesh pipeline (preset === max + Fal configured) ──────────
  // All roads converge to "image → Hunyuan3D". The image input is one of:
  //   1. uploaded reference image (no text edits)            → Hunyuan
  //   2. uploaded reference + text edits ("but with leather")
  //        → OpenAI edit → modified image → Hunyuan
  //   3. text-only prompt (no reference)
  //        → OpenAI generate → fresh studio image → Hunyuan
  if (SCAD_PRESETS.has(preset) && isFalConfigured()) {
    let meshInputImage = image;
    let referencePathLabel = "raw-image";

    if (isOpenAIConfigured()) {
      try {
        if (image && prompt && prompt.trim()) {
          // Image + text → edit
          meshInputImage = await editImageWithText(image, prompt);
          referencePathLabel = "openai-edited";
        } else if (!image && prompt && prompt.trim()) {
          // Text-only → generate
          meshInputImage = await generateImageFromText(prompt);
          referencePathLabel = "openai-generated";
        }
      } catch (e) {
        if (!(e instanceof OpenAIUnavailable)) {
          console.warn(
            "[ariadne] OpenAI image step failed, continuing with raw image (or skipping if none):",
            e.message
          );
        }
      }
    }

    if (meshInputImage) {
      try {
        const { meshUrl, contentType, fileSize, requestId, sourceImageUrl } =
          await imageToMesh(meshInputImage);
        const model = {
          id: falModelId(),
          template: "fal-hunyuan3d-image",
          prompt,
          mode: "mesh-url",
          parts: [],
          meshUrl,
          meshContentType: contentType,
          meshFileSize: fileSize,
          referenceImageUrl: sourceImageUrl,
          referencePath: referencePathLabel,
          quality_preset: preset,
          generation_model: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
        };
        return {
          model,
          source: `fal-hunyuan3d-pro (${referencePathLabel}, request ${requestId})`,
        };
      } catch (e) {
        if (e instanceof FalUnavailable) {
          // Shouldn't reach here; fall through to LLM.
        } else {
          console.warn(
            "[ariadne] Fal image-to-mesh failed, falling back to LLM SCAD:",
            e.message
          );
        }
      }
    }
  }

  if (isLLMConfigured()) {
    try {
      let model;
      let label;
      if (SCAD_PRESETS.has(preset)) {
        model = await generateScadWithLLM(prompt, image, modelOverride, preset);
        label = image
          ? `anthropic-claude-scad-image (${model.generation_model})`
          : `anthropic-claude-scad (${model.generation_model})`;
      } else {
        model = await generateModelWithLLM(prompt, image, modelOverride);
        model.quality_preset = preset;
        model.mode = "parts";
        label = image
          ? `anthropic-claude-freeform-image (${model.generation_model})`
          : `anthropic-claude-freeform (${model.generation_model})`;
      }
      return { model, source: label };
    } catch (e) {
      if (!(e instanceof LLMUnavailable)) {
        console.warn(
          "[ariadne] LLM gen failed, falling back to template:",
          e.message
        );
      }
    }
  }
  const { templateId, source: routeSource } = pickTemplateByKeyword(prompt);
  const model = generateFromTemplate(templateId, prompt);
  model.mode = "parts";
  model.quality_preset = preset;
  const note = image ? " — image ignored (no API key)" : "";
  const source =
    routeSource === "keyword-default"
      ? `template:${templateId} (no keyword match — fallback${note})`
      : `template:${templateId} (${routeSource}${note})`;
  return { model, source };
}
