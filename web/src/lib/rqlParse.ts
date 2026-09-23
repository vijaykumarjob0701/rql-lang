/**
 * Browser-safe parse path — imports the library parser only (no Node fs).
 * compile / explain / emit stay on the Studio server because the planner
 * reads profile JSON via node:fs.
 */
import { parse, ParseError, SCHEMA_VERSION } from "../../../javascript/src/parser";
import type { LogicalPlan } from "../../../javascript/src/parser";

export { parse, ParseError, SCHEMA_VERSION };
export type { LogicalPlan };

export type ParseDiagnosis =
  | { ok: true; plan: LogicalPlan }
  | { ok: false; message: string; name: string };

export function diagnoseRql(text: string): ParseDiagnosis {
  try {
    const plan = parse(text);
    return { ok: true, plan };
  } catch (err) {
    if (err instanceof ParseError) {
      return { ok: false, message: err.message, name: err.name };
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err), name: "Error" };
  }
}
