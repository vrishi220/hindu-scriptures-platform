#!/bin/bash

# Hindu Scriptures Platform - Setup Script
# Automates initial setup for development environment

set -e  # Exit on any error

echo "🕉️  Hindu Scriptures Platform Setup"
echo "=================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python 3 not found. Please install Python 3.11+${NC}"
    exit 1
fi
PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
echo -e "${GREEN}✓ Python $PYTHON_VERSION${NC}"

# Check PostgreSQL
if ! command -v psql &> /dev/null; then
    echo -e "${RED}❌ PostgreSQL not found. Please install PostgreSQL 14+${NC}"
    exit 1
fi
POSTGRES_VERSION=$(psql --version | cut -d' ' -f3)
echo -e "${GREEN}✓ PostgreSQL $POSTGRES_VERSION${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js 18+${NC}"
    exit 1
fi
NODE_VERSION=$(node --version)
echo -e "${GREEN}✓ Node.js $NODE_VERSION${NC}"

echo ""

# Database setup
echo "🗄️  Database Setup"
echo "=================="

# Check if .env exists
if [ ! -f backend/.env ]; then
    echo -e "${YELLOW}⚠️  No .env file found. Creating from template...${NC}"
    
    read -p "PostgreSQL username [postgres]: " DB_USER
    DB_USER=${DB_USER:-postgres}
    
    read -sp "PostgreSQL password: " DB_PASSWORD
    echo ""
    
    read -p "Database name [hindu_scriptures]: " DB_NAME
    DB_NAME=${DB_NAME:-hindu_scriptures}
    
    read -p "Database host [localhost]: " DB_HOST
    DB_HOST=${DB_HOST:-localhost}
    
    read -p "Database port [5432]: " DB_PORT
    DB_PORT=${DB_PORT:-5432}
    
    # Generate secret key
    SECRET_KEY=$(openssl rand -hex 32)
    
    # Create .env file
    cat > backend/.env << EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}
SECRET_KEY=${SECRET_KEY}
ENVIRONMENT=development
EOF
    
    echo -e "${GREEN}✓ Created backend/.env${NC}"
else
    echo -e "${GREEN}✓ .env file exists${NC}"
    source backend/.env
fi

# Create database if it doesn't exist
echo ""
read -p "Create database '$DB_NAME' if it doesn't exist? (y/n) [y]: " CREATE_DB
CREATE_DB=${CREATE_DB:-y}

if [ "$CREATE_DB" = "y" ]; then
    PGPASSWORD=$DB_PASSWORD psql -U $DB_USER -h $DB_HOST -p $DB_PORT -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
    PGPASSWORD=$DB_PASSWORD psql -U $DB_USER -h $DB_HOST -p $DB_PORT -c "CREATE DATABASE $DB_NAME"
    echo -e "${GREEN}✓ Database ready${NC}"
fi

# Run migrations
echo ""
read -p "Run database migrations? (y/n) [y]: " RUN_MIGRATIONS
RUN_MIGRATIONS=${RUN_MIGRATIONS:-y}

if [ "$RUN_MIGRATIONS" = "y" ]; then
    echo "Running schema.sql..."
    PGPASSWORD=$DB_PASSWORD psql -U $DB_USER -h $DB_HOST -p $DB_PORT -d $DB_NAME -f schema.sql
    echo -e "${GREEN}✓ Applied schema.sql${NC}"
    
    if [ -f migrations/add_node_references.sql ]; then
        echo "Running add_node_references.sql..."
        PGPASSWORD=$DB_PASSWORD psql -U $DB_USER -h $DB_HOST -p $DB_PORT -d $DB_NAME -f migrations/add_node_references.sql
        echo -e "${GREEN}✓ Applied add_node_references.sql${NC}"
    fi
fi

echo ""

# Backend setup
echo "🐍 Backend Setup"
echo "================"

if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    echo -e "${GREEN}✓ Virtual environment created${NC}"
fi

echo "Activating virtual environment..."
source venv/bin/activate

echo "Installing Python dependencies..."
pip install -q --upgrade pip
pip install -q -r requirements.txt
echo -e "${GREEN}✓ Python dependencies installed${NC}"

echo ""

# Frontend setup
echo "⚛️  Frontend Setup"
echo "=================="

cd web

if [ ! -d "node_modules" ]; then
    echo "Installing Node.js dependencies..."
    npm install --silent
    echo -e "${GREEN}✓ Node.js dependencies installed${NC}"
else
    echo -e "${GREEN}✓ Node.js dependencies already installed${NC}"
fi

cd ..

echo ""
echo "✅ Setup Complete!"
echo ""
echo -e "${GREEN}🚀 To start the platform:${NC}"
echo ""
echo "  Terminal 1 (Backend):"
echo "    source venv/bin/activate"
echo "    cd backend"
echo "    uvicorn main:app --reload"
echo ""
echo "  Terminal 2 (Frontend):"
echo "    cd web"
echo "    npm run dev"
echo ""
echo -e "${GREEN}📖 Access the platform at:${NC}"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8000"
echo "  API Docs: http://localhost:8000/docs"
echo ""
echo -e "${YELLOW}📚 Next steps:${NC}"
echo "  1. Create an admin user (see docs/ADMIN.md)"
echo "  2. Create a content schema at /admin/schemas"
echo "  3. Create your first book at /admin/schemas"
echo "  4. Start adding content!"
echo ""
