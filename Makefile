.PHONY: test test-backend test-frontend test-sanity test-watch test-coverage help install-deps prepush-check

# Default help target
help:
	@echo "Hindu Scriptures Platform - Test Commands"
	@echo "=========================================="
	@echo ""
	@echo "Available targets:"
	@echo "  make test              - Run all sanity tests"
	@echo "  make test-backend      - Run backend tests only"
	@echo "  make test-sanity       - Run sanity tests (same as 'test')"
	@echo "  make test-coverage     - Run tests with coverage report"
	@echo "  make test-watch        - Run tests in watch mode (re-run on file change)"
	@echo "  make test-verbose      - Run tests with verbose output"
	@echo "  make test-failed       - Re-run only failed tests"
	@echo "  make prepush-check     - Run frontend production build + backend/frontend sanity tests"
	@echo "  make install-deps      - Install all test dependencies"
	@echo ""
	@echo "Notes:"
	@echo "  - Tests use in-memory SQLite, no database setup needed"
	@echo "  - Run 'make test' at each checkpoint to verify nothing broke"
	@echo ""

# Install dependencies
install-deps:
	@echo "Installing test dependencies..."
	pip install -r requirements.txt
	@echo "✓ Dependencies installed"

# Run all backend sanity tests (default)
test: test-backend

test-sanity: test-backend

# Backend tests only
test-backend:
	pytest tests/test_backend_sanity.py -v

# Run tests with coverage
test-coverage:
	pytest tests/test_backend_sanity.py --cov=api --cov-report=html --cov-report=term
	@echo ""
	@echo "Coverage report generated in htmlcov/index.html"

# Run tests in watch mode (requires pytest-watch)
test-watch:
	@command -v ptw >/dev/null 2>&1 || { echo "Installing pytest-watch..."; pip install pytest-watch; }
	ptw tests/test_backend_sanity.py -- -v

# Run tests with verbose output
test-verbose:
	pytest tests/test_backend_sanity.py -vv -s

# Re-run failed tests only
test-failed:
	pytest tests/test_backend_sanity.py --lf -v

# Run shell script sanity tests
test-script:
	./run_sanity_tests.sh

# Run specific test class (example: make test-class CLASS=TestHealthCheck)
test-class:
	ifdef CLASS
		pytest tests/test_backend_sanity.py::$(CLASS) -v
	else
		@echo "Usage: make test-class CLASS=TestClassName"
		@echo "Example: make test-class CLASS=TestHealthCheck"
	endif

# Run specific test function (example: make test-func FUNC=test_health_check)
test-func:
	ifdef FUNC
		pytest tests/test_backend_sanity.py -k $(FUNC) -v
	else
		@echo "Usage: make test-func FUNC=test_function_name"
		@echo "Example: make test-func FUNC=test_health_check"
	endif

# Quick checkpoint test (fast feedback)
checkpoint:
	@echo "Running checkpoint sanity tests..."
	pytest tests/test_backend_sanity.py::TestHealthCheck -v --tb=short
	pytest tests/test_backend_sanity.py::TestAuthentication -v --tb=short
	pytest tests/test_backend_sanity.py::TestContentBrowsing -v --tb=short
	@echo ""
	@echo "✓ Checkpoint tests completed"

prepush-check:
	./scripts/prepush-check.sh

# Clean up test artifacts
clean:
	rm -rf .pytest_cache __pycache__ .coverage htmlcov test.db
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	@echo "✓ Test artifacts cleaned"
