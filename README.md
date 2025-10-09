# Registre Extractor - Quebec Land Registry Document Extraction Service

A robust, AI-powered document extraction service for the Quebec Land Registry (Registre foncier du Québec) that handles concurrent extractions using AgentQL for adaptive web scraping.

## Features

- 🤖 **AI-Powered Scraping**: Uses AgentQL to adapt to website changes automatically
- ⚡ **Concurrent Processing**: Supports 20 simultaneous extractions
- 🔄 **Automatic Retry**: Built-in retry logic with exponential backoff
- 📊 **Real-time Monitoring**: Web dashboard for system health and job tracking
- 🔌 **n8n Integration**: Ready-to-use workflow templates
- 🗄️ **Supabase Storage**: Secure document storage and metadata management
- 🐳 **Docker Ready**: Fully containerized for easy deployment
- 🔍 **OCR Processing**: Automated OCR for index documents using Google Gemini AI with 60+ correction rules

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   n8n/Client    │────▶│   REST API      │────▶│  Redis Queue    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Supabase     │◀────│  Worker Pool    │◀────│   20 Workers    │
│  Storage & DB   │     │   (Docker)      │     │   (AgentQL)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                │                         │
                                │                         ▼
                                │                 ┌─────────────────┐
                                └────────────────▶│  OCR Monitor    │
                                                  │  (Gemini AI)    │
                                                  └─────────────────┘
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)
- Redis (included in Docker Compose)
- Supabase account with configured database

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-org/registre-extractor.git
cd registre-extractor
```

2. Copy environment variables:
```bash
cp .env.example .env
```

3. Configure your `.env` file with your Supabase credentials and worker accounts.

4. Install dependencies (for local development):
```bash
npm install
```

5. Set up database tables:
```bash
# Run the migration in your Supabase dashboard
# File: supabase/migrations/001_create_extraction_tables.sql
```

6. Generate Docker Compose file:
```bash
npm run docker:generate
```

7. Build and start services:
```bash
npm run docker:build
npm run docker:up
```

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

### n8n Integration

1. Import workflow templates from `n8n/workflows/`
2. Configure the API endpoint in n8n settings
3. Use provided workflow nodes for:
   - Single document extraction
   - Batch processing
   - Automated monitoring
   - Supabase integration

### OCR Processing

The system includes automated OCR processing for index documents using Google's Gemini AI.

**Features:**
- Automatic processing of completed index documents
- 60+ domain-specific correction rules for Quebec land registry
- High accuracy (95%+) text extraction
- Intelligent boost corrections for common OCR errors

**Setup:**
```bash
# 1. Add Gemini API key to .env
GEMINI_API_KEY=your-gemini-api-key

# 2. Install PDF conversion tools
brew install imagemagick poppler  # macOS
# or
sudo apt-get install imagemagick poppler-utils  # Ubuntu

# 3. Run the OCR monitor
npm run ocr:dev  # Development
npm run ocr      # Production

# 4. Test the integration
npm run test:ocr
```

**How it works:**
1. Worker extracts PDF → `status_id = 3` (Complété)
2. OCR Monitor detects index documents needing OCR
3. Converts PDF to image and extracts text with Gemini AI
4. Applies 60+ correction rules (boost)
5. Stores result in `file_content` → `status_id = 5` (Extraction Complété)

For detailed documentation, see [OCR_INTEGRATION.md](OCR_INTEGRATION.md)

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

# Start API in development mode
npm run api:dev

# Run tests
npm test

# Type checking
npm run typecheck

# Linting
npm run lint
```

### Testing Extraction

```bash
# Run test extraction script
npx tsx src/test-extraction.ts
```

## Deployment

### Digital Ocean Deployment

1. Create a Droplet with Docker pre-installed
2. Clone the repository
3. Configure environment variables
4. Run deployment script:

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Scaling Considerations

- Each worker requires ~1GB RAM and 0.5 CPU
- Redis requires minimal resources
- API server: 0.5GB RAM, 0.25 CPU
- Total for 20 workers: ~22GB RAM, 11 CPUs

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
# View all logs
npm run docker:logs

# View specific service logs
docker-compose logs -f worker-1
docker-compose logs -f api
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