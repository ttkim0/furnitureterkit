// Minimalist chat sidebar for refining the current mesh in conversation.
// Each user message captures the CURRENT canvas + sends as image+text to
// /api/generate, which routes through OpenAI image-edit + Hunyuan3D. The
// new mesh replaces the current one — same flow as the lasso, just without
// the spatial highlight (the model considers the whole image).

import { useEffect, useRef, useState } from "react";

export interface ChatMessage {
  role: "user" | "assistant" | "error";
  text: string;
  // Optional thumbnail (data URL) of the canvas that was sent
  thumbnail?: string;
  ts: number;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  busy: boolean;
  elapsedMs: number;
  onSend: (text: string) => void;
  onClear: () => void;
}

export function ChatPanel({
  messages,
  busy,
  elapsedMs,
  onSend,
  onClear,
}: ChatPanelProps) {
  // Open by default — chat is a primary surface for refining the mesh. The
  // panel is docked to the LEFT (material panel owns the right), so the two
  // never collide.
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  if (!open) {
    return (
      <button
        className="chat-panel-fab"
        onClick={() => setOpen(true)}
        title="Open chat"
      >
        💬
        {messages.length > 0 && (
          <span className="chat-panel-fab-count">{messages.length}</span>
        )}
      </button>
    );
  }

  const submit = () => {
    if (!draft.trim() || busy) return;
    onSend(draft.trim());
    setDraft("");
  };

  return (
    <div className="chat-panel">
      <header className="chat-panel-header">
        <span>Chat</span>
        <div className="chat-panel-actions">
          {messages.length > 0 && (
            <button onClick={onClear} title="Clear conversation">
              clear
            </button>
          )}
          <button onClick={() => setOpen(false)} title="Collapse">
            –
          </button>
        </div>
      </header>

      <div className="chat-panel-messages" ref={listRef}>
        {messages.length === 0 && !busy && (
          <div className="chat-panel-hint">
            Talk to the model. Each message uses the current view as context
            and rebuilds the mesh. ~$0.25/turn.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg-${m.role}`}>
            {m.thumbnail && (
              <img src={m.thumbnail} alt="" className="chat-msg-thumb" />
            )}
            <div className="chat-msg-body">{m.text}</div>
          </div>
        ))}
        {busy && (
          <div className="chat-msg chat-msg-assistant pending">
            Refining mesh… ({(elapsedMs / 1000).toFixed(1)}s)
          </div>
        )}
      </div>

      <div className="chat-panel-input">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="darker walnut; add tufting; remove the back cushions…"
          rows={2}
          disabled={busy}
        />
        <button onClick={submit} disabled={!draft.trim() || busy}>
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
