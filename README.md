# Hindu Scriptures Platform

A modern web platform for exploring and contributing to Hindu scriptures with interactive navigation, search capabilities, and user authentication.

## Features

- **Interactive Scripture Browser**: Navigate through Hindu scriptures with a hierarchical tree interface
- **Full-Text Search**: Search across scriptures with intelligent matching (exact phrases, substring matching)
- **Daily Verse**: Experience a different verse each day with date-seeded randomization
- **User Contributions**: Authenticated users can add, edit, and organize scripture content
- **Book Assembly**: Combine and reference scriptures across different texts using the pick/insert interface
- **Admin Panel**: User management and schema administration for platform moderators
- **Mobile Responsive**: Fully responsive design optimized for all device sizes

## Tech Stack

### Frontend
- **Framework**: Next.js 14+ with App Router
- **Build Tool**: Turbopack for fast development
- **Styling**: Tailwind CSS
- **State Management**: React hooks with URL-based state preservation
- **Port**: 3000

### Backend
- **Framework**: FastAPI (Python)
- **Database**: PostgreSQL with ILIKE substring matching
- **Port**: 8000

## Prerequisites

- Python 3.9+
- Node.js 18+
- PostgreSQL 12+

## Setup Instructions

### 1. Clone the Repository

```bash
git clone <repository-url>
cd hindu-scriptures-platform
```

### 2. Set Up Backend

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your database credentials and configuration
```

### 3. Set Up Database

```bash
# Ensure PostgreSQL is running, then:
psql -U postgres -d <database_name> -f schema.sql
```

### 4. Set Up Frontend

```bash
# Navigate to web directory
cd web

# Install dependencies
npm install
```

## Running the Application

### Start Backend API Server

```bash
# Make sure venv is activated
python -m uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`

### Start Frontend Development Server

```bash
# In the web directory
npm run dev
```

The frontend will be available at `http://localhost:3000`

## Project Structure

```
.
├── requirements.txt          # Python dependencies
├── schema.sql               # Database schema
├── main.py                  # FastAPI backend application
├── web/                     # Next.js frontend
│   ├── src/
│   │   ├── app/            # Next.js App Router pages and layouts
│   │   ├── components/     # React components
│   │   └── styles/         # Global styles
│   ├── public/             # Static assets
│   └── package.json        # Frontend dependencies
└── README.md
```

## Key Pages

- **Home** (`/`) - Search, daily verse, and scripture overview
- **Scriptures** (`/scriptures`) - Interactive scripture browser with hierarchical tree navigation
- **Explorer** (`/explorer`) - Book assembly interface for creating custom scripture collections
- **Users** (`/admin`) - User management panel (admin only)
- **Schemas** (`/admin/schemas`) - Scripture schema management (admin only)
- **Contribute** (`/contribute`) - Content contribution interface (authenticated users only)

## Authentication

The platform uses session-based authentication with PostgreSQL for user storage. Users have role-based permissions:

- **Admin**: Full platform access, user and schema management
- **Editor**: Can create, edit, and organize content
- **Contributor**: Can suggest and contribute content
- **Viewer**: Read-only access

## Environment Variables

See `.env.example` for required configuration. Key variables include:

- `DATABASE_URL`: PostgreSQL connection string
- `SECRET_KEY`: Session management secret (for backend)

## Development Tips

- The frontend uses SessionStorage to preserve scroll position and SearchParams for state persistence
- Daily verses are seeded by date: `year*10000 + month*100 + day`
- Explorer page allows picking scriptures to insert references into other texts
- All navigation is permission-aware; links only show if user has appropriate access

## Deployment (Free Tier)

### Frontend (Vercel)

1. Sign up at [vercel.com](https://vercel.com)
2. Click "Import Project" → Connect your GitHub repo
3. Vercel auto-detects Next.js
4. Set root directory to `web`
5. Add GitHub repository secrets for CI deploy:
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`
6. Use `.github/workflows/deploy-vercel.yml` to deploy production from GitHub Actions.
7. In Vercel project settings, disable automatic Git-based production deployment so all prod builds come from GitHub Actions (this guarantees numeric `GITHUB_RUN_NUMBER` build metadata on every build).

**Environment Variables on Vercel:**
- `NEXT_PUBLIC_API_URL`: Your Render backend URL (e.g., `https://your-app.onrender.com`)

### Backend (Render)

1. Sign up at [render.com](https://render.com)
2. Create New → Blueprint → Connect your GitHub repo
3. Render uses `render.yaml` configuration automatically
4. Database will be created automatically (Free PostgreSQL)

**Environment Variables on Render:**
- `DATABASE_URL`: Auto-populated by Render PostgreSQL
- `SECRET_KEY`: Auto-generated by Render
- `ALLOWED_ORIGINS`: Your Vercel domain (e.g., `https://your-app.vercel.app`)

### Database Setup

After first deployment, run migrations:
```bash
# Connect to Render shell and run:
psql $DATABASE_URL -f schema.sql
```

Or use Render's "Shell" feature in the dashboard.

### Cost Summary

- **Vercel**: Free forever
- **Render Web Service**: Free (spins down after 15 min inactivity)
- **Render PostgreSQL**: Free (500MB storage)
- **Total**: $0/month

**Note**: Free tier has cold starts (15-50 seconds). Upgrade to paid tier (~$12/month) for always-on service.

## Testing & Quality Assurance

The project includes a comprehensive sanity test suite to ensure no regressions at each checkpoint.

### Running Tests

**Quick sanity check:**
```bash
make test              # Run all backend sanity tests
make checkpoint       # Run quick checkpoint tests
```

**Detailed testing:**
```bash
make test-backend     # Run backend tests only
make test-coverage    # Generate coverage report
make test-verbose     # Verbose output
make test-watch       # Watch mode (re-run on file changes)
```

**Or using pytest directly:**
```bash
pip install -r requirements.txt
pytest tests/test_backend_sanity.py -v
```

### Test Suite Coverage

- **Health Check**: API status and connectivity
- **Authentication**: Login, registration, permissions
- **Content Browsing**: Book retrieval, node hierarchies, tree navigation
- **Search**: Query handling and result retrieval
- **Error Handling**: Invalid inputs, edge cases
- **User Permissions**: Role-based access control

For more details, see [tests/README.md](tests/README.md).

## Browser Support

Modern browsers with ES2020+ support:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## License

[Add your license information here]

### Use Cases
- **Thematic Compilations**: Collect verses on a theme from multiple scriptures
- **Study Guides**: Assemble selected chapters without duplication
- **Comparative Studies**: Reference same verses in different contexts

### Explorer Workflow
1. Go to **/explorer**
2. Filter by schema or search for content
3. Switch to **Pick Mode**
4. Select verses/chapters/sections (any level)
5. Click **Insert into Book**
6. Choose target book and location
7. References created instantly

## Key Concepts

### Content Schemas
Define hierarchical structure:
```json
{
  "name": "Bhagavad Gita",
  "levels": ["Adhyaya", "Shloka"]
}
```

### Content Nodes
Tree structure:
- **Root**: Book itself
- **Intermediate**: Chapters, Kanda, etc.
- **Leaf**: Individual verses with `content_text`
- **Reference**: Points to another node via `referenced_node_id`

## API Endpoints

**Content:**
- `GET /api/content/{book_id}/nested` - Hierarchical tree
- `POST /api/content/nodes` - Create node
- `PATCH /api/content/nodes/{node_id}` - Update node
- `DELETE /api/content/nodes/{node_id}` - Delete node

**Books:**
- `GET /api/books` - List books
- `POST /api/books` - Create book
- `DELETE /api/books/{book_id}` - Delete book (admin)

**References:**
- `POST /api/books/{book_id}/insert-references` - Create references

**Schemas:**
- `GET /api/content/schemas` - List schemas
- `POST /api/content/schemas` - Create schema (admin)

## Development

### Environment Variables

**Backend (.env):**
```bash
DATABASE_URL=postgresql://user:pass@localhost/hindu_scriptures
SECRET_KEY=your-secret-key
ENVIRONMENT=development
```

**Frontend (.env.local):**
```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Common Tasks

**Add Migration:**
```bash
cat > migrations/add_feature.sql << 'EOF'
-- Migration: Feature description
BEGIN;
-- SQL here
COMMIT;
EOF

psql $DATABASE_URL -f migrations/add_feature.sql
```

**Database Queries:**
```bash
# Connect
psql $DATABASE_URL

# Check references
SELECT cn.id, cn.title_en, ref.title_en as referenced_title
FROM content_nodes cn
LEFT JOIN content_nodes ref ON cn.referenced_node_id = ref.id
WHERE cn.referenced_node_id IS NOT NULL;

# Count verses
SELECT COUNT(*) FROM content_nodes WHERE content_text IS NOT NULL;
```

**Code Formatting:**
```bash
# Backend
black backend/ && isort backend/

# Frontend
cd web && npm run lint
```

### Debugging

**Backend with pdb:**
```python
import pdb; pdb.set_trace()
```

**Frontend DevTools:**
- Console: `console.log()`
- React DevTools
- Network tab for API calls

## Troubleshooting

**"Database does not exist":**
```bash
createdb hindu_scriptures
psql hindu_scriptures -f schema.sql
```

**Port in use:**
```bash
kill -9 $(lsof -ti:8000)  # Backend
kill -9 $(lsof -ti:3000)  # Frontend
```

**CORS errors:**
Check `backend/main.py` includes your frontend origin in CORS config.

## Tech Stack

- **Backend**: FastAPI, SQLAlchemy, PostgreSQL
- **Frontend**: Next.js 13+, TypeScript, Tailwind CSS
- **Auth**: Cookie-based sessions
- **Database**: PostgreSQL with JSONB for flexible schemas

## License

[Add license information]

---

**Built with:** FastAPI • Next.js • PostgreSQL • TypeScript • Tailwind CSS
