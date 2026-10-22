# FollowThru REST API

Three Vercel functions in `api/`, reusing the same engine as the app. `npm run dev`
serves them at `http://localhost:5173/api/*`. A deployed copy lives at `LIVE_URL`
(placeholder until the app is deployed).

- Shadow mode: nothing is ever sent.
- Logs contain only route, status and timing, never message text.
- CORS: `Access-Control-Allow-Origin: *`, methods `GET, POST, OPTIONS`; preflight `OPTIONS` returns 204.
- Errors always have the shape `{ "error": { "code", "message", "issues"? } }`.

## GET /api/health

```bash
curl http://localhost:5173/api/health
```

```json
{"ok":true,"service":"followthru","version":"0.1.0","sending":"shadow mode, nothing is sent"}
```

## POST /api/process

Runs the engine on a dataset and returns the result and the scorecard.

Body (JSON, at most 2 MB), one of:

- `{ "dataset": Dataset, "config"?: Config }` — `Dataset` in the canonical format in `docs/fixture-notes.md`. `"fixture"` is accepted as another name for `"dataset"`.
- `{ "csv": "<messages CSV>", "people": Person[], "threads"?: Thread[], "config"?: Config }` — CSV columns `id,threadId,authorId,sentAt,text,replyToId,mentionIds`.

`Config` = `{ "now"?: ISO time, "flags"?: { "staleSuppression"?, "recipientReview"?, "ai"? }, "staleAfterHours"?: number }`.
`now` defaults to the dataset's `referenceTime`. Setting `flags.ai` returns `mode: "Rules (fallback)"`.

Response 200: `{ "result": EngineResult, "scorecard": Scorecard }` (types in `src/engine/types.ts`).

```bash
# body.json = { "dataset": <contents of samples/01-valid-dataset-SYNTHETIC.json> }
curl -X POST -H "Content-Type: application/json" --data-binary @body.json http://localhost:5173/api/process
```

Run on 18 Oct 2026 with the synthetic sample: 7 commitments, 2 drafts, all three checks PASS.

## GET /api/evidence

Query: `format=json|csv` (default `json`), `kind=commitments|drafts|suppressions|scorecard` (default `scorecard`; the scorecard is JSON only).

Runs the engine on `data/fixture.json` when it is deployed with the API, otherwise on the **synthetic demo**. Synthetic responses say so in the header `X-FollowThru-Dataset: synthetic-demo` and in the JSON field `"dataset": "synthetic demo (not challenge data)"`. Responses download as `followthru-<kind>-<timestamp>.<format>`.

```bash
curl "http://localhost:5173/api/evidence?format=json&kind=scorecard"
curl -OJ "http://localhost:5173/api/evidence?format=csv&kind=drafts"
```

JSON response: `{ "dataset", "evaluatedAt", "mode", "kind", "data" }`.

## Error codes

| Status | Code | When |
|---|---|---|
| 400 | `bad_format`, `bad_kind` | Unknown evidence format or kind, or a CSV scorecard |
| 405 | `method_not_allowed` | Wrong method (the `Allow` header lists the right ones) |
| 413 | `payload_too_large` | Body over 2 MB |
| 415 | `unsupported_media_type` | `/api/process` without `Content-Type: application/json` |
| 422 | `invalid_json`, `missing_dataset`, `invalid_csv`, `invalid_dataset`, `invalid_config`, `missing_now` | Body cannot be used; `issues` lists validation problems with paths |

Against `LIVE_URL`, replace `http://localhost:5173` with the deployed address once it exists.
