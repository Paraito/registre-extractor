# Registre Extractor - Quebec Document Extraction Service

A robust, AI-powered document extraction service for Quebec government registries that handles concurrent extractions using AgentQL for adaptive web scraping.

## 🎯 What It Does

Extracts documents from three Quebec government registries:

1. **Land Registry** (Registre foncier) - Property deeds, cadastral plans, property index
2. **Business Registry** (REQ) - Company information and officer details
3. **Personal & Movable Rights** (RDPRM) - Personal and movable real rights documents

## ✨ Features

- 🤖 **AI-Powered Scraping**: Uses AgentQL to adapt to website changes automatically
- ⚡ **Concurrent Processing**: 9 extraction workers + 5 OCR workers
- 🔄 **Automatic Retry**: Built-in retry logic with exponential backoff
- 📊 **Real-time Monitoring**: Health monitoring and job tracking
- 🗄️ **Supabase Storage**: Secure document storage and metadata management
- 🔍 **OCR Processing**: Gemini/Claude-powered document analysis
- 🌍 **Multi-Environment**: Supports prod/staging/dev environments

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Unified Worker (PM2)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │
│  │   Land      │  │     REQ     │  │      RDPRM       │    │
│  │  Registry   │  │   Scraper   │  │    Scraper       │    │
│  │ Extraction  │  │             │  │                  │    │
│  └─────────────┘  └─────────────┘  └──────────────────┘    │
│         ↓                 ↓                  ↓               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Supabase (Multi-Environment)                │  │
│  │   • extraction_queue                                  │  │
│  │   • search_sessions                                   │  │
│  │   • req_companies                                     │  │
│  │   • rdprm_searches                                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- **Node.js** 20+ (LTS recommended)
- **PM2** (process manager)
- **Supabase** account with configured database
- **API Keys**: BrowserBase, AgentQL, Gemini (optional)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-org/registre-extractor.git
cd registre-extractor
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment variables:
```bash
cp .env.example .env
```

4. Configure your `.env` file with your credentials (see `DEPLOYMENT.md` for details)

5. Build the project:
```bash
npm run build
```

6. Start services with PM2:
```bash
pm2 start ecosystem.config.js
pm2 save
```

### Deployment

For production deployment, see:
- **Quick Start**: `DEPLOYMENT.md` (root directory)
- **Detailed Guide**: `docs/DEPLOYMENT.md`
- **Checklist**: `PRODUCTION_CHECKLIST.md`

## Usage

### API Endpoints

#### Create Extraction Job
```bash
POST /api/extractions
Content-Type: application/json

{
  "lot_number": "2 784 195",
  "circumscription": "Montréal",
  "cadastre": "Cadastre du Québec",
  "priority": "high"
}
```

#### Check Job Status
```bash
GET /api/extractions/{extraction_id}
```

#### List All Jobs
```bash
GET /api/extractions?status=completed
```

#### System Metrics
```bash
GET /api/metrics
```

### Monitoring Dashboard

Access the monitoring dashboard at `http://localhost:3000/`

Features:
- Real-time queue metrics
- Worker health status
- Job tracking and retry capabilities
- System performance indicators

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SUPABASE_URL` | Your Supabase project URL | Required |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | Required |
| `SUPABASE_SERVICE_KEY` | Supabase service role key | Required |
| `REDIS_HOST` | Redis server host | localhost |
| `REDIS_PORT` | Redis server port | 6379 |
| `WORKER_CONCURRENCY` | Number of concurrent workers | 20 |
| `EXTRACTION_TIMEOUT` | Extraction timeout (ms) | 180000 |
| `API_PORT` | API server port | 3000 |

### Worker Accounts

Add your 20 Quebec Registry accounts to the database:

```sql
INSERT INTO worker_accounts (username, password) VALUES
  ('account1', 'password1'),
  ('account2', 'password2'),
  -- ... add all 20 accounts
```

## Development

### Local Development

```bash
# Start worker in development mode
npm run dev

# Start monitor in development mode
npm run monitor:dev

# Start API in development mode
npm run api:dev

# Type checking
npm run typecheck
```

## Deployment

### PM2 Deployment

The project uses PM2 for process management. See `ecosystem.config.js` for configuration.

```bash
# Build the project
npm run build

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### Scaling Considerations

- Each worker requires ~1GB RAM and 0.5 CPU
- Redis requires minimal resources
- API server: 0.5GB RAM, 0.25 CPU
- Monitor: 0.25GB RAM, 0.1 CPU

## Troubleshooting

### Common Issues

1. **Login Failures**
   - Check account credentials in database
   - Verify account isn't locked
   - Check failure_count for accounts

2. **Extraction Timeouts**
   - Increase `EXTRACTION_TIMEOUT`
   - Check Quebec Registry site status
   - Review worker logs

3. **Document Not Found**
   - Verify lot number format
   - Check circumscription/cadastre values
   - Review error screenshots in downloads folder

### Logs

```bash
# View PM2 logs
pm2 logs

# View specific service logs
pm2 logs registre-worker
pm2 logs registre-api
pm2 logs registre-monitor
```

## Security

- All credentials stored securely in environment variables
- Supabase RLS policies protect data access
- Worker accounts rotate automatically on failure
- No sensitive data in logs

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details