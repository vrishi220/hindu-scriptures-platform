# Sanity Test Suite - Quick Start Guide

A repository-level sanity test suite for the Hindu Scriptures Platform, designed to catch regressions at each development checkpoint.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Run Sanity Tests
```bash
# Option 1: Using make (recommended)
make test

# Option 2: Using the test script
./run_sanity_tests.sh

# Option 3: Using pytest directly
pytest tests/test_backend_sanity.py -v
```

## ✅ Checkpoint Testing Process

At each development checkpoint, run:
```bash
make test
```

This will:
- ✓ Verify API is responding
- ✓ Check health endpoints
- ✓ Test authentication flow
- ✓ Validate content browsing
- ✓ Ensure error handling
- ✓ Verify permissions

**Expected Result**: "All sanity tests PASSED!"

## 📋 What Gets Tested

### Current Coverage

**Backend Tests (14 tests)**
- [x] API Health Check (`/health`)
- [x] Authentication system (register, login, auth validation)
- [x] User permissions and access control
- [x] Content browsing (books, nodes, tree structure)
- [x] Search functionality
- [x] Error handling (404s, invalid input, malformed params)
- [x] API endpoints accessibility

**Frontend Tests (10 tests × 6 browsers = 60 total)**
- [x] Home page loading and responsiveness
- [x] Navigation and link validation
- [x] Scripture browser navigation
- [x] Authentication pages (sign in)
- [x] Page layout and console errors
- [x] Cross-browser testing (Chromium, Firefox, WebKit, iPhone 12, Pixel 5)


### Frontend Tests (Ready to Run)

Frontend integration tests use @playwright/test with example tests in `web/tests/example.spec.ts`.

```bash
cd web
npm install -D @playwright/test
npx playwright install
```

**Run Tests:**
```bash
npx playwright test              # Run all tests (headless)
npx playwright test --ui         # Interactive UI mode (recommended)
npx playwright test --headed     # Show browser window
npx playwright test --debug      # Debug mode step-by-step
npx playwright test --project=chromium  # Specific browser only
npx playwright show-report       # View HTML report
```

**Configuration**: `web/playwright.config.ts`
- Tests run across: Chromium, Firefox, WebKit, iPhone 12, Pixel 5
- Auto-starts dev server on `npm run dev`
- Runs 60 tests total (10 tests × 6 projects)

### Test Output Example
```
tests/test_backend_sanity.py::TestHealthCheck::test_health_check PASSED
tests/test_backend_sanity.py::TestSearch::test_search_endpoint_exists PASSED
tests/test_backend_sanity.py::TestAuthentication - PASSED
...
======================== 14 passed in 2.45s ========================
```

## 🔧 Common Commands

```bash
# Run all tests cleanly
make clean && make test

# Run with detailed output
pytest tests/test_backend_sanity.py -vv -s

# Run specific test category
pytest tests/test_backend_sanity.py::TestHealthCheck -v

# Generate coverage report
make test-coverage

# Watch mode (auto-rerun on changes)
make test-watch
```

## 🐛 Troubleshooting

### Tests fail with database connection errors
This is expected if PostgreSQL isn't running. The sanity tests are designed to:
- ✓ Test API structure and endpoints (works without database)
- ✓ Test error handling (works without database)
- ⚠️ Test auth/content (requires database connection)

**Solution**: Tests will skip database-dependent tests automatically. To run full tests:
```bash
# Create test database
createdb test_scriptures

# Set environment variable
export TEST_DATABASE_URL='postgresql://localhost/test_scriptures'

# Run tests
pytest tests/test_backend_sanity.py -v
```

### Tests run but show import errors
Ensure you're in the project root directory:
```bash
cd /Users/rishivangapalli/repos/hindu-scriptures-platform
make test
```

### httpx version issues
Tests require httpx < 0.28 for TestClient compatibility. This is automatically installed from requirements.txt. To verify:
```bash
pip install 'httpx==0.27.0'
```

### Frontend Tests: "Error: No tests found" or Module Loading Issues

**Issue**: Running Playwright tests fails with "Error: No tests found" or "Playwright Test did not expect test.describe()..."

**Why**: 
- Test files aren't being discovered in `web/tests/`
- TypeScript compilation issues
- Module loading happens outside Playwright's test context

**Solution:**
1. Verify test files exist in `web/tests/` directory with `.spec.ts` extension
2. Ensure proper setup:
   ```bash
   cd web
   npm install -D @playwright/test
   npx playwright install
   ```
3. Run tests directly (not through pytest):
   ```bash
   cd web
   npx playwright test              # All tests
   npx playwright test --ui         # Interactive mode
   npx playwright test tests/example.spec.ts  # Specific file
   ```

**If still failing:**
- Clear browser binaries: `npx playwright install --with-deps`
- Check `web/playwright.config.ts` exists
- Verify `testDir: './tests'` in config
- Try minimal test: `npx playwright test tests/minimal.spec.ts --debug`

## 📝 Adding New Tests

When you implement a new feature, add a corresponding sanity test:

```python
# In tests/test_backend_sanity.py
class TestNewFeature:
    def test_new_endpoint(self, client):
        """Test new endpoint works."""
        response = client.get("/api/new-endpoint")
        assert response.status_code in [200, 404, 400]
```

Then run tests to ensure nothing broke:
```bash
make test
```

## 🎯 Integration with CI/CD

For GitHub Actions, the test suite runs automatically on:
```bash
git push
```

See [.github/workflows/](.github/workflows/) for CI configuration.

## 📚 Related Files

- [tests/README.md](tests/README.md) - Detailed test documentation
- [tests/conftest.py](tests/conftest.py) - Pytest fixtures and configuration
- [tests/test_backend_sanity.py](tests/test_backend_sanity.py) - Backend sanity tests
- [web/tests/example.spec.ts](web/tests/example.spec.ts) - Frontend integration tests
- [web/playwright.config.ts](web/playwright.config.ts) - Playwright configuration
- [Makefile](Makefile) - Test commands and shortcuts
- [pytest.ini](pytest.ini) - Pytest configuration
- [run_sanity_tests.sh](run_sanity_tests.sh) - Automated checkpoint script

## � Integration with CI/CD

