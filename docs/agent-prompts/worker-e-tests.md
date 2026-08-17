# Worker E Prompt — Tests and Integration Harness

Model requirement: GPT-5.6 Sol, reasoning effort high.

Work only in isolated branch/worktree `codex/wechat-tests`. Read `AGENTS.md` and all frozen docs. Do not modify production logic to make tests pass.

Ownership:

- `wechat-miniapp/tests/**`
- `wechat-miniapp/scripts/**`
- `docs/wechat-miniapp/TEST_MATRIX.md`
- Minimal root package script additions only if no overlap; prefer runnable `node --test` commands inside WeChat directory.

Build fixtures and an integration harness against the production backend domain interfaces from the frozen contract. If Backend Worker code is not yet present in your branch, build contract fixtures/adapters that can be rebased/imported without duplicating production logic; Lead will integrate. Never create a second backend implementation and call it production.

Required automated IDs: PAIR-01 valid, PAIR-02 expired, PAIR-03 single-use, PAIR-04 wrong code no credential/enumeration; AUTH-01 bad secret, AUTH-02 revoked; EVENT-01 create, EVENT-02 x3 one task, EVENT-03 no duplicate message, EVENT-04 no duplicate quota; QUOTA-01 accept +1, QUOTA-02 success -1, QUOTA-03 failure no wrong deduction, QUOTA-04 zero still task/skipped, QUOTA-05 concurrent never negative; PRIVACY-01 deny forbidden, PRIVACY-02 full allowlist; OWNERSHIP-01 A cannot read B, OWNERSHIP-02 desktop A cannot write B; DELETE-01 history hidden/cleanup state.

Implement exact mock/local E2E: User A bootstrap → pair → quota2 → event1 send/quota1 → duplicate event1 unchanged → event2 send/quota0 → event3 saved/skipped; User B reads none of A. Assert counts, IDs, delivery attempts and final states.

UI smoke state verification: first run, bound/no task, task list, privacy/full detail, quota 0/low/normal, error, pairing expiry, subscription rejection, pagination. Mock sender records calls and never sits in production path.

Provide one smoke command that validates project JSON, imports/paths existence, cloudfunction entry/package, no unfilled production secrets mistaken as values, and runs tests. Add a secret scan with explicit synthetic-fixture allowlist. Do not require real WeChat credentials.

If production interfaces differ from frozen docs, report `CONTRACT_CHANGE_REQUEST`; do not silently adapt the contract.

Run all owned tests and `git diff --check`, commit conventionally, report SHA/files/exact pass counts/gaps. No AI co-author trailer.
