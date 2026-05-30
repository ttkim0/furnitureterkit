// Iframe preload script — injected into every storefront iframe.
//
// Inspired by onlook's preload approach (Apache 2.0). Onlook runs inside
// a Next.js dev server and persists edits back to source files; we just
// render static HTML inside a sandboxed iframe and persist edits as JSON
// override diffs. So this is a much smaller version of the same idea.
//
// What it does:
//   • Tags every meaningful element with a stable `data-aid="..."` ID
//   • Exposes a postMessage RPC (parent ↔ iframe):
//       - parent → iframe: { type: 'editor:enable' } | 'editor:disable'
//                          { type: 'editor:apply-overrides', overrides }
//                          { type: 'editor:set-style', aid, style }
//                          { type: 'editor:set-text', aid, text }
//                          { type: 'editor:start-edit-text', aid }
//                          { type: 'editor:stop-edit-text', aid }
//       - iframe → parent: { type: 'editor:ready', tree: LayerNode[] }
//                          { type: 'editor:hover', aid, rect, tagName }
//                          { type: 'editor:select', aid, rect, tagName, text, computedStyle }
//                          { type: 'editor:text-changed', aid, text }
//   • Manages a single injected <style id="ariadne-overrides"> stylesheet
//   • Applies override diffs on load (so visitors see saved edits without
//     re-running Claude)
//
// Because Vite can't embed a TypeScript file as a string at build time
// without effort, we keep this as a function that returns the script
// source. Inserted into the iframe's srcDoc <head> by storefrontRender.
//
// SECURITY: this runs inside the sandboxed iframe. It has no access to
// the parent's auth, localStorage, or cookies. All commands come via
// postMessage; the parent validates origin.

export interface VisualOverrides {
  text?: Record<string, string>;
  style?: Record<string, Record<string, string>>;
}

/**
 * Returns the script source that should be injected at the bottom of <head>
 * (or just before </body>) in every storefront iframe. The script is
 * inlined — no external requests, no dependencies.
 *
 * @param initialOverrides Saved overrides to apply on load.
 * @param parentOrigin     The expected window.parent.origin for postMessage validation.
 * @returns Source code as a string ready to drop into a <script> tag.
 */
export function buildVisualEditorScript(
  initialOverrides: VisualOverrides = {},
  parentOrigin = "*"
): string {
  // Inline as a stringified function. The IIFE pattern keeps the global
  // namespace clean. `__INITIAL_OVERRIDES__` and `__PARENT_ORIGIN__` are
  // substituted below.
  const body = `
(function() {
  if (window.__ariadneEditor) return; // double-load guard
  var initialOverrides = __INITIAL_OVERRIDES__;
  var PARENT_ORIGIN = __PARENT_ORIGIN__;
  var STYLE_ID = "ariadne-overrides-runtime";
  var enabled = false;
  var editingAid = null;

  // ── Stable ID assignment ───────────────────────────────────────────
  // We give every meaningful element a stable data-aid so edits survive
  // re-renders. The ID is computed from a tree path so it's deterministic
  // for any given generated HTML.
  var seq = 0;
  function assignIds(root) {
    var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, META: 1, LINK: 1, NOSCRIPT: 1, BASE: 1, TITLE: 1, HEAD: 1 };
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function(node) {
        if (SKIP_TAGS[node.tagName]) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var el = walker.currentNode;
    while (el) {
      if (!el.hasAttribute("data-aid")) {
        el.setAttribute("data-aid", "a" + (++seq).toString(36));
      }
      el = walker.nextNode();
    }
  }

  // ── Override application ───────────────────────────────────────────
  function ensureStylesheet() {
    var st = document.getElementById(STYLE_ID);
    if (!st) {
      st = document.createElement("style");
      st.id = STYLE_ID;
      document.head.appendChild(st);
    }
    return st;
  }

  function buildStyleRules(styleOverrides) {
    if (!styleOverrides) return "";
    var rules = [];
    for (var aid in styleOverrides) {
      var decls = styleOverrides[aid];
      var declStr = Object.keys(decls).map(function(k) {
        return k + ": " + decls[k] + " !important";
      }).join("; ");
      rules.push('[data-aid="' + aid + '"] { ' + declStr + ' }');
    }
    return rules.join("\\n");
  }

  function applyTextOverrides(textOverrides) {
    if (!textOverrides) return;
    for (var aid in textOverrides) {
      var el = document.querySelector('[data-aid="' + aid + '"]');
      if (el) {
        // Only replace if this is a leaf-ish text element. Heuristic:
        // children must be text nodes only.
        var hasElementChildren = false;
        for (var c = 0; c < el.childNodes.length; c++) {
          if (el.childNodes[c].nodeType === 1) { hasElementChildren = true; break; }
        }
        if (!hasElementChildren) {
          el.textContent = textOverrides[aid];
        }
      }
    }
  }

  function applyOverrides(overrides) {
    var st = ensureStylesheet();
    st.textContent = buildStyleRules(overrides.style || {});
    applyTextOverrides(overrides.text || {});
  }

  // ── RPC: send → parent ─────────────────────────────────────────────
  function send(payload) {
    try { window.parent.postMessage(payload, PARENT_ORIGIN); } catch (e) {}
  }

  function rectFor(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  function payloadForSelection(el) {
    var cs = getComputedStyle(el);
    return {
      type: "editor:select",
      aid: el.getAttribute("data-aid"),
      tagName: el.tagName.toLowerCase(),
      text: (function() {
        var hasEl = false;
        for (var c = 0; c < el.childNodes.length; c++) {
          if (el.childNodes[c].nodeType === 1) { hasEl = true; break; }
        }
        return hasEl ? null : el.textContent || "";
      })(),
      rect: rectFor(el),
      computedStyle: {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        textAlign: cs.textAlign,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        padding: cs.padding,
        margin: cs.margin,
        borderRadius: cs.borderRadius,
        display: cs.display,
      },
    };
  }

  function findEditableTarget(target) {
    var el = target;
    while (el && el !== document.body) {
      if (el.hasAttribute && el.hasAttribute("data-aid")) {
        // Skip the platform-rendered product cards inside .ariadne-product-grid;
        // those are managed by the platform, not freely editable.
        if (el.closest(".ariadne-product-card")) return null;
        return el;
      }
      el = el.parentNode;
    }
    return null;
  }

  // ── Editor mode: hover + click handlers ────────────────────────────
  function onMove(e) {
    if (!enabled) return;
    if (editingAid) return;
    var el = findEditableTarget(e.target);
    if (!el) return;
    send({ type: "editor:hover", aid: el.getAttribute("data-aid"), rect: rectFor(el), tagName: el.tagName.toLowerCase() });
  }

  function onClick(e) {
    if (!enabled) return;
    var el = findEditableTarget(e.target);
    if (!el) return;
    // Intercept link navigation in editor mode so clicking a link doesn't
    // navigate away mid-edit.
    e.preventDefault();
    e.stopPropagation();
    send(payloadForSelection(el));
  }

  function onScrollOrResize() {
    if (!enabled) return;
    // Tell parent positions changed so its overlay can re-measure.
    send({ type: "editor:viewport-change" });
  }

  // ── Text editing ───────────────────────────────────────────────────
  function startEditText(aid) {
    var el = document.querySelector('[data-aid="' + aid + '"]');
    if (!el) return;
    editingAid = aid;
    el.setAttribute("contenteditable", "true");
    el.setAttribute("data-ariadne-editing", "true");
    el.focus();
    // Place caret at end
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      var sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    } catch (e) {}
    el.addEventListener("input", onTextInput);
    el.addEventListener("blur", onTextBlur);
    el.addEventListener("keydown", onTextKeydown);
  }
  function stopEditText(aid) {
    var el = document.querySelector('[data-aid="' + aid + '"]');
    if (!el) return;
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-ariadne-editing");
    el.removeEventListener("input", onTextInput);
    el.removeEventListener("blur", onTextBlur);
    el.removeEventListener("keydown", onTextKeydown);
    editingAid = null;
  }
  function onTextInput(e) {
    send({ type: "editor:text-changed", aid: editingAid, text: e.target.textContent });
  }
  function onTextBlur() {
    if (editingAid) {
      send({ type: "editor:text-edit-done", aid: editingAid });
      stopEditText(editingAid);
    }
  }
  function onTextKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.target.blur();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.target.blur();
    }
  }

  // ── RPC: receive ← parent ──────────────────────────────────────────
  window.addEventListener("message", function(ev) {
    var msg = ev.data;
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "editor:enable":
        enabled = true;
        document.body.setAttribute("data-ariadne-editor", "on");
        break;
      case "editor:disable":
        enabled = false;
        document.body.removeAttribute("data-ariadne-editor");
        if (editingAid) stopEditText(editingAid);
        break;
      case "editor:apply-overrides":
        applyOverrides(msg.overrides || {});
        break;
      case "editor:set-style":
        applyOverrides({ style: { [msg.aid]: msg.style } });
        break;
      case "editor:set-text":
        applyOverrides({ text: { [msg.aid]: msg.text } });
        break;
      case "editor:start-edit-text":
        startEditText(msg.aid);
        break;
      case "editor:stop-edit-text":
        stopEditText(msg.aid);
        break;
      case "editor:request-element": {
        var el = document.querySelector('[data-aid="' + msg.aid + '"]');
        if (el) send(payloadForSelection(el));
        break;
      }
    }
  });

  // ── Boot ──────────────────────────────────────────────────────────
  function boot() {
    assignIds(document.body);
    applyOverrides(initialOverrides);
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    // Re-assign on dynamic insertions (Claude's pages sometimes use scripts).
    var mo = new MutationObserver(function() { assignIds(document.body); });
    mo.observe(document.body, { childList: true, subtree: true });
    send({ type: "editor:ready" });
  }
  window.__ariadneEditor = { boot: boot };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
`.trim();

  return body
    .replace("__INITIAL_OVERRIDES__", JSON.stringify(initialOverrides))
    .replace("__PARENT_ORIGIN__", JSON.stringify(parentOrigin));
}

/** Wrap the script in a <script> tag for injection into srcDoc. */
export function buildVisualEditorTag(initialOverrides: VisualOverrides = {}): string {
  return `<script>${buildVisualEditorScript(initialOverrides, "*")}</script>`;
}
