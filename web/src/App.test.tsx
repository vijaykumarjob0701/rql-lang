import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { diagnoseRql } from "./lib/rqlParse";
import { DEFAULT_RQL } from "./lib/snippets";

vi.mock("@monaco-editor/react", () => ({
  default: (props: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      aria-label="RQL editor"
      value={props.value}
      onChange={(e) => props.onChange?.(e.target.value)}
    />
  ),
}));

describe("Studio smoke", () => {
  it("renders the connection form", () => {
    render(
      <ConnectionPanel
        value={{ url: "http://127.0.0.1:6333", apiKey: "" }}
        connected={false}
        busy={false}
        error={null}
        onChange={() => {}}
        onConnect={() => {}}
      />,
    );
    expect(screen.getByTestId("qdrant-url")).toHaveValue("http://127.0.0.1:6333");
    expect(screen.getByRole("button", { name: /connect/i })).toBeInTheDocument();
  });

  it("default editor snippet is parseable by the library", () => {
    const d = diagnoseRql(DEFAULT_RQL);
    expect(d.ok).toBe(true);
  });
});
