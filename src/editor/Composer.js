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


function editorLeafText(node) {
  if (node?.type?.name === "orbitEmoji") return node.attrs?.token || `:${node.attrs?.name || "表情"}:`;
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
    const src = item.thumbUrl || item.url || "";
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

export const HaloComposer = React.forwardRef(function HaloComposer({ value, onChange, onKeyDown, onFiles, placeholder, toolbarExtra, emojiFallbackItems = [] }, ref) {
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  const lastEmittedRef = useRef(String(value || ""));
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const fallbackRef = useRef(emojiFallbackItems);
  valueRef.current = value;
  onChangeRef.current = onChange;
  fallbackRef.current = emojiFallbackItems;
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
            transformPastedHTML: html => flattenPastedHtml(html),
          },
          onUpdate: ({ editor: current }) => {
            const text = serializeEditorText(current);
            lastEmittedRef.current = text;
            setEditorVersion(version => version + 1);
            onChangeRef.current?.(text, current.getHTML());
          },
          onSelectionUpdate: () => setEditorVersion(version => version + 1),
        });
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
      const src = item.thumbUrl || item.url || "";
      const fullText = serializeEditorText(editor);
      let from = editor.state.selection.from;
      let to = editor.state.selection.to;
      if (replaceQuery) {
        const explicit = String(query || "").trim();
        if (explicit && new RegExp(`${explicit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "iu").test(fullText)) {
          const queryMatch = fullText.match(new RegExp(`${explicit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "iu"));
          const removeLength = queryMatch?.[0]?.length || explicit.length;
          const docEnd = Math.max(1, editor.state.doc.content.size - 1);
          to = docEnd;
          from = Math.max(0, to - removeLength);
          const textBeforeQuery = fullText.slice(0, Math.max(0, fullText.length - removeLength));
          if (textBeforeQuery.endsWith(":")) from -= 1;
        } else {
          const before = editor.state.doc.textBetween(0, editor.state.selection.from, "\n", editorLeafText);
          const match = before.match(/(?:^|\s)(?::[^:\s]*|[\p{L}\p{N}_-]{1,32})$/u);
          if (match) from -= match[0].length - (match[0].startsWith(" ") ? 1 : 0);
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
