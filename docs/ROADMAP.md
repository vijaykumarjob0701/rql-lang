# Roadmap

## v0.1 (this release) — shipable library surface

- [x] Parallel Python + TypeScript packages
- [x] `parse` / `compile` / `explain` / `emit` API
- [x] Shared schemas `0.1.0-draft` + toy `.rql` examples
- [x] Capability profiles: qdrant, elasticsearch, pgvector
- [x] Emit **sketches** only + pluggable adapter interface
- [ ] First **live** adapter (read-only smoke against one vendor; gated, opt-in)

## v0.2 — hybrid & honesty

- [ ] Live hybrid RRF path where profile advertises `rrfNative`
- [ ] Client shim fusion with explicit ACL-safety notes
- [ ] Optional jsonschema validation helpers in both languages
- [ ] Richer `explain` (cost/capability annotations without inventing latency numbers)

## v0.3+

- [ ] Late-interaction rewrite ladder (PLAID / MUVERA) with fail-closed adapters
- [ ] Filter strategy telemetry hooks (still no fabricated recall claims)
- [ ] Public PyPI / npm release when API stabilizes
- [ ] Broader RQL grammar (rerank, diversify) behind feature flags

## Non-goals (near term)

- Publishing fabricated FANNS / RAG benchmark numbers from this library alone
- Claiming emit ≡ production query execution
