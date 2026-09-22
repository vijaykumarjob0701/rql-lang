import type { Monaco } from "@monaco-editor/react";

export const RQL_LANGUAGE = "rql";

export function registerRqlLanguage(monaco: Monaco): void {
  const langs = monaco.languages.getLanguages();
  if (langs.some((l) => l.id === RQL_LANGUAGE)) return;

  monaco.languages.register({ id: RQL_LANGUAGE, extensions: [".rql"], aliases: ["RQL", "rql"] });
  monaco.languages.setLanguageConfiguration(RQL_LANGUAGE, {
    comments: { lineComment: "--" },
    brackets: [
      ["(", ")"],
      ["[", "]"],
    ],
    autoClosingPairs: [
      { open: "(", close: ")" },
      { open: "'", close: "'" },
      { open: '"', close: '"' },
    ],
  });
  monaco.languages.setMonarchTokensProvider(RQL_LANGUAGE, {
    ignoreCase: true,
    tokenizer: {
      root: [
        [/--.*$/, "comment"],
        [/'([^']*)'/, "string"],
        [/"([^"]*)"/, "string"],
        [/\$[A-Za-z_][A-Za-z0-9_]*/, "variable"],
        [/\d+(?:\.\d+)?/, "number"],
        [
          /\b(RETRIEVE|SEARCH|DENSE|BM25|LATE|COLBERT|WHERE|ACL_HARD|FUSE|RRF|LINEAR|LIMIT|AND|ON|METRIC|CANDIDATES|QUERY|VECTOR_REF|WEIGHTS|K)\b/,
          "keyword",
        ],
        [/\b(cosine|l2|ip|dot|unknown)\b/, "type"],
        [/[A-Za-z_][A-Za-z0-9_]*/, "identifier"],
        [/[()=,;]/, "delimiter"],
      ],
    },
  });

  monaco.editor.defineTheme("rql-ink", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7a8d", fontStyle: "italic" },
      { token: "keyword", foreground: "3ee0b5", fontStyle: "bold" },
      { token: "string", foreground: "f0b429" },
      { token: "number", foreground: "7eb6ff" },
      { token: "variable", foreground: "ff8b6b" },
      { token: "type", foreground: "c9a0ff" },
      { token: "identifier", foreground: "e8eef6" },
      { token: "", foreground: "e8eef6" },
    ],
    colors: {
      "editor.background": "#0b1018",
      "editor.foreground": "#e8eef6",
      "editorLineNumber.foreground": "#3d4c61",
      "editorLineNumber.activeForeground": "#8b97a8",
      "editor.selectionBackground": "#1d3a36",
      "editor.lineHighlightBackground": "#121925",
      "editorCursor.foreground": "#3ee0b5",
      "editorIndentGuide.background": "#1c2634",
    },
  });
}
