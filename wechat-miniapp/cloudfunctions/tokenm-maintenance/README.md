# tokenm-maintenance

One-time, control-plane-only recovery function for the five explicitly allowlisted Token M unknown deliveries.

The source directory is not itself a deployment artifact because it intentionally contains no copy of the production service. Build into a new directory:

```text
npm run build -- --output <new-directory>
```

The build copies the canonical `tokenm-api/lib` tree into the artifact and writes `SOURCE_MANIFEST.json` with SHA-256 hashes. This prevents a second maintained reconciliation implementation. Deploy the generated directory as an Event function named `tokenm-maintenance`, runtime `Nodejs20.19`, handler `index.main`, with no HTTP, timer, or public trigger. Delete the function after the five verified reconciliations.

Invocation accepts exactly one `deliveryId` and optional boolean `apply`. Omitted or false `apply` is read-only dry-run; only strict `true` applies the fixed `failed` outcome.
