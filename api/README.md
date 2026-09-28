# VestFlow API

Read-only HTTP API in front of the VestFlow Soroban contract. Every endpoint is
a thin, typed wrapper around a contract view, so dashboards and the web app can
read chain state without embedding the Stellar SDK or shipping a signer.

The service holds **no keys**. It only simulates reads and never builds, signs,
or submits a transaction.

## Layout

```
api/
├── src/
│   ├── config/        # env parsing (zod) and the structured logger
│   ├── middleware/    # async wrapper, request logging, validation, errors
│   ├── routes/        # express routers, one per resource
│   ├── services/      # Stellar RPC + VestFlow read model
│   ├── types/         # shared error types
│   ├── app.ts         # express app factory
│   └── index.ts       # process entry point, graceful shutdown
├── eslint.config.mjs
├── .prettierrc.json
└── tsconfig.json
```

## Getting started

```bash
cd api
cp .env.example .env
npm install
npm run dev
```

`VESTFLOW_CONTRACT_ID` and `STELLAR_NETWORK_PASSPHRASE` are required; the process
refuses to boot without them.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Watch mode via `tsx` |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (type-checked rules) |
| `npm run format` | Prettier write |

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness. Never touches the network. |
| `GET` | `/ready` | Readiness, including an RPC reachability probe. |
| `GET` | `/v1/contract` | Contract id, version, cycle length, schedule count, ledger. |
| `GET` | `/v1/contract/balance/:token` | Total `token` held by the contract. |
| `GET` | `/v1/accounts/:address/collectable?token=` | Collectable streaming balance now. |
| `GET` | `/v1/accounts/:address/splits` | Configured split receivers and weights. |
| `GET` | `/v1/accounts/:address/streams?token=` | Outgoing stream configuration for a token. |
| `GET` | `/v1/accounts/:address/balance-at?token=&at=` | Streaming balance as of a past timestamp (#598). |
| `GET` | `/v1/schedules/:id/claimable?at=` | Claimable on a schedule, optionally at a timestamp. |

## Response shape

Success:

```json
{ "data": { "...": "..." } }
```

Failure:

```json
{ "error": { "code": "bad_request", "message": "…", "details": {} } }
```

`code` is stable and safe to branch on. A contract or RPC failure surfaces as
`502 upstream_error` with the cause in `details`; `400 bad_request` means the
request itself was malformed.

## Operational notes

- Rate limiting is on by default (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`).
  `TRUST_PROXY=1` must only be enabled behind a proxy that actually sets
  `X-Forwarded-For`.
- `SIGINT`/`SIGTERM` trigger a graceful drain with a 10s ceiling before a forced
  exit.
- Contract error codes and their remediations are documented in
  [`../docs/contract-errors.md`](../docs/contract-errors.md).
