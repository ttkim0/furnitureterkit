import { useState } from "react";
import type { EditCommand } from "../types";
import type { ModelPart } from "../lib/model";

interface EditPanelProps {
  selectedPart: ModelPart | null;
  onEdit: (cmd: EditCommand) => void;
  busy: boolean;
}

export function EditPanel({ selectedPart, onEdit, busy }: EditPanelProps) {
  const [text, setText] = useState("");

  if (!selectedPart) {
    return (
      <aside className="edit-panel">
        <h2>No part selected</h2>
        <p className="hint">Click any part of the model to edit it.</p>
        <p className="hint">
          Try words like <em>walnut</em>, <em>marble</em>, <em>thicker</em>,
          <em> taller</em>, <em>darker</em>.
        </p>
      </aside>
    );
  }

  const submit = () => {
    if (!text.trim() || busy) return;
    onEdit({ selected_part: selectedPart.id, edit: text.trim() });
    setText("");
  };

  return (
    <aside className="edit-panel">
      <h2>{selectedPart.label}</h2>
      <p className="part-id">
        part: <code>{selectedPart.id}</code>
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        placeholder="e.g. make it walnut, thicker and a bit darker"
        rows={5}
        disabled={busy}
      />
      <div className="edit-actions">
        <button onClick={submit} disabled={!text.trim() || busy}>
          {busy ? "Sending…" : "Send edit"}
        </button>
      </div>
    </aside>
  );
}
