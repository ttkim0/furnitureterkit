import { useEffect, useRef, useState } from "react";
import { getHealth, type HealthResponse, type ImageRef } from "../lib/api";
import type { QualityPreset } from "../lib/model";

interface EntryScreenProps {
  onGenerate: (
    prompt: string,
    image?: ImageRef,
    qualityPreset?: QualityPreset
  ) => Promise<void>;
  error: string | null;
}

const FREEFORM_EXAMPLES = [
  "A modern brass floor lamp with a black conical shade",
  "A round white marble side table on three thin walnut legs",
  "A leather wing chair with brass tack accents",
  "A small bookshelf with five staggered shelves",
];

const TEMPLATE_EXAMPLES = [
  "A long walnut dining table with tapered legs",
  "A queen-size oak bed with a tall headboard",
  "A simple matte-black dining chair",
  "A brass desk lamp",
];

const PRESETS: {
  id: QualityPreset;
  title: string;
  description: string;
}[] = [
  {
    id: "max",
    title: "Max Quality",
    description:
      "Highest quality mesh and clean topology. LLM writes raw OpenSCAD with hull, loops, and high $fn. Compile may take 30s–5min.",
  },
  {
    id: "draft",
    title: "Draft",
    description:
      "Rough quality for quick iterations. LLM emits a structured part list with materials. Click parts to edit them after.",
  },
  {
    id: "textureless",
    title: "Textureless",
    description: "Faster, with simpler, textureless output.",
  },
];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function EntryScreen({ onGenerate, error }: EntryScreenProps) {
  // Pre-fill prompt from the landing-page typewriter input if present.
  const [prompt, setPrompt] = useState(() => {
    try {
      const v = sessionStorage.getItem("ariadne.landingPrompt");
      if (v) sessionStorage.removeItem("ariadne.landingPrompt");
      return v ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageRef, setImageRef] = useState<ImageRef | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [preset, setPreset] = useState<QualityPreset>("draft");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => {});
  }, []);

  const isFreeform = health?.mode === "freeform";
  const examples = isFreeform ? FREEFORM_EXAMPLES : TEMPLATE_EXAMPLES;

  const handleFile = (file: File) => {
    setImageError(null);
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) {
      setImageError(`Unsupported image type: ${file.type}`);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(
        `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB, max 8 MB.`
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) {
        setImageError("Failed to read image.");
        return;
      }
      setImagePreview(dataUrl);
      setImageRef({ mediaType: m[1], data: m[2] });
    };
    reader.onerror = () => setImageError("Failed to read image.");
    reader.readAsDataURL(file);
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const removeImage = () => {
    setImagePreview(null);
    setImageRef(null);
    setImageError(null);
  };

  const submit = async (text: string) => {
    if (busy) return;
    if (!text.trim() && !imageRef) return;
    setBusy(true);
    try {
      const finalText =
        text.trim() ||
        "Match the object in this image as faithfully as possible.";
      await onGenerate(finalText, imageRef ?? undefined, preset);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = (prompt.trim().length > 0 || imageRef !== null) && !busy;

  return (
    <div className="entry-screen">
      <div className="entry-card wider">
        <h1>Ariadne Furniture</h1>
        <p className="lede">
          Describe an object — or drop in a reference image — and we'll build
          it in 3D. Pick a quality preset before you generate.
        </p>

        {health && (
          <div
            className={`mode-badge ${
              isFreeform && health.fal_available && health.openai_available
                ? "ok"
                : "limited"
            }`}
          >
            {!isFreeform && (
              <>
                <strong>Template mode</strong> — set{" "}
                <code>ANTHROPIC_API_KEY</code> on the server. Quality presets
                are no-ops without an LLM.
              </>
            )}
            {isFreeform && (
              <>
                <strong>
                  {health.fal_available && health.openai_available
                    ? "Full photoreal pipeline"
                    : health.fal_available
                      ? "Photoreal + free-form generation"
                      : "Free-form generation"}
                </strong>
                {" — "}
                {health.fal_available && health.openai_available ? (
                  <>
                    text-only and image+text both go through OpenAI
                    (gpt-image-1) → Hunyuan3D Pro mesh. Image-only skips the
                    OpenAI step.
                  </>
                ) : health.fal_available ? (
                  <>
                    image-only routes to Hunyuan3D Pro. Set{" "}
                    <code>OPENAI_API_KEY</code> to unlock text-only and
                    image+text edits via gpt-image-1.
                  </>
                ) : (
                  <>
                    Max Quality emits raw OpenSCAD via Opus 4.7. Set{" "}
                    <code>FAL_KEY</code> + <code>OPENAI_API_KEY</code> on the
                    server for the full photoreal pipeline.
                  </>
                )}
              </>
            )}
          </div>
        )}

        <div className="quality-presets" role="radiogroup" aria-label="Quality preset">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              role="radio"
              aria-checked={preset === p.id}
              className={`quality-card ${preset === p.id ? "active" : ""}`}
              onClick={() => setPreset(p.id)}
              disabled={busy}
            >
              <div className="quality-card-title">{p.title}</div>
              <div className="quality-card-desc">{p.description}</div>
            </button>
          ))}
        </div>

        <textarea
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(prompt);
          }}
          placeholder={
            isFreeform
              ? preset === "max"
                ? "A yellow-green Roche Bobois bubble sofa with quilted spheres for the seat and back…"
                : "A small ceramic vase with three white tulips…"
              : "A long walnut dining table…"
          }
          rows={4}
          disabled={busy}
        />

        <div
          className={`image-drop ${dragActive ? "drag" : ""} ${imagePreview ? "has-image" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
        >
          {imagePreview ? (
            <div className="image-preview">
              <img src={imagePreview} alt="reference" />
              <button
                type="button"
                className="image-remove"
                onClick={removeImage}
                disabled={busy}
                title="Remove image"
              >
                ×
              </button>
              {!isFreeform && (
                <p className="image-warn">
                  Image will be ignored in template mode.
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="image-add"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              <span>+ Attach reference image</span>
              <span className="hint">
                {isFreeform
                  ? "PNG, JPG, GIF, WebP — drag here or click"
                  : "(only used when free-form generation is on)"}
              </span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={onFileInput}
            style={{ display: "none" }}
          />
        </div>
        {imageError && (
          <div className="entry-error">
            <strong>Image:</strong> {imageError}
          </div>
        )}

        <div className="entry-actions">
          <button onClick={() => submit(prompt)} disabled={!canSubmit}>
            {busy
              ? preset === "max"
                ? "Generating SCAD…"
                : "Generating…"
              : `Generate (${preset === "max" ? "Max" : preset === "draft" ? "Draft" : "Textureless"})`}
          </button>
          <span className="hint">⌘/Ctrl + Enter</span>
        </div>
        <div className="examples">
          <span className="examples-label">Try:</span>
          {examples.map((e) => (
            <button
              key={e}
              className="example-chip"
              onClick={() => submit(e)}
              disabled={busy}
            >
              {e}
            </button>
          ))}
        </div>
        {error && (
          <div className="entry-error">
            <strong>Error:</strong> {error}
          </div>
        )}
      </div>
    </div>
  );
}
