# Workflow error policy (NODE5)

This project uses `NODE5` as the **central error/response policy** for a `WorkflowUnit`.

## Runtime behavior (high-level)

When a workflow is executed, nodes are traversed along `edges`.

If any node throws:

1. The event is saved to Dead Letter (production only; skipped in simulation).
2. If the unit contains a `NODE5` with `node5 != null`, the pipeline builds an error response:
   - **Per-node override first**: `failedNode.errorResponse` (if set)
   - **Fallback**: `NODE5.node5.defaultErrorConfig`
3. The generated error response may optionally be forwarded to a downstream node connected from `NODE5` (typically `NODE4` for notifications).

Reference implementation:
- `src/main/kotlin/com/synapse/message_interface/engine/MessagePipeline.kt`

## Priority rules

- **Success response**: produced only when `NODE5` executes successfully via `node5.successConfig`.
- **Error response**:
  - If a failing node has `WorkflowNode.errorResponse` → use it.
  - Else → use `NODE5.defaultErrorConfig`.

## HTTP status on errors

`NODE5` error responses do **not** have a fixed HTTP status in config.
The status is derived from the thrown exception:

- `ResponseStatusException` → uses its embedded HTTP status
- otherwise → defaults to `500`

(See `Node5Panel` UI hint and `Node5Executor` implementation.)

## Recommended defaults

- Keep `NODE5.defaultErrorConfig` populated (at least one field), so every failure becomes a predictable response body.
- Only set per-node `errorResponse` when you need **different** error shapes for specific failure points.

