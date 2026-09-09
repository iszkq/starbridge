import React, { useEffect, useImperativeHandle, useRef, useState } from "https://esm.sh/react@18.3.1";
import Icon from "../ui/Icon.js";

const h = React.createElement;

function editorEscape(value) {
  return String(value || "").replace(/[&<>\"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[character]));
}

function editorEmojiHtml(value) {
  const catalog = Array.isArray(window.orbitEmojiItems) ? window.orbitEmojiItems : [];
  const byName = new Map();
  catalog.forEach(item => {
    const name = String(item?.name || "").trim().toLowerCase();
    const shortcode = String(item?.shortcode || "").replace(/^:+|:+$/g, "").trim().toLowerCase();
    if (name) byName.set(name, item);
    if (shortcode) byName.set(shortcode, item);
  });
  return String(value || "").split(/(:[^:\s]+:)/g).map(part => {
    const match = part.match(/^:([^:\s]+):$/);
    const item = match && byName.get(match[1].toLowerCase());
    if (!item) return editorEscape(part).replace(/\n/g, "<br>");
    const token = `:${String(item.name || match[1]).replace(/^:+|:+$/g, "")}:`;
    const src = item.thumbUrl || item.url || "";
    return `<span data-emoji-chip data-token="${editorEscape(token)}" data-src="${editorEscape(src)}" data-alt="${editorEscape(item.name || match[1])}"></span>`;
  }).join("");
}

function clipboardFiles(data) {
  const direct = [...(data?.files || [])];
  if (direct.length) return direct;
  return [...(data?.items || [])]
    .filter(item => item?.kind === "file")
    .map(item => item.getAsFile?.())
    .filter(Boolean);
}

export const PlainComposer = React.forwardRef(function PlainComposer({ value, onChange, onKeyDown, onFiles, placeholder }, ref) {
  const nodeRef = useRef(null);
  useImperativeHandle(ref, () => ({
    focus: () => nodeRef.current?.focus(),
    insertText: text => {
      const node = nodeRef.current;
      if (!node) return;
      const start = node.selectionStart ?? String(value || "").length;
      const next = `${String(value || "").slice(0, start)}${String(text || "")}${String(value || "").slice(node.selectionEnd ?? start)}`;
      onChange?.(next, "");
      requestAnimationFrame(() => { node.focus(); const cursor = start + String(text || "").length; node.setSelectionRange(cursor, cursor); });
    },
    clear: () => onChange?.("", ""),
  }));
  return h("textarea", {
    ref: nodeRef,
    className: "rich-editor plain-composer",
    value: String(value || ""),
    placeholder,
    "aria-label": placeholder,
    rows: 1,
    autoComplete: "off",
    spellCheck: false,
    onChange: event => onChange?.(event.currentTarget.value),
    onKeyDown,
    onPaste: event => {
      const files = clipboardFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      onFiles?.(files);
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

export const HaloComposer = React.forwardRef(function HaloComposer({ value, onChange, onKeyDown, onFiles, placeholder, toolbarExtra, emojiFallbackItems = [] }, ref) {
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  const [, setEditorVersion] = useState(0);
  const [fontSize, setFontSize] = useState("16px");
  const [failed, setFailed] = useState(false);
  const emojiHtmlRef = useRef(text => String(text || ""));

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
          parseHTML: () => [{ tag: "span[data-emoji-token]", getAttrs: element => ({ token: element.getAttribute("data-emoji-token") || ":表情:", name: element.querySelector("img")?.getAttribute("alt") || element.getAttribute("data-emoji-token") || "表情", src: element.querySelector("img")?.getAttribute("src") || "", mxc: element.getAttribute("data-mxc") || "" }) }],
          renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "editor-emoji-chip", "data-emoji-token": node.attrs.token, "data-mxc": node.attrs.mxc || undefined, contenteditable: "false", draggable: "true" }), ["img", { src: node.attrs.src || "", alt: node.attrs.name || node.attrs.token, draggable: "false" }], ["span", {}, node.attrs.name || node.attrs.token]],
          renderText: ({ node }) => node.attrs.token || `:${node.attrs.name || "表情"}:`,
        });
        const emojiHtml = text => String(text || "").replace(/:K歌:/gi, "").split(/(:[^:\s]+:)/g).map(part => {
          const name = part.replace(/^:+|:+$/g, "").trim().toLowerCase();
          const item = [...(window.orbitEmojiItems || []), ...emojiFallbackItems].find(entry => String(entry?.name || "").trim().toLowerCase() === name || String(entry?.shortcode || "").replace(/^:+|:+$/g, "").trim().toLowerCase() === name);
          if (!item) return String(part).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
          const token = `:${String(item.name || item.shortcode || "表情").replace(/^:+|:+$/g, "")}:`;
          const src = item.thumbUrl || item.url || "";
          return `<span class="editor-emoji-chip" data-emoji-token="${token}" data-mxc="${editorEscape(item.mxc || "")}" contenteditable="false"><img draggable="false" src="${src}" alt="${item.name || token}"><span>${item.name || token}</span></span>`;
        }).join("");
        emojiHtmlRef.current = emojiHtml;
        const serializeEditorText = current => current.state.doc.textBetween(0, current.state.doc.content.size, "\n", node => node.type?.name === "orbitEmoji" ? (node.attrs?.token || ":表情:") : "");
        const editor = new Editor({
          element: hostRef.current,
          content: emojiHtml(value),
          extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: true }), OrbitEmoji, Underline, TextStyle, Color.configure({ types: ["textStyle"] }), FontSize, Link.configure({ openOnClick: false, defaultProtocol: "https" }), Placeholder.configure({ placeholder: placeholder || "输入消息…" })],
          onUpdate: ({ editor: current }) => { setEditorVersion(version => version + 1); onChange?.(serializeEditorText(current), current.getHTML()); },
          onSelectionUpdate: () => setEditorVersion(version => version + 1),
        });
        editorRef.current = editor;
        // Never inherit a browser-restored editor subtree when the React
        // draft is empty. A fresh room composer must start blank.
        if (!String(value || "").trim()) {
          requestAnimationFrame(() => {
            if (active && editorRef.current === editor) editor.commands.clearContent(false);
          });
        }
      } catch (error) {
        window.__haloEditorError = String(error?.stack || error?.message || error);
        setFailed(true);
      }
    })();
    return () => { active = false; editorRef.current?.destroy?.(); editorRef.current = null; };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    const buildEmojiHtml = text => String(text || "").split(/(:[^:\s]+:)/g).map(part => {
      const name = part.replace(/^:+|:+$/g, "").trim().toLowerCase();
      const item = [...(window.orbitEmojiItems || []), ...emojiFallbackItems].find(entry => String(entry?.name || "").trim().toLowerCase() === name || String(entry?.shortcode || "").replace(/^:+|:+$/g, "").trim().toLowerCase() === name);
      if (!item) return String(part).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      const token = `:${String(item.name || item.shortcode || "表情").replace(/^:+|:+$/g, "")}:`;
      const src = item.thumbUrl || item.url || "";
      return `<span class="editor-emoji-chip" data-emoji-token="${token}" data-mxc="${editorEscape(item.mxc || "")}" contenteditable="false"><img draggable="false" src="${src}" alt="${item.name || token}"><span>${item.name || token}</span></span>`;
    }).join("");
    emojiHtmlRef.current = buildEmojiHtml;
    if (editor && String(value || "") !== editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", node => node.type?.name === "orbitEmoji" ? (node.attrs?.token || ":表情:") : "")) {
      editor.commands.setContent(buildEmojiHtml(String(value || "")), false);
    }
  }, [value, emojiFallbackItems]);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.chain().focus().run() || hostRef.current?.focus(),
    setContent: text => {
      const editor = editorRef.current;
      if (!editor) return false;
      editor.commands.setContent(emojiHtmlRef.current(String(text || "").replace(/:K歌:/gi, "")), false);
      return true;
    },
    insertText: text => { const editor = editorRef.current; if (editor) editor.chain().focus().insertContent(String(text || "")).run(); else onChange?.(`${String(value || "")}${String(text || "")}`, ""); },
    insertEmoji: (item, { replaceQuery = true, query = "", mxc = "" } = {}) => {
      const editor = editorRef.current;
      if (!editor || !item) return false;
      const name = String(item.name || item.shortcode || "表情").replace(/^:+|:+$/g, "");
      const token = `:${name}:`;
      const src = item.thumbUrl || item.url || "";
      let selection = editor.state.selection;
      const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", "\n");
      let from = selection.from;
      let to = selection.to;
      if (replaceQuery) {
        const explicit = String(query || "").trim();
        // The suggestion click can happen after the browser moved the caret.
        // When the current document still ends with the query, move the range
        // to the document end and replace only that query, preserving all text
        // before it (including Chinese text without a separating space).
        if (explicit && new RegExp(`${explicit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "iu").test(fullText)) {
          const queryMatch = fullText.match(new RegExp(`${explicit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "iu"));
          const removeLength = queryMatch?.[0]?.length || explicit.length;
          // `doc.content.size` is the position after the paragraph's closing
          // boundary. The last editable character sits one position before it.
          const docEnd = Math.max(1, editor.state.doc.content.size - 1);
          to = docEnd;
          from = Math.max(0, to - removeLength);
          // A colon is part of the unfinished Matrix-style trigger.
          const textBeforeQuery = fullText.slice(0, Math.max(0, fullText.length - removeLength));
          if (textBeforeQuery.endsWith(":")) from -= 1;
          selection = { from, to };
        } else {
          const before = editor.state.doc.textBetween(0, selection.from, "\n", "\n");
          const match = before.match(/(?:^|\s)(?::[^:\s]*|[\p{L}\p{N}_-]{1,32})$/u);
          if (match) from -= match[0].length - (match[0].startsWith(" ") ? 1 : 0);
        }
      }
      const chain = editor.chain().focus();
      if (from < to) chain.deleteRange({ from, to });
      chain.insertContent({ type: "orbitEmoji", attrs: { token, name, src, mxc } }).insertContent(" ").run();
      return true;
    },
    clear: () => { editorRef.current?.commands.clearContent(); onChange?.("", ""); },
  }));

  if (failed) return h(PlainComposer, { ref, value, onChange, onKeyDown, onFiles, placeholder });
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
  return h("div", { className: "halo-composer-shell" },
    h("div", { ref: hostRef, className: "halo-editor-surface", onKeyDown, onPaste: event => {
      const files = clipboardFiles(event.clipboardData);
      if (files.length) { event.preventDefault(); event.stopPropagation(); onFiles?.(files); }
    } }),
    h("div", { className: "halo-editor-toolbar" },
      h("div", { className: "halo-editor-format-actions" }, actions.map(([title, command, mark], index) => h(React.Fragment, { key: `${command}-${mark}` }, index === 6 ? h("span", { className: "toolbar-divider", "aria-hidden": "true" }) : null,
        h("button", { type: "button", className: editorRef.current?.isActive?.(mark.startsWith("heading") ? "heading" : mark) ? "is-active" : "", title: mark === "fontSize" ? `${title}：${fontSize}` : title, "aria-label": title, onMouseDown: event => event.preventDefault(), onClick: () => runFormat(command, command === "toggleHeading" ? { level: Number(mark.slice(-1)) } : undefined) }, h(Icon, { name: actionIcons[mark], size: 18 }))))),
      toolbarExtra && h("div", { className: "halo-editor-extra-actions" }, toolbarExtra)
    )
  );
});
