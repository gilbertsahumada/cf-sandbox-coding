import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
async function languageFor(path: string): Promise<Extension> {
  const ext = path.split(".").at(-1)?.toLowerCase();
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(ext || ""))
    return (await import("@codemirror/lang-javascript")).javascript({
      jsx: ext === "jsx" || ext === "tsx",
      typescript: ext === "ts" || ext === "tsx",
    });
  if (ext === "css") return (await import("@codemirror/lang-css")).css();
  if (ext === "json" || ext === "jsonc")
    return (await import("@codemirror/lang-json")).json();
  if (ext === "html") return (await import("@codemirror/lang-html")).html();
  if (ext === "py") return (await import("@codemirror/lang-python")).python();
  if (ext === "md" || ext === "mdx")
    return (await import("@codemirror/lang-markdown")).markdown();
  return [];
}
export default function CodeEditor({
  path,
  content,
  onChange,
  onSave,
  onCursor,
}: {
  path: string;
  content: string;
  onChange: (text: string) => void;
  onSave: () => void;
  onCursor: (position: string) => void;
}) {
  const parent = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    callbacks = useRef({ onChange, onSave, onCursor });
  callbacks.current = { onChange, onSave, onCursor };
  useEffect(() => {
    const language = new Compartment();
    let current = true;
    const instance = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: content,
        extensions: [
          basicSetup,
          syntaxHighlighting(
            HighlightStyle.define([
              { tag: [tags.keyword, tags.modifier], color: "#c6b7d5" },
              { tag: tags.string, color: "#b7c7b0" },
              { tag: [tags.variableName, tags.propertyName], color: "#d2d7df" },
              { tag: tags.typeName, color: "#acc0cd" },
              { tag: tags.comment, color: "#87909e" },
              { tag: [tags.number, tags.bool, tags.null], color: "#d4bd9d" },
              { tag: tags.tagName, color: "#b3c5ce" },
              { tag: tags.attributeName, color: "#bfc9d5" },
            ]),
          ),
          EditorView.cspNonce.of(
            document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')
              ?.content || "",
          ),
          EditorState.lineSeparator.of(
            content.includes("\r\n") ? "\r\n" : "\n",
          ),
          language.of([]),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            },
          ]),
          EditorView.contentAttributes.of({
            "aria-label": `Code editor for ${path}`,
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              callbacks.current.onChange(update.state.sliceDoc());
            if (update.selectionSet || update.docChanged) {
              const head = update.state.selection.main.head,
                line = update.state.doc.lineAt(head);
              callbacks.current.onCursor(
                `Ln ${line.number}, Col ${head - line.from + 1}`,
              );
            }
          }),
          EditorView.theme(
            {
              "&": {
                height: "100%",
                backgroundColor: "var(--background)",
                color: "var(--foreground)",
                fontSize: "12px",
              },
              ".cm-scroller": {
                overflow: "auto",
                fontFamily: "var(--font-mono)",
                lineHeight: "1.8",
              },
              ".cm-content": { padding: "14px 0" },
              ".cm-gutters": {
                backgroundColor: "var(--background)",
                color: "var(--muted-foreground)",
                border: "none",
                paddingRight: "10px",
              },
              ".cm-activeLine,.cm-activeLineGutter": {
                backgroundColor: "var(--muted)",
              },
              "&.cm-focused": { outline: "none" },
              ".cm-cursor": { borderLeftColor: "var(--foreground)" },
              ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
                backgroundColor: "var(--accent)",
              },
              ".cm-searchMatch": { backgroundColor: "var(--accent)" },
              ".cm-panels": {
                backgroundColor: "var(--sidebar)",
                color: "var(--foreground)",
              },
              ".cm-foldPlaceholder": {
                backgroundColor: "var(--muted)",
                border: "none",
                color: "var(--muted-foreground)",
              },
            },
            { dark: true },
          ),
        ],
      }),
    });
    view.current = instance;
    callbacks.current.onCursor('Ln 1, Col 1');
    void languageFor(path)
      .then((extension) => {
        if (current)
          instance.dispatch({ effects: language.reconfigure(extension) });
      })
      .catch(() => {});
    return () => {
      current = false;
      instance.destroy();
      view.current = null;
    };
    // Each file has its own keyed editor. Draft changes are retained by the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  useEffect(() => {
    const instance = view.current;
    if (instance && content !== instance.state.sliceDoc())
      instance.dispatch({
        changes: { from: 0, to: instance.state.doc.length, insert: content },
      });
  }, [content]);
  return <div className="code-editor" ref={parent} />;
}
