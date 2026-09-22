/**
 * RQL — Retrieval Query Language library (TypeScript / JavaScript).
 *
 * Public API: parse → compile → explain / emit (sketches) / execute (opt-in Qdrant).
 */

export const VERSION = "0.1.0";

export { parse, ParseError, SCHEMA_VERSION } from "./parser.js";
export type { LogicalPlan } from "./parser.js";

export { compile, planLogical, loadProfile, listProfiles, PlanError } from "./planner.js";
export type { PhysicalPlan, Profile, CompileOptions } from "./planner.js";

export { explain } from "./explain.js";
export type { ExplainFormat, ExplainObject } from "./explain.js";

export {
  emit,
  emitPlan,
  listVendors,
  registerAdapter,
  resolveVendor,
  AdapterError,
  VENDORS,
} from "./emit.js";
export type { EmitResult, EmitOptions, Adapter, Vendor } from "./emit.js";

export { execute, ExecutionError, QdrantAdapter } from "./execute.js";
export type { ExecuteOptions } from "./execute.js";
export type { ExecuteResult, ExecuteHit, QdrantTransport, VectorBindings } from "./qdrant.js";

export {
  schemasDir,
  loadSchema,
  logicalPlanSchema,
  physicalPlanSchema,
} from "./schemas.js";
