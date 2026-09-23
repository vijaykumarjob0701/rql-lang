import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { useMemo } from "react";
import { diagnoseRql } from "../lib/rqlParse";
import { registerRqlLanguage } from "../monaco-rql";

type Props = {
  value: string;
  onChange: (next: string) => void;
  vectorText: string;
  onVectorText: (next: string) => void;
  sparseText: string;
  onSparseText: (next: string) => void;
  vectorNote: string | null;
  demoUsed: boolean;
  storedDemo: boolean;
  onDemoVector: () => void;
  onUploadVector: (file: File) => void;
  onExplain: () => void;
  onEmit: () => void;
  onExecute: () => void;
  busy: boolean;
};

export function QueryEditor({
  value,
  onChange,
  vectorText,
  onVectorText,
  sparseText,
  onSparseText,
  vectorNote,
  demoUsed,
  storedDemo,
  onDemoVector,
  onUploadVector,
  onExplain,
  onEmit,
  onExecute,
  busy,
}: Props) {
  const diagnosis = useMemo(() => diagnoseRql(value), [value]);

  const beforeMount: BeforeMount = (monaco) => {
    registerRqlLanguage(monaco);
    monaco.editor.setTheme("rql-ink");
  };

  const handleMount: OnMount = (editor, monaco) => {
    registerRqlLanguage(monaco);
    monaco.editor.setTheme("rql-ink");
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onExecute());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE, () => onExplain());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyM, () => onEmit());
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="pane-head">
        <span>RQL retrieve</span>
        <div className="row">
          <button className="btn tiny" type="button" disabled={busy} onClick={onExplain}>
            Explain
          </button>
          <button className="btn tiny" type="button" disabled={busy} onClick={onEmit}>
            Emit
          </button>
          <button className="btn primary tiny" type="button" disabled={busy} onClick={onExecute}>
            Execute
          </button>
        </div>
      </div>
      <div className="editor-wrap" data-testid="rql-editor">
        <Editor
          height="100%"
          language="rql"
          theme="rql-ink"
          value={value}
          onChange={(v) => onChange(v ?? "")}
          beforeMount={beforeMount}
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "IBM Plex Mono, ui-monospace, monospace",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            tabSize: 2,
          }}
        />
      </div>
      <div className={`diag ${diagnosis.ok ? "ok" : "err"}`} data-testid="parse-status">
        {diagnosis.ok
          ? `parse ok · LogicalPlan ${String((diagnosis.plan.root as { op?: string }).op ?? "")}`
          : `${diagnosis.name}: ${diagnosis.message}`}
      </div>
      <div className="vector-box">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <label htmlFor="query-vector">Query vector (dense JSON array)</label>
          <div className="row">
            <label className="btn tiny">
              Upload JSON
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadVector(file);
                  e.target.value = "";
                }}
              />
            </label>
            <button className="btn warn tiny" type="button" onClick={onDemoVector}>
              Demo random vector
            </button>
          </div>
        </div>
        <textarea
          id="query-vector"
          data-testid="query-vector"
          value={vectorText}
          spellCheck={false}
          placeholder='[0.12, -0.03, …]  — required for Execute'
          onChange={(e) => onVectorText(e.target.value)}
        />
        {sparseText ? (
          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="query-sparse">Sparse / BM25 binding (stored demo)</label>
            <textarea
              id="query-sparse"
              data-testid="query-sparse"
              value={sparseText}
              spellCheck={false}
              onChange={(e) => onSparseText(e.target.value)}
            />
          </div>
        ) : null}
        <p className={`hint ${demoUsed || storedDemo ? "warn" : ""}`}>
          {demoUsed
            ? "Demo-only random unit vector — not an embedding of the QUERY text. Do not treat scores as semantic retrieval."
            : vectorNote ||
              "Execute binds this array to $q_dense. Recipes auto-fill stored demo vectors. Paste a real embedding to replace them."}
        </p>
      </div>
    </div>
  );
}
