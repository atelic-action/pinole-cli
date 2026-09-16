# pinole

The command line client for the Pinole API, starting with the work search domain: postings, activities, and the funnel. The same package is a small typed library, so a script can import `createClient` and skip the shell.

## Install

```sh
npm install -g github:atelic-action/pinole-cli#v0.1.0
```

Node 20 or newer. The `prepare` script compiles TypeScript on install, so nothing is published to npm and the tag is the release. Drop the `#v0.1.0` to install the tip of `main`.

## Token and Base URL

Every request carries `X-Api-Key`. The token comes from the first of:

1. `PINOLE_API_TOKEN` in the environment.
2. On macOS, the Keychain entry with service `pinole-mcp-token`, read with `security find-generic-password -s pinole-mcp-token -w`. Store one with `security add-generic-password -s pinole-mcp-token -a pinole -w <token>`.

When neither yields a token the command exits 1 with a message naming both sources. The token is never printed.

The base URL is `--api <url>`, else `PINOLE_API_URL`, else `https://api.atelic.me`.

## Output

JSON is the default: the raw envelope from the API, pretty printed. `--table` renders a Markdown table instead, with pipes escaped and newlines flattened to spaces. Postings render as `| Id | Seen | Company | Title | Status | Board | Key | Verdict |` and activities as `| Id | Date | Kind | Employer | Position | Channel | Reported | Notes |`; the id leads because every write verb takes one.

A non 2xx answer prints the server's `error` text and the status to stderr and exits 1. `--all` walks `links.next` and prints one envelope holding every row, with `meta.total` from the last page.

## Verbs

Every verb takes the global `--json`, `--table`, and `--api <url>`.

### Postings

List, with every filter passed straight through to the API:

```sh
pinole work postings list --status queued,applied --track w2 --board greenhouse --since 2026-09-01 --seen-since 2026-09-10 -q staff --all
```

Upsert from a file or stdin. The input is a JSON array (sent as `postings`) or a single object (sent as `posting`); the API matches by url, then by an ATS key, then fuzzily on company and title:

```sh
pinole work postings upsert --file rows.json
echo '{"company":"Watershed","title":"Staff Engineer","url":"https://example.com/jobs/1"}' | pinole work postings upsert
```

Update one posting by id. The API's transition guard applies, and `closed` needs `--closed-reason`:

```sh
pinole work postings update 42 --status closed --closed-reason silent --notes "no reply after two follow ups"
```

### Activities

List by ISO week or by an inclusive date range, never both:

```sh
pinole work activities list --week 2026-W38 --kind application --reported false
pinole work activities list --from 2026-09-06 --to 2026-09-12 --posting 42 --all
```

Log one activity from flags, or many from a file or stdin (an array is sent as `activities`, one object as `activity`):

```sh
pinole work activities log --on 2026-09-15 --kind application --employer Watershed --position "Staff Engineer" --posting 42 --channel greenhouse
pinole work activities log --file activities.json
```

Report activities against a claim: one PATCH per id with `reported: true` and the confirmation code. The command stops at the first failure, so the ids after it stay unreported:

```sh
pinole work activities report --confirmation 8F2K1 101 102 103
```

Exclude an activity from the claim with a reason:

```sh
pinole work activities exclude 104 --reason "duplicate of 101"
```

### Funnel

```sh
pinole work funnel --table
```

## As a Library

```ts
import { createClient } from 'pinole';

const pinole = createClient();
const queued = await pinole.postings.listAll({ status: 'queued' });
await pinole.activities.log({ performed_on: '2026-09-15', kind: 'application', employer: 'Watershed' });
```

`createClient({ baseUrl, token, fetch })` accepts overrides for each; the defaults resolve exactly as the CLI does. Calls return the raw envelopes, and a non 2xx throws `PinoleApiError` with `status` and `body`.

## Types and the OpenAPI Document

`src/generated/schema.d.ts` is generated from `openapi/v1.yaml` and committed, so a GitHub install needs no generate step. To regenerate:

```sh
npm run generate
```

**The document in `openapi/v1.yaml` is interim.** It was hand authored from the work domain wire contract (2026-09-16) so the CLI could be built alongside the API. The API repo generates the real document from its request specs, commits it at `openapi/v1.yaml`, and serves it at `GET https://api.atelic.me/v1/openapi`. Once that lands, replace the file here with the served one and regenerate:

```sh
curl -sS -H "X-Api-Key: $PINOLE_API_TOKEN" https://api.atelic.me/v1/openapi -o openapi/v1.yaml
npm run generate && npm run typecheck && npm test
```

The first tag waits on that swap.

## Development

```sh
npm install
npm run build      # tsc into dist/
npm test           # vitest, no network
npm run typecheck  # source and tests
```

Tests mock `fetch`; nothing reaches the network, and the token is always injected, so the Keychain is never read under test.
