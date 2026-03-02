.PHONY: test test-backend test-frontend test-sanity test-watch test-coverage help install-deps prepush-check api ui

PYTHON := $(if $(wildcard ./venv/bin/python),./venv/bin/python,python)
PIP := $(PYTHON) -m pip
PTW := $(if $(wildcard ./venv/bin/ptw),./venv/bin/ptw,ptw)

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
	@echo "  make api               - Start FastAPI server on http://localhost:8000"
	@echo "  make ui                - Start Next.js frontend on http://localhost:3000"
	@echo "  make install-deps      - Install all test dependencies"
	@echo ""
	@echo "Notes:"
	@echo "  - Tests use in-memory SQLite, no database setup needed"
	@echo "  - Run 'make test' at each checkpoint to verify nothing broke"
	@echo ""

# Install dependencies
install-deps:
	@echo "Installing test dependencies..."
	$(PIP) install -r requirements.txt
	@echo "✓ Dependencies installed"

# Run all backend sanity tests (default)
test: test-backend

test-sanity: test-backend

# Backend tests only
test-backend:
	$(PYTHON) -m pytest tests/test_backend_sanity.py -v

# Run tests with coverage
test-coverage:
	$(PYTHON) -m pytest tests/test_backend_sanity.py --cov=api --cov-report=html --cov-report=term
	@echo ""
	@echo "Coverage report generated in htmlcov/index.html"

# Run tests in watch mode (requires pytest-watch)
test-watch:
	@command -v $(PTW) >/dev/null 2>&1 || { echo "Installing pytest-watch..."; $(PIP) install pytest-watch; }
	$(PTW) tests/test_backend_sanity.py -- -v

# Run tests with verbose output
test-verbose:
	$(PYTHON) -m pytest tests/test_backend_sanity.py -vv -s

# Re-run failed tests only
test-failed:
	$(PYTHON) -m pytest tests/test_backend_sanity.py --lf -v

# Run shell script sanity tests
test-script:
	./run_sanity_tests.sh

# Run specific test class (example: make test-class CLASS=TestHealthCheck)
test-class:
	@if [ -n "$(CLASS)" ]; then \
		$(PYTHON) -m pytest tests/test_backend_sanity.py::$(CLASS) -v; \
	else \
		echo "Usage: make test-class CLASS=TestClassName"; \
		echo "Example: make test-class CLASS=TestHealthCheck"; \
	fi

# Run specific test function (example: make test-func FUNC=test_health_check)
test-func:
	@if [ -n "$(FUNC)" ]; then \
		$(PYTHON) -m pytest tests/test_backend_sanity.py -k $(FUNC) -v; \
	else \
		echo "Usage: make test-func FUNC=test_function_name"; \
		echo "Example: make test-func FUNC=test_health_check"; \
	fi

# Quick checkpoint test (fast feedback)
checkpoint:
	@echo "Running checkpoint sanity tests..."
	$(PYTHON) -m pytest tests/test_backend_sanity.py::TestHealthCheck -v --tb=short
	$(PYTHON) -m pytest tests/test_backend_sanity.py::TestAuthentication -v --tb=short
	$(PYTHON) -m pytest tests/test_backend_sanity.py::TestContentBrowsing -v --tb=short
	@echo ""
	@echo "✓ Checkpoint tests completed"

prepush-check:
	./scripts/prepush-check.sh

api:
	set -a; \
	[ -f .env ] && . ./.env || true; \
	[ -f .env.local ] && . ./.env.local || true; \
	set +a; \
	if [ -x ./venv/bin/python ]; then \
		./venv/bin/python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000; \
	else \
		uvicorn main:app --reload --host 0.0.0.0 --port 8000; \
	fi

ui:
	npm --prefix web run dev

# Clean up test artifacts
clean:
	rm -rf .pytest_cache __pycache__ .coverage htmlcov test.db
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	@echo "✓ Test artifacts cleaned"
