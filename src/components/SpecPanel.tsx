// Main spec panel — left side of the editor when a model exists. Displays a
// "Generate spec" button until the spec arrives, then dispatches to the
// per-category form. All edits are local and exportable as JSON.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FurnitureSpec } from "../lib/spec";
import { CATEGORY_LABELS } from "../lib/spec";
import { SofaSpecForm } from "./specs/SofaSpecForm";
import { ChairSpecForm } from "./specs/ChairSpecForm";
import { TableSpecForm } from "./specs/TableSpecForm";
import { BedSpecForm } from "./specs/BedSpecForm";
import { LampSpecForm } from "./specs/LampSpecForm";
import { StorageSpecForm } from "./specs/StorageSpecForm";
import { TextField } from "./SpecFields";
import { generateCadBundle, type CadBundleResponse } from "../lib/api";
import { setCheckoutSession } from "../lib/checkoutSession";

interface SpecPanelProps {
  spec: FurnitureSpec | null;
  isGenerating: boolean;
  generateAvailable: boolean;
  onGenerate: () => void;
  onChange: (next: FurnitureSpec) => void;
  onDownload: () => void;
  onRebuildMesh: () => void;
  rebuildAvailable: boolean;
  isRebuilding: boolean;
  modelPrompt: string;
  modelId: string;
  /** URL of the generated mesh (GLB) — required to populate the review page. */
  meshUrl: string;
  /** White-background reference image fed to Hunyuan — used downstream to
   *  generate REAL lifestyle marketing photos of this exact piece. */
  sourceImageUrl?: string;
  defaultCollapsed?: boolean;
}

export function SpecPanel({
  spec,
  isGenerating,
  generateAvailable,
  onGenerate,
  onChange,
  onDownload,
  onRebuildMesh,
  rebuildAvailable,
  isRebuilding,
  modelPrompt,
  modelId,
  meshUrl,
  sourceImageUrl,
  defaultCollapsed = false,
}: SpecPanelProps) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [cadStatus, setCadStatus] = useState<
    | { kind: "idle" }
    | { kind: "generating" }
    | { kind: "ready"; result: CadBundleResponse }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handleFinalizeForManufacturing() {
    if (!spec) return;
    setCadStatus({ kind: "generating" });
    try {
      const result = await generateCadBundle(spec, undefined);
      setCadStatus({ kind: "ready", result });
      // Auto-download the ZIP
      const a = document.createElement("a");
      a.href = result.zip_url;
      a.download = `${spec.category}-${modelId.slice(-8)}-cad.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Persist the post-CAD context, then send the user to the Review
      // page. Brief delay so the download dialog appears before navigation.
      setCheckoutSession({
        modelId,
        modelPrompt,
        meshUrl,
        sourceImageUrl,
        cadZipUrl: result.zip_url,
        cadSummary: result.summary,
        spec,
      });
      setTimeout(() => navigate("/app/review"), 600);
    } catch (e) {
      setCadStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (collapsed) {
    return (
      <button className="spec-panel-collapsed" onClick={() => setCollapsed(false)} title="Open spec panel">
        Spec ›
      </button>
    );
  }

  return (
    <aside className="spec-panel">
      <header className="spec-panel-header">
        <h2>Specifications</h2>
        <button className="spec-collapse" onClick={() => setCollapsed(true)} title="Collapse">‹</button>
      </header>

      {!spec && !isGenerating && (
        <div className="spec-empty">
          <p>
            Get a manufacturer-ready spec sheet for this mesh: dimensions,
            materials, joinery hints. Editable. Exportable as JSON.
          </p>
          {generateAvailable ? (
            <button className="spec-primary-btn" onClick={onGenerate}>
              Generate spec
            </button>
          ) : (
            <p className="spec-hint">
              Spec generation needs an Anthropic API key on the server.
            </p>
          )}
        </div>
      )}

      {isGenerating && (
        <div className="spec-empty">
          <p>Generating spec from your prompt + the mesh's bounding box…</p>
          <div className="spec-spinner" />
        </div>
      )}

      {spec && (
        <div className="spec-form-wrap">
          <div className="spec-meta">
            <span className="spec-category">{CATEGORY_LABELS[spec.category]}</span>
            <span className="spec-model-id" title={modelId}>{modelId.slice(-8)}</span>
          </div>

          <div className="spec-prompt">"{modelPrompt}"</div>

          <TextField
            label="Primary material"
            value={spec.primary_material}
            onChange={(v) => onChange({ ...spec, primary_material: v })}
          />

          {spec.category === "sofa" && <SofaSpecForm spec={spec} onChange={onChange} />}
          {spec.category === "chair" && <ChairSpecForm spec={spec} onChange={onChange} />}
          {spec.category === "table" && <TableSpecForm spec={spec} onChange={onChange} />}
          {spec.category === "bed" && <BedSpecForm spec={spec} onChange={onChange} />}
          {spec.category === "lamp" && <LampSpecForm spec={spec} onChange={onChange} />}
          {spec.category === "storage" && <StorageSpecForm spec={spec} onChange={onChange} />}

          {spec.notes && (
            <div className="spec-notes">
              <label>Notes</label>
              <textarea
                value={spec.notes}
                onChange={(e) => onChange({ ...spec, notes: e.target.value })}
                rows={3}
              />
            </div>
          )}

          <div className="spec-actions">
            <button
              className="spec-primary-btn"
              onClick={onRebuildMesh}
              disabled={!rebuildAvailable || isRebuilding}
              title="Re-runs OpenAI image-edit + Hunyuan3D with the updated spec baked into the prompt. Costs ~$0.25 per rebuild."
            >
              {isRebuilding ? "Rebuilding mesh…" : "Rebuild mesh"}
            </button>
            <button
              className="spec-secondary-btn"
              onClick={onGenerate}
              disabled={isGenerating}
              title="Re-runs only the spec LLM (cheap). Does not change the mesh."
            >
              {isGenerating ? "…" : "Re-spec"}
            </button>
            <button className="spec-secondary-btn" onClick={onDownload}>
              JSON
            </button>
          </div>

          {/* Finalize for Manufacturing — produces real CAD a maker can build from */}
          <div className="spec-finalize">
            <button
              className="spec-finalize-btn"
              onClick={handleFinalizeForManufacturing}
              disabled={cadStatus.kind === "generating"}
              title="Generates a manufacturable CAD bundle: STEP file (assembled + per-part), DXF panels for CNC, cutlist CSV, and BOM. Send to your maker."
            >
              {cadStatus.kind === "generating"
                ? "Building CAD bundle…"
                : "Finalize for Manufacturing"}
            </button>
            {cadStatus.kind === "ready" && (
              <div className="spec-finalize-result">
                ✓ {cadStatus.result.summary.part_count} parts ·{" "}
                {cadStatus.result.summary.cutlist_rows} cutlist rows ·{" "}
                {(cadStatus.result.summary.zip_size_bytes / 1024).toFixed(0)} KB
                <a
                  className="spec-finalize-link"
                  href={cadStatus.result.zip_url}
                  download
                >
                  Re-download
                </a>
              </div>
            )}
            {cadStatus.kind === "error" && (
              <div className="spec-finalize-error">
                CAD generation failed: {cadStatus.message}
              </div>
            )}
            <p className="spec-finalize-hint">
              Bundle: STEP (assembled + per-part) · DXF panels for CNC ·
              cutlist CSV · BOM JSON. Open in Fusion / SolidWorks / FreeCAD /
              Rhino. Send to your maker.
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
