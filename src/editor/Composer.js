import React, { useEffect, useImperativeHandle, useRef, useState } from "https://esm.sh/react@18.3.1";
import Icon from "../ui/Icon.js";

const h = React.createElement;

function editorEscape(value) {
  return String(value || "").replace(/[&<>\"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[character]));
}

function clipboardFiles(data) {
  const direct = [...(data?.files || [])];
  if (direct.length) return direct;
  return [...(data?.items || [])]
    .filter(item => item?.kind === "file")
    .map(item => item.getAsFile?.())
    .filter(Boolean);
}

function composerEmojiSrc(item) {
  const url = String(item?.url || "");
  const thumb = String(item?.thumbUrl || "");
  const mime = String(item?.mimeType || item?.mimetype || "").toLowerCase();
  if (mime.includes("gif") || mime.includes("webp") || mime.includes("apng") || /\.(gif|webp|apng|avif)(?:$|\?)/i.test(url) || /\.(gif|webp|apng|avif)(?:$|\?)/i.test(thumb)) return url || thumb;
  return url || thumb;
}

function trailingEmojiQuery(before, item, query) {
  const name = String(item?.name || item?.shortcode || "").replace(/^:+|:+$/g, "").toLowerCase();
  const explicit = String(query || "").trim();
  const tail = String(before || "").match(/(:[^:\s]*|[^\s]+)$/)?.[0] || "";
  if (!tail) return "";
  // A completed :shortcode: chip is already an emoji atom. Never treat it as
  // an unfinished query, otherwise inserting the next emoji deletes the last one.
  if (/^:[^:\s]+:$/.test(tail)) return "";
  const tailBare = tail.replace(/^:+|:+$/g, "").toLowerCase();
  if (tail.startsWith(":") && (!tailBare || name.startsWith(tailBare))) return tail;
  if (explicit && tailBare === explicit.toLowerCase() && (!name || name.startsWith(tailBare) || tailBare.length <= 12)) return tail;
  if (name && tailBare && name.startsWith(tailBare) && tailBare.length <= name.length) return tail;
  return "";
}

function htmlFromPlainComposer(value, extraItems = []) {
  return String(value || "").split(/(:[^:\s]+:)/g).map(part => {
    const match = part.match(/^:([^:\s]+):$/);
    const item = match && findEmojiItem(match[1], extraItems);
    if (!item) return editorEscape(part).replace(/\n/g, "<br>");
    const token = `:${String(item.name || item.shortcode || match[1]).replace(/^:+|:+$/g, "")}:`;
    const src = composerEmojiSrc(item);
    return `<span class="composer-emoji-chip" data-emoji-chip data-token="${editorEscape(token)}" contenteditable="false"><img draggable="false" src="${editorEscape(src)}" alt="${editorEscape(item.name || token)}"></span>`;
  }).join("");
}

function readPlainComposer(node) {
  const walk = current => {
    if (!current) return "";
    if (current.nodeType === Node.TEXT_NODE) return current.nodeValue || "";
    if (current.nodeType !== Node.ELEMENT_NODE) return "";
    if (current.matches?.("[data-emoji-chip], [data-token], [data-emoji-token]")) {
      return current.getAttribute("data-token") || current.getAttribute("data-emoji-token") || "";
    }
    if (current.tagName === "BR") return "\n";
    const text = [...current.childNodes].map(walk).join("");
    if (["DIV", "P"].includes(current.tagName) && current.nextSibling) return `${text}\n`;
    return text;
  };
  return [...(node?.childNodes || [])].map(walk).join("").replace(/\u00a0/g, " ").replace(/\n$/, "");
}

function placePlainComposerCaret(node, offset) {
  if (!node) return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  let remaining = Math.max(0, Number(offset) || 0);
  const visit = current => {
    if (remaining <= 0) return true;
    if (current.nodeType === Node.TEXT_NODE) {
      const size = (current.nodeValue || "").length;
      if (remaining <= size) {
        range.setStart(current, remaining);
        range.collapse(true);
        remaining = 0;
        return true;
      }
      remaining -= size;
      return false;
    }
    if (current.nodeType === Node.ELEMENT_NODE && current.matches?.("[data-emoji-chip], [data-token], [data-emoji-token]")) {
      const token = current.getAttribute("data-token") || current.getAttribute("data-emoji-token") || "";
      if (remaining <= token.length) {
        range.setStartAfter(current);
        range.collapse(true);
        remaining = 0;
        return true;
      }
      remaining -= token.length;
      return false;
    }
    if (current.tagName === "BR") {
      if (remaining <= 1) {
        range.setStartAfter(current);
        range.collapse(true);
        remaining = 0;
        return true;
      }
      remaining -= 1;
      return false;
    }
    return [...(current.childNodes || [])].some(visit);
  };
  if (![...node.childNodes].some(visit)) {
    range.selectNodeContents(node);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

export const PlainComposer = React.forwardRef(function PlainComposer({ value, onChange, onKeyDown, onFiles, placeholder, onFocus, onBlur, enterKeyHint, minHeight, maxHeight, fill = false, onOverflowChange, emojiFallbackItems = [] }, ref) {
  const nodeRef = useRef(null);
  const overflowRef = useRef(false);
  const composingRef = useRef(false);
  const onOverflowChangeRef = useRef(onOverflowChange);
  onOverflowChangeRef.current = onOverflowChange;
  const syncSize = () => {
    const node = nodeRef.current;
    if (!node) return;
    if (fill) {
      node.style.height = "100%";
      node.style.maxHeight = "none";
      node.style.overflowY = "auto";
      return;
    }
    const min = Math.max(22, Number(minHeight) || 36);
    const cap = Math.max(min, Number(maxHeight) || 234);
    node.style.height = "0px";
    const content = node.scrollHeight;
    const next = Math.max(min, Math.min(cap, content));
    node.style.height = `${next}px`;
    node.style.maxHeight = `${cap}px`;
    const overflowing = content > cap + 1;
    node.style.overflowY = overflowing ? "auto" : "hidden";
    if (overflowRef.current !== overflowing) {
      overflowRef.current = overflowing;
      onOverflowChangeRef.current?.(overflowing);
    }
  };
  const emit = () => {
    const node = nodeRef.current;
    if (!node) return;
    const next = readPlainComposer(node);
    node.classList.toggle("is-empty", !next.trim());
    onChange?.(next, node.innerHTML);
    requestAnimationFrame(syncSize);
  };
  useEffect(() => {
    if (composingRef.current) return;
    const node = nodeRef.current;
    if (!node) return;
    if (readPlainComposer(node) === String(value || "")) {
      node.classList.toggle("is-empty", !String(value || "").trim());
      syncSize();
      return;
    }
    node.innerHTML = htmlFromPlainComposer(value, emojiFallbackItems);
    node.classList.toggle("is-empty", !String(value || "").trim());
    syncSize();
  }, [value, minHeight, maxHeight, fill, emojiFallbackItems]);
  useImperativeHandle(ref, () => ({
    focus: () => nodeRef.current?.focus(),
    blur: () => nodeRef.current?.blur(),
    getHeight: () => nodeRef.current?.offsetHeight || 0,
    syncSize,
    insertText: text => {
      const node = nodeRef.current;
      const current = readPlainComposer(node) || String(value || "");
      const next = `${current}${String(text || "")}`;
      onChange?.(next, htmlFromPlainComposer(next, [item, ...emojiFallbackItems]));
      requestAnimationFrame(() => { node?.focus(); placePlainComposerCaret(node, next.length); });
    },
    insertEmoji: (item, { query = "" } = {}) => {
      const name = String(item?.name || item?.shortcode || "表情").replace(/^:+|:+$/g, "");
      const token = `:${name}:`;
      const node = nodeRef.current;
      const current = readPlainComposer(node) || String(value || "");
      const remove = trailingEmojiQuery(current, item, query);
      const before = remove && current.endsWith(remove) ? current.slice(0, current.length - remove.length) : current;
      const next = `${before}${token} `;
      onChange?.(next, htmlFromPlainComposer(next, [item, ...emojiFallbackItems]));
      requestAnimationFrame(() => {
        node?.focus();
        placePlainComposerCaret(node, before.length + token.length + 1);
        syncSize();
      });
      return true;
    },
    clear: () => onChange?.("", ""),
  }), [value, onChange, minHeight, maxHeight, fill, emojiFallbackItems]);
  return h("div", {
    ref: nodeRef,
    className: `rich-editor plain-composer${String(value || "").trim() ? "" : " is-empty"}`,
    contentEditable: "true",
    role: "textbox",
    "aria-multiline": "true",
    "aria-label": placeholder,
    "data-placeholder": placeholder || "",
    enterKeyHint: enterKeyHint || "enter",
    suppressContentEditableWarning: true,
    onInput: () => { if (!composingRef.current) emit(); },
    onCompositionStart: () => { composingRef.current = true; },
    onCompositionEnd: () => { composingRef.current = false; emit(); },
    onFocus: () => onFocus?.(),
    onBlur: () => onBlur?.(),
    onKeyDown: event => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing) {
        if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 900px), (pointer: coarse)")?.matches) {
          event.preventDefault();
          document.execCommand("insertLineBreak");
          emit();
          return;
        }
      }
      onKeyDown?.(event);
    },
    onPaste: event => {
      const files = clipboardFiles(event.clipboardData);
      if (files.length) {
        event.preventDefault();
        event.stopPropagation();
        onFiles?.(files);
        return;
      }
      const text = event.clipboardData?.getData?.("text/plain");
      if (text == null) return;
      event.preventDefault();
      document.execCommand("insertText", false, text);
      emit();
    },
    onDragOver: event => { event.preventDefault(); event.currentTarget.classList.add("drag-active"); },
    onDragLeave: event => event.currentTarget.classList.remove("drag-active"),
    onDrop: event => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.classList.remove("drag-active");
      const files = [...(event.dataTransfer?.files || [])];
      if (files.length) onFiles?.(files);
    },
  });
});

function editorLeafText(node) {
  if (node?.type?.name === "orbitEmoji") return node.attrs?.token || `:${node.attrs?.name || "表情"}:`;
  if (node?.type?.name === "hardBreak") return "\n";
  return "";
}

function editorQueryLeafText(node) {
  if (node?.type?.name === "orbitEmoji") return "\uFFFC";
  if (node?.type?.name === "hardBreak") return "\n";
  return "";
}

function serializeEditorText(editor) {
  if (!editor) return "";
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, "", editorLeafText);
}

function findEmojiItem(name, extraItems = []) {
  const needle = String(name || "").replace(/^:+|:+$/g, "").trim().toLowerCase();
  if (!needle) return null;
  return [...(window.orbitEmojiItems || []), ...(extraItems || [])].find(entry =>
    String(entry?.name || "").trim().toLowerCase() === needle
    || String(entry?.shortcode || "").replace(/^:+|:+$/g, "").trim().toLowerCase() === needle
  ) || null;
}

function emojiAttrsFromElement(element) {
  const image = element?.tagName === "IMG" ? element : element?.querySelector?.("img");
  const token = String(element?.getAttribute?.("data-emoji-token") || image?.getAttribute?.("data-emoji-token") || "").trim();
  const alt = String(image?.getAttribute?.("alt") || image?.getAttribute?.("title") || element?.getAttribute?.("data-alt") || "").replace(/^:+|:+$/g, "").trim();
  const name = alt || token.replace(/^:+|:+$/g, "") || "表情";
  return {
    token: token || `:${name}:`,
    name,
    src: image?.getAttribute?.("src") || element?.getAttribute?.("data-src") || "",
    mxc: element?.getAttribute?.("data-mxc") || image?.getAttribute?.("data-mxc") || "",
  };
}

function textToEditorHtml(text, extraItems = []) {
  const source = String(text || "").replace(/:K歌:/gi, "");
  const html = source.split(/(:[^:\s]+:)/g).map(part => {
    const match = part.match(/^:([^:\s]+):$/);
    const item = match && findEmojiItem(match[1], extraItems);
    if (!item) return editorEscape(part).replace(/\n/g, "<br>");
    const token = `:${String(item.name || item.shortcode || match[1]).replace(/^:+|:+$/g, "")}:`;
    const src = composerEmojiSrc(item);
    return `<span class="editor-emoji-chip" data-emoji-token="${editorEscape(token)}" data-mxc="${editorEscape(item.mxc || "")}" contenteditable="false"><img draggable="false" src="${editorEscape(src)}" alt="${editorEscape(item.name || token)}"><span class="editor-emoji-label">${editorEscape(item.name || token)}</span></span>`;
  }).join("");
  if (!html) return "";
  return `<p>${html}</p>`;
}

function flattenPastedHtml(html) {
  return String(html || "")
    .replace(/<br\b[^>]*class\s*=\s*(["'])[^"']*ProseMirror-trailingBreak[^"']*\1[^>]*>/gi, "")
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote)>\s*<(?:p|div|h[1-6]|li|blockquote)(?:\s[^>]*)?>/gi, "<br>")
    .replace(/<\/?(?:p|div)(?:\s[^>]*)?>/gi, "");
}

export const HaloComposer = React.forwardRef(function HaloComposer({ value, onChange, onKeyDown, onFiles, placeholder, toolbarExtra, emojiFallbackItems = [], hideToolbar = false, onFocus, onBlur, enterKeyHint }, ref) {
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  const lastEmittedRef = useRef(String(value || ""));
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const fallbackRef = useRef(emojiFallbackItems);
  const onFocusRef = useRef(onFocus);
  const onBlurRef = useRef(onBlur);
  const enterKeyHintRef = useRef(enterKeyHint);
  valueRef.current = value;
  onChangeRef.current = onChange;
  fallbackRef.current = emojiFallbackItems;
  onFocusRef.current = onFocus;
  onBlurRef.current = onBlur;
  enterKeyHintRef.current = enterKeyHint;
  const [, setEditorVersion] = useState(0);
  const [fontSize, setFontSize] = useState("16px");
  const [failed, setFailed] = useState(false);

  const htmlFromText = text => textToEditorHtml(text, fallbackRef.current);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [{ Editor, Mark, Node, mergeAttributes }, { StarterKit }, { Placeholder }, { Underline }, { Link }, { TextStyle }, { Color }] = await Promise.all([
          import("https://cdn.jsdelivr.net/npm/@tiptap/core@2.11.5/+esm"),
          import("https://cdn.jsdelivr.net/npm/@tiptap/starter-kit@2.11.5/+esm"),
          import("https://cdn.jsdelivr.net/npm/@tiptap/extension-placeholder@2.11.5/+esm"),
          import("https://cdn.jsdelivr.net/npm/@tiptap/extension-underline@2.11.5/+esm"),
          import("https://cdn.jsdelivr.net/npm/@tiptap/extension-link@2.11.5/+esm"),
          import("https://cdn.jsdelivr.net/npm/@tiptap/extension-text-style@2.11.5/+esm"),
          import("https://cdn.jsdelivr.net/npm/@tiptap/extension-color@2.11.5/+esm"),
        ]);
        if (!active || !hostRef.current) return;
        const FontSize = Mark.create({ name: "fontSize", addAttributes: () => ({ fontSize: { default: null, parseHTML: element => element.style.fontSize || null, renderHTML: attributes => attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {} } }), parseHTML: [{ style: "font-size" }], renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes), 0], addCommands: () => ({ setFontSize: fontSize => ({ chain }) => chain().setMark("fontSize", { fontSize }).run() }) });
        const OrbitEmoji = Node.create({
          name: "orbitEmoji", inline: true, group: "inline", atom: true, selectable: true, draggable: true,
          addAttributes: () => ({ token: { default: ":表情:" }, name: { default: "表情" }, src: { default: "" }, mxc: { default: "" } }),
          parseHTML: () => [
            { tag: "span[data-emoji-token]", getAttrs: element => emojiAttrsFromElement(element) },
            { tag: "span.editor-emoji-chip", getAttrs: element => emojiAttrsFromElement(element) },
            { tag: "img[data-mx-emoticon]", getAttrs: element => emojiAttrsFromElement(element) },
            { tag: "img[data-emoji-token]", getAttrs: element => emojiAttrsFromElement(element) },
          ],
          renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "editor-emoji-chip", "data-emoji-token": node.attrs.token, "data-mxc": node.attrs.mxc || undefined, contenteditable: "false", draggable: "true" }), ["img", { src: node.attrs.src || "", alt: node.attrs.name || node.attrs.token, draggable: "false" }], ["span", { class: "editor-emoji-label" }, node.attrs.name || node.attrs.token]],
          renderText: ({ node }) => node.attrs.token || `:${node.attrs.name || "表情"}:`,
        });
        const editor = new Editor({
          element: hostRef.current,
          content: htmlFromText(valueRef.current),
          extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: true }), OrbitEmoji, Underline, TextStyle, Color.configure({ types: ["textStyle"] }), FontSize, Link.configure({ openOnClick: false, defaultProtocol: "https" }), Placeholder.configure({ placeholder: placeholder || "输入消息…" })],
          editorProps: {
            attributes: {
              enterkeyhint: enterKeyHintRef.current || "enter",
              inputmode: "text",
              "aria-multiline": "true",
            },
            transformPastedHTML: html => flattenPastedHtml(html),
            handleKeyDown: (_view, event) => {
              if (event.isComposing || event.keyCode === 229) return false;
              if (enterKeyHintRef.current === "enter" && (event.key === "Enter" || event.key === "NumpadEnter")) {
                event.preventDefault();
                event.stopPropagation();
                editor.commands.setHardBreak();
                return true;
              }
              return false;
            },
          },
          onUpdate: ({ editor: current }) => {
            const text = serializeEditorText(current);
            lastEmittedRef.current = text;
            setEditorVersion(version => version + 1);
            onChangeRef.current?.(text, current.getHTML());
          },
          onSelectionUpdate: () => setEditorVersion(version => version + 1),
          onFocus: () => onFocusRef.current?.(),
          onBlur: () => onBlurRef.current?.(),
        });
        editor.view?.dom?.setAttribute?.("enterkeyhint", enterKeyHintRef.current || "enter");
        editorRef.current = editor;
        const currentValue = String(valueRef.current || "");
        lastEmittedRef.current = currentValue;
        if (currentValue.trim()) editor.commands.setContent(htmlFromText(currentValue), false);
        else editor.commands.clearContent(false);
      } catch (error) {
        window.__haloEditorError = String(error?.stack || error?.message || error);
        setFailed(true);
      }
    })();
    return () => { active = false; editorRef.current?.destroy?.(); editorRef.current = null; };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const next = String(value || "");
    if (!next.trim()) {
      lastEmittedRef.current = "";
      if (serializeEditorText(editor).trim()) editor.commands.clearContent(false);
      return;
    }
    if (next === lastEmittedRef.current) return;
    lastEmittedRef.current = next;
    editor.commands.setContent(htmlFromText(next), false);
  }, [value]);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.chain().focus().run() || hostRef.current?.focus(),
    blur: () => editorRef.current?.commands.blur() || hostRef.current?.blur?.(),
    setContent: text => {
      const editor = editorRef.current;
      if (!editor) return false;
      const next = String(text || "");
      lastEmittedRef.current = next;
      editor.commands.setContent(htmlFromText(next), false);
      return true;
    },
    insertText: text => { const editor = editorRef.current; if (editor) editor.chain().focus().insertContent(String(text || "")).run(); else onChange?.(`${String(value || "")}${String(text || "")}`, ""); },
    insertEmoji: (item, { replaceQuery = true, query = "", mxc = "" } = {}) => {
      const editor = editorRef.current;
      if (!editor || !item) return false;
      const name = String(item.name || item.shortcode || "表情").replace(/^:+|:+$/g, "");
      const token = `:${name}:`;
      const src = composerEmojiSrc(item);
      let from = editor.state.selection.from;
      let to = editor.state.selection.to;
      if (replaceQuery && from === to) {
        // Measure only the text immediately before the caret. Emoji atoms are
        // replaced with a single placeholder so a previous :shortcode: cannot
        // be mistaken for an unfinished query, and string length stays aligned
        // with ProseMirror positions.
        const before = editor.state.doc.textBetween(0, from, "\n", editorQueryLeafText).replace(/\uFFFC/g, " ");
        const remove = trailingEmojiQuery(before, item, query);
        if (remove) {
          const start = editor.state.selection.$from.start();
          from = Math.max(start, from - remove.length);
        }
      }
      const chain = editor.chain().focus();
      if (from < to) chain.deleteRange({ from, to });
      chain.insertContent({ type: "orbitEmoji", attrs: { token, name, src, mxc } }).insertContent(" ").run();
      return true;
    },
    clear: () => {
      lastEmittedRef.current = "";
      editorRef.current?.commands.clearContent(false);
      onChange?.("", "");
    },
  }));

  if (failed) return h(PlainComposer, { ref, value, onChange, onKeyDown, onFiles, placeholder, onFocus, onBlur, enterKeyHint });
  const actions = [["粗体", "toggleBold", "bold"], ["斜体", "toggleItalic", "italic"], ["下划线", "toggleUnderline", "underline"], ["删除线", "toggleStrike", "strike"], ["字体大小", "setFontSize", "fontSize"]];
  const actionIcons = { bold: "bold", italic: "italic", underline: "underline", strike: "strike", fontSize: "fontSize" };
  const runFormat = (command, attrs) => {
    const editor = editorRef.current;
    if (!editor) return;
    const chain = editor.chain().focus();
    if (command === "clearFormatting") { chain.unsetAllMarks().clearNodes().run(); setEditorVersion(version => version + 1); return; }
    if (command === "setColor") { chain.setColor("#1677ff").run(); setEditorVersion(version => version + 1); return; }
    if (command === "setFontSize") { const sizes = ["14px", "16px", "20px"]; const next = sizes[(sizes.indexOf(fontSize) + 1) % sizes.length]; setFontSize(next); chain.setFontSize(next).run(); setEditorVersion(version => version + 1); return; }
    if (typeof chain[command] !== "function") return;
    chain[command](attrs).run();
    setEditorVersion(version => version + 1);
  };
  return h("div", { className: hideToolbar ? "halo-composer-shell is-compact" : "halo-composer-shell", onFocus: () => onFocusRef.current?.() },
    h("div", { ref: hostRef, className: "halo-editor-surface", onKeyDown, onPaste: event => {
      const files = clipboardFiles(event.clipboardData);
      if (files.length) { event.preventDefault(); event.stopPropagation(); onFiles?.(files); }
    } }),
    hideToolbar ? null : h("div", { className: "halo-editor-toolbar" },
      h("div", { className: "halo-editor-format-actions" }, actions.map(([title, command, mark], index) => h(React.Fragment, { key: `${command}-${mark}` }, index === 6 ? h("span", { className: "toolbar-divider", "aria-hidden": "true" }) : null,
        h("button", { type: "button", className: editorRef.current?.isActive?.(mark.startsWith("heading") ? "heading" : mark) ? "is-active" : "", title: mark === "fontSize" ? `${title}：${fontSize}` : title, "aria-label": title, onMouseDown: event => event.preventDefault(), onClick: () => runFormat(command, command === "toggleHeading" ? { level: Number(mark.slice(-1)) } : undefined) }, h(Icon, { name: actionIcons[mark], size: 18 }))))),
      toolbarExtra && h("div", { className: "halo-editor-extra-actions" }, toolbarExtra)
    )
  );
});
