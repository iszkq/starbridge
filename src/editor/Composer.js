import React, { useEffect, useImperativeHandle, useRef, useState } from "https://esm.sh/react@18.3.1";
import Icon from "../ui/Icon.js";

const h = React.createElement;

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

export const HaloComposer = React.forwardRef(function HaloComposer({ value, onChange, onKeyDown, onFiles, placeholder, toolbarExtra }, ref) {
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  const [, setEditorVersion] = useState(0);
  const [fontSize, setFontSize] = useState("16px");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [{ Editor, Mark, mergeAttributes }, { StarterKit }, { Placeholder }, { Underline }, { Link }, { TextStyle }, { Color }] = await Promise.all([
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
        const editor = new Editor({
          element: hostRef.current,
          content: String(value || ""),
          extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: true }), Underline, TextStyle, Color.configure({ types: ["textStyle"] }), FontSize, Link.configure({ openOnClick: false, defaultProtocol: "https" }), Placeholder.configure({ placeholder: placeholder || "输入消息…" })],
          onUpdate: ({ editor: current }) => { setEditorVersion(version => version + 1); onChange?.(current.getText(), current.getHTML()); },
          onSelectionUpdate: () => setEditorVersion(version => version + 1),
        });
        editorRef.current = editor;
      } catch (error) {
        window.__haloEditorError = String(error?.stack || error?.message || error);
        setFailed(true);
      }
    })();
    return () => { active = false; editorRef.current?.destroy?.(); editorRef.current = null; };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && String(value || "") !== editor.getText()) editor.commands.setContent(String(value || ""), false);
  }, [value]);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.chain().focus().run() || hostRef.current?.focus(),
    insertText: text => { const editor = editorRef.current; if (editor) editor.chain().focus().insertContent(String(text || "")).run(); else onChange?.(`${String(value || "")}${String(text || "")}`, ""); },
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
  return h("div", { className: "halo-composer-shell", onClick: () => editorRef.current?.chain().focus().run() },
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
