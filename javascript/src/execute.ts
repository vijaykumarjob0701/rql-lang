/** Public execute() — opt-in live adapters (Qdrant first). */

import { AdapterError, getAdapter, resolveVendor } from "./emit.js";
import { ExecutionError, QdrantAdapter } from "./qdrant.js";
import type { ExecuteResult, QdrantExecuteOptions, QdrantTransport, VectorBindings } from "./qdrant.js";

export type ExecuteOptions = QdrantExecuteOptions & {
  backend?: string;
  profile?: string;
};

export async function execute(
  planOrEmit: Record<string, unknown>,
  options: ExecuteOptions = {},
): Promise<ExecuteResult> {
  let vendor = options.backend || options.profile;
  if (!vendor) {
    if (planOrEmit.kind === "VendorRequestSketch") vendor = String(planOrEmit.vendor || "");
    else if (planOrEmit.kind === "PhysicalPlan") vendor = resolveVendor(planOrEmit, null);
    else {
      throw new AdapterError(
        `execute expects PhysicalPlan or VendorRequestSketch; got kind=${JSON.stringify(planOrEmit.kind)}`,
      );
    }
  }
  vendor = vendor.trim().toLowerCase();

  const registered = getAdapter(vendor);
  if (registered?.execute) {
    return registered.execute(planOrEmit, options) as Promise<ExecuteResult>;
  }
  if (vendor !== "qdrant") {
    throw new AdapterError(
      `no live execute adapter for ${JSON.stringify(vendor)}; v0.1 ships Qdrant only (emit sketches remain available for all vendors)`,
    );
  }

  const adapter = new QdrantAdapter({
    url: options.url,
    apiKey: options.apiKey,
    transport: options.transport,
    timeout: options.timeout,
  });
  return adapter.execute(planOrEmit, {
    vectors: options.vectors,
    collection: options.collection,
    vectorNames: options.vectorNames,
  });
}

export type { ExecuteResult, QdrantTransport, VectorBindings };
export { ExecutionError, QdrantAdapter };
