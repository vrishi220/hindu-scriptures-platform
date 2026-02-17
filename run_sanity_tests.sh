#!/bin/bash

# Sanity Test Runner Script
# Run this at each checkpoint to verify nothing is broken

set -e  # Exit on first error

echo "=========================================="
echo "Hindu Scriptures Platform - Sanity Tests"
echo "=========================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if pytest is installed
if ! command -v pytest &> /dev/null; then
    echo -e "${RED}Error: pytest not found. Install with: pip install -r requirements.txt${NC}"
    exit 1
fi

# Run backend sanity tests
echo -e "${YELLOW}Running Backend Sanity Tests...${NC}"
echo ""

if pytest tests/test_backend_sanity.py -v --tb=short; then
    echo ""
    echo -e "${GREEN}✓ Backend sanity tests PASSED${NC}"
    BACKEND_PASSED=true
else
    echo ""
    echo -e "${RED}✗ Backend sanity tests FAILED${NC}"
    BACKEND_PASSED=false
fi

echo ""
echo "=========================================="
echo ""

# Summary
if [ "$BACKEND_PASSED" = true ]; then
    echo -e "${GREEN}All sanity tests PASSED!${NC}"
    exit 0
else
    echo -e "${RED}Some sanity tests FAILED!${NC}"
    exit 1
fi
