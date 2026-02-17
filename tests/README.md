# Sanity Test Suite

This directory contains the test suite for the Hindu Scriptures Platform. The sanity tests ensure that critical functionality works correctly at each checkpoint.

## Overview

The test suite is organized into:

1. **Backend Tests** (`test_backend_sanity.py`): FastAPI endpoint sanity checks - **READY TO RUN**
2. **Frontend Tests** (`test_frontend_sanity.py`): Frontend integration test stubs using Playwright - **FRAMEWORK READY, IMPLEMENTATION PENDING**
3. **Fixtures** (`conftest.py`): Shared test configuration and fixtures for backend tests

## Quick Start

### Backend Tests

**Install dependencies:**
```bash
pip install -r requirements.txt
```

**Run backend sanity tests:**
```bash
pytest tests/test_backend_sanity.py -v
```

**Run with coverage:**
```bash
pytest tests/test_backend_sanity.py --cov=api --cov-report=html
```

**Run specific test class:**
```bash
pytest tests/test_backend_sanity.py::TestHealthCheck -v
```

**Run with output:**
```bash
pytest tests/test_backend_sanity.py -v -s
```

### Frontend Tests

**Status**: Frontend tests are currently stubs and need implementation with Playwright.

**Option 1: Using pytest-playwright (Recommended for integration with backend tests)**

Install dependencies:
```bash
pip install pytest-playwright
npx playwright install
```

Run tests:
```bash
pytest tests/test_frontend_sanity.py -v
```

Test stubs already exist in `tests/test_frontend_sanity.py` and are ready for implementation.

**Option 2: Using Playwright's native test runner (Full browser automation)**

Install dependencies:
```bash
cd web
npm install -D @playwright/test
npx playwright install
mkdir -p tests
```

Create tests in `web/tests/` (e.g., `web/tests/home.spec.ts`):
```typescript
import { test, expect } from '@playwright/test';

test('home page loads', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await expect(page.title()).toBeTruthy();
});
```

Run tests:
```bash
cd web
npx playwright test --headed  # --headed shows browser
npx playwright test --ui      # Interactive UI (recommended)
npx playwright test --debug   # Debug mode
```

**Frontend Tests Not Yet Implemented**

The stubs in `tests/test_frontend_sanity.py` define what to test. Implement using either approach above.

## Test Categories

### Backend Tests - Checkpoint Validations

**1. Health Check (`TestHealthCheck`)**
- ✓ API is responding
- ✓ `/health` endpoint returns `{"status": "ok"}`

**2. Authentication (`TestAuthentication`)**
- ✓ User registration works
- ✓ Invalid login rejected
- ✓ Unauthenticated requests to protected endpoints rejected

**3. Content Browsing (`TestContentBrowsing`)**
- ✓ Can retrieve books list
- ✓ Can fetch content nodes
- ✓ Can fetch node tree structure

**4. Search (`TestSearch`)**
- ✓ Search endpoint accessible
- ✓ Search accepts query parameters

**5. Permissions (`TestUserPermissions`)**
- ✓ User profile requires authentication
- ✓ Admin endpoints protected properly

**6. Error Handling (`TestErrorHandling`)**
- ✓ Invalid endpoints return 404
- ✓ Invalid JSON handled gracefully
- ✓ Malformed parameters handled

### Frontend Tests - User Journey Validations

**1. Health Check (`TestFrontendHealthCheck`)**
- ✓ Home page loads
- ✓ Scripture browser loads
- ✓ Admin panel protected

**2. Authentication (`TestAuthenticationFlow`)**
- ✓ Sign in page renders with form
- ✓ Sign in form validates input
- ✓ Sign out works properly

**3. Navigation (`TestNavigation`)**
- ✓ Navbar visible on mobile
- ✓ Hamburger menu opens/closes
- ✓ Navigation links work

**4. Scripture Navigation (`TestScriptureNavigation`)**
- ✓ Next button navigates forward
- ✓ Previous button navigates backward
- ✓ Verses ordered numerically (not alphabetically)

**5. Search (`TestSearch`)**
- ✓ Search box visible
- ✓ Search returns results
- ✓ Clear search works

**6. Responsiveness (`TestResponsiveness`)**
- ✓ Mobile layout adapts correctly
- ✓ Tablet layout adapts correctly
- ✓ Desktop layout works properly

## Running All Tests

**Backend + Fixtures:**
```bash
pytest tests/test_backend_sanity.py -v
```

**Specific test category:**
```bash
pytest tests/test_backend_sanity.py::TestAuthentication -v
```

**All tests with verbose output:**
```bash
pytest tests/ -v
```

**With color and summary:**
```bash
pytest tests/test_backend_sanity.py -v --tb=short
```

## Checkpoint Process

Use this test suite at each development checkpoint:

### 1. After API changes:
```bash
pytest tests/test_backend_sanity.py -v
```

### 2. After UI/Navigation changes:
- Verify locally in browser first
- Manual testing recommended until frontend tests are implemented

### 3. Before deployment:
```bash
pytest tests/test_backend_sanity.py -v --tb=short
```

### Frontend Tests (Future):
Once frontend tests are implemented with Playwright:
```bash
# Option 1: With pytest-playwright
pytest tests/test_frontend_sanity.py -v

# Option 2: With @playwright/test (in web/ directory)
cd web && npx playwright test
```

## Test Output Example

```
tests/test_backend_sanity.py::TestHealthCheck::test_health_check PASSED
tests/test_backend_sanity.py::TestAuthentication::test_register_user PASSED
tests/test_backend_sanity.py::TestAuthentication::test_login_invalid_credentials PASSED
tests/test_backend_sanity.py::TestContentBrowsing::test_get_books_list PASSED
...
======================== 15 passed in 0.45s ========================
```

## Adding New Tests

When adding new features:

### Backend API Tests

Add to `test_backend_sanity.py`:
```python
def test_new_endpoint(self, client):
    response = client.get("/api/new-endpoint")
    assert response.status_code in [200, 404]
```

### Frontend Tests

Frontend test stubs are in `test_frontend_sanity.py`. To implement:

**With pytest-playwright:**
```python
def test_new_ui_feature(self, page):
    page.goto("http://localhost:3000")
    assert page.title() != ""
```

**With @playwright/test:**
```typescript
test('new UI feature', async ({ page }) => {
  await page.goto('http://localhost:3000');
  expect(await page.title()).not.toBe('');
});
```

### Update Documentation

Add correspondent validation to this README's "Test Categories" section.

## Debugging Failed Tests

**View detailed error:**
```bash
pytest tests/test_backend_sanity.py::TestHealthCheck::test_health_check -v -s
```

**Show full traceback:**
```bash
pytest tests/test_backend_sanity.py -v --tb=long
```

**Print debug info:**
```bash
pytest tests/test_backend_sanity.py -v -s  # -s captures print statements
```

## CI/CD Integration

For GitHub Actions, create `.github/workflows/sanity-tests.yml`:

```yaml
name: Sanity Tests

on: [push, pull_request]

jobs:
  backend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - run: pip install -r requirements.txt
      - run: pytest tests/test_backend_sanity.py -v
  
  # Frontend tests can be added here once implemented
  # frontend-tests:
  #   runs-on: ubuntu-latest
  #   steps:
  #     - uses: actions/checkout@v3
  #     - uses: actions/setup-node@v3
  #       with:
  #         node-version: '18'
  #     - run: cd web && npm install && npx playwright install
  #     - run: npx playwright test
```

## Troubleshooting

### "Error: No tests found" when running Playwright

**Issue**: Running `npx playwright test --headed` in `web/` directory fails with "No tests found".

**Why**: Playwright looks for test files in `web/tests/`, `web/e2e/`, or files matching `*.spec.ts`/`*.spec.js`.

**Solution**: Create test files in the correct location:
```bash
cd web
mkdir -p tests
# Create test file: web/tests/home.spec.ts
cat > tests/home.spec.ts << 'EOF'
import { test, expect } from '@playwright/test';

test('home page loads', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await expect(page.title()).toBeTruthy();
});
EOF

npx playwright test --headed
```

Or use pytest-playwright with existing stubs:
```bash
pytest tests/test_frontend_sanity.py -v
```

### "unrecognized arguments: --headed"

**Issue**: Running `pytest tests/test_frontend_sanity.py --headed` fails.

**Why**: `--headed` is a Playwright CLI flag, not a pytest argument.

**Solution**:
```bash
# Option 1: Use pytest (no --headed flag)
pytest tests/test_frontend_sanity.py -v

# Option 2: Use Playwright's test runner with proper test structure
cd web
npx playwright test --headed
```

### Tests can't find modules:
```bash
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
pytest tests/
```

### Database connection errors:
- Backend tests don't require a database for API structure tests
- Some auth tests may fail if PostgreSQL isn't running - this is expected
- To run full database tests:
  ```bash
  createdb test_scriptures
  export TEST_DATABASE_URL='postgresql://localhost/test_scriptures'
  pytest tests/test_backend_sanity.py -v
  ```

### Playwright errors:
```bash
npx playwright install --with-deps
```

### API port conflicts:
- Backend tests use TestClient (in-process)
- No port binding needed
- Ensure no other tests are running same fixtures

## Notes

- Backend tests use TestClient (in-process), so they're fast and isolated
- No database setup needed for backend API structure tests
- Frontend tests are stubs and are ready for Playwright implementation
  - Test structure is defined in `test_frontend_sanity.py`
  - Either `pytest-playwright` or `@playwright/test` can be used for implementation
  - See **Option 1** or **Option 2** in Frontend Tests section for setup
- Tests are designed to be run locally and in CI/CD

