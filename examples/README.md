# Shared RQL examples (v0.1 subset)

| File | Intent |
|------|--------|
| `01-hybrid-rrf.rql` | Dense + BM25 → Fuse RRF |
| `02-filtered-dense.rql` | Dense + WHERE + ACL_HARD |
| `03-late.rql` | Late / ColBERT leaf |
| `04-hybrid-linear.rql` | Dense + BM25 → Fuse LINEAR + filter |
| `qdrant_live_execute.py` | Opt-in live Qdrant execute (Python) |
| `qdrant_live_execute.mjs` | Same demo for JS/TS |

## Live Qdrant (optional)

Unit tests mock HTTP and do **not** need a server. To exercise a real instance:

```bash
docker run --rm -p 6333:6333 qdrant/qdrant
export QDRANT_URL=http://localhost:6333   # optional QDRANT_API_KEY

# seed a tiny collection, then execute 02-filtered-dense
python examples/qdrant_live_execute.py --seed

# from javascript/ after npm install (tsx resolves src)
node --import tsx ../examples/qdrant_live_execute.mjs --seed

# gated integration tests
cd python && python -m pytest tests/test_qdrant_live.py -q
cd javascript && npm test
```

`execute` binds caller-supplied vectors (`dense` / `sparse`). It does not embed query text. Late-interaction example `03-late.rql` is expected to raise `ExecutionError` (fail-closed).
