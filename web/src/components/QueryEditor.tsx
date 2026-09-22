import Editor, { type OnMount } from "@monaco-editor/react";
import { useMemo } from "react";
import { diagnoseRql } from "../lib/rqlParse";
import { SNIPPETS } from "../lib/snippets";
import { registerRqlLanguage } from "../monaco-rql";

type Props = {
  value: string;
  onChange: (next: string) => void;
  vectorText: string;
  onVectorText: (next: string) => void;
  vectorNote: string | null;
  demoUsed: boolean;
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
  vectorNote,
  demoUsed,
  onDemoVector,
  onUploadVector,
  onExplain,
  onEmit,
  onExecute,
  busy,
}: Props) {
  const diagnosis = useMemo(() => diagnoseRql(value), [value]);

  const handleMount: OnMount = (editor, monaco) => {
    registerRqlLanguage(monaco);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onExecute());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE, () => onExplain());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyM, () => onEmit());
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="pane-head">
        <span>RQL</span>
        <div className="row">
          <select
            aria-label="Example snippets"
            defaultValue=""
            onChange={(e) => {
              const snip = SNIPPETS.find((s) => s.id === e.target.value);
              if (snip) onChange(snip.rql);
              e.target.value = "";
            }}
          >
            <option value="" disabled>
              Insert example…
            </option>
            {SNIPPETS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
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
        <p className={`hint ${demoUsed ? "warn" : ""}`}>
          {demoUsed
            ? "Demo-only random unit vector — not an embedding of the QUERY text. Do not treat scores as semantic retrieval."
            : vectorNote ||
              "Execute binds this array to $q_dense. Paste a real embedding, upload JSON, or generate a labeled demo vector."}
        </p>
      </div>
    </div>
  );
}
