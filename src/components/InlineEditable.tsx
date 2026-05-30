// Inline editing primitives — "click anywhere to edit" on the live storefront.
//
// When `editable=true` (only true when the logged-in user owns the store),
// the text becomes click-to-edit: clicking swaps to a textarea/input,
// blurring (or pressing Cmd+Enter) saves via the provided onSave callback.
// Optimistic update: the new value renders immediately; on save-failure
// the old value is restored and an error toast briefly shows.
//
// Visual affordance: when editable, a subtle hover ring appears so the
// owner knows what's clickable. To non-owners it renders as plain text
// with zero affordance.

import { createElement, useEffect, useRef, useState } from "react";

type EditableTag = "div" | "span" | "p" | "h1" | "h2" | "h3";

interface InlineEditableProps {
  value: string;
  editable: boolean;
  onSave: (next: string) => Promise<void>;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  as?: EditableTag;
  maxLength?: number;
}

export function InlineEditable({
  value,
  editable,
  onSave,
  multiline = false,
  placeholder = "Click to edit…",
  className = "",
  as = "div",
  maxLength,
}: InlineEditableProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      // Place cursor at end
      const el = inputRef.current as HTMLInputElement | HTMLTextAreaElement;
      const len = el.value.length;
      try { el.setSelectionRange(len, len); } catch {}
    }
  }, [editing]);

  // Toast timer
  useEffect(() => {
    if (!saveError) return;
    const t = setTimeout(() => setSaveError(null), 3500);
    return () => clearTimeout(t);
  }, [saveError]);

  async function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next === value) return;
    setOptimistic(next);
    try {
      await onSave(next);
      setOptimistic(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "save failed");
      setOptimistic(null);
      setDraft(value);
    }
  }

  function cancel() {
    setEditing(false);
    setDraft(value);
  }

  const display = optimistic ?? value;

  if (!editable) {
    return createElement(as, { className }, display || placeholder);
  }

  if (editing) {
    const sharedProps = {
      ref: inputRef as React.RefObject<HTMLInputElement & HTMLTextAreaElement>,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void commit();
        }
        if (!multiline && e.key === "Enter") {
          e.preventDefault();
          void commit();
        }
      },
      maxLength,
      className: `${className} inline-edit-active`,
    };
    return multiline
      ? <textarea rows={4} {...sharedProps} />
      : <input type="text" {...sharedProps} />;
  }

  return (
    <>
      {createElement(
        as,
        {
          className: `${className} inline-edit-affordance`,
          onClick: () => setEditing(true),
          title: "Click to edit",
        },
        display || <span className="inline-edit-placeholder">{placeholder}</span>
      )}
      {saveError && (
        <div className="inline-edit-toast">Could not save: {saveError}</div>
      )}
    </>
  );
}
