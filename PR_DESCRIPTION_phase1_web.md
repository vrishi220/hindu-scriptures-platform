# Title
feat(web): add auth-aware preferences/compilations proxies and scriptures basket flow

# Summary
This PR completes Phase 1 web integration for user preferences and compilations by adding frontend API proxy routes, wiring scriptures-page UX for basket + preferences, and adding route-level Playwright coverage for both normal and backend-unavailable modes.

# What Changed
- Added frontend register proxy route:
	- web/src/app/api/auth/register/route.ts
	- Returns structured 502 when backend is unavailable.
- Added frontend preferences proxy route:
	- web/src/app/api/preferences/route.ts
	- Supports GET and PATCH.
	- Retries once using refresh token when access token is expired.
	- Returns structured 502 on backend outage.
- Added frontend compilations proxy route:
	- web/src/app/api/compilations/route.ts
	- Supports POST with refresh-token retry behavior.
	- Returns structured 502 on backend outage.
- Updated scriptures UI page:
	- web/src/app/scriptures/page.tsx
	- Added preferences panel (source language, transliteration options, save action).
	- Added basket flow (add/remove persisted items via localStorage).
	- Added “Save compilation” action posting basket data through frontend proxy.
- Updated and added Playwright coverage:
	- web/tests/api-proxy-routes.spec.ts
	- web/tests/api-proxy-routes-backend-unavailable.spec.ts
	- web/tests/example.spec.ts (stabilized logout regression check for cross-browser reliability)

# Behavior Notes
- Backend-unavailable route tests are intentionally gated and skipped in normal runs unless outage mode is enabled.
- Standard route behavior remains protected for unauthenticated users (401 paths verified).

# Validation
- Frontend (Playwright full run): 90 passed, 10 skipped, 0 failed
- Backend (pytest): 22 passed

# Risk / Impact
- Scope is limited to frontend API proxy layer, scriptures-page UX wiring, and tests.
- No schema migrations or backend API contract changes included in this PR.

# Rollout
- Merge as normal.
- Outage-mode test suite can be run on demand with:
	- EXPECT_BACKEND_UNAVAILABLE_TESTS=1
	- API_BASE_URL pointing to an unavailable endpoint (e.g., 127.0.0.1:9999)

