# Registre Extractor - Quebec Land Registry Document Extraction Service

A robust, AI-powered document extraction service for the Quebec Land Registry (Registre foncier du Québec) that handles concurrent extractions using AgentQL for adaptive web scraping.

## Features

- 🤖 **AI-Powered Scraping**: Uses AgentQL to adapt to website changes automatically
- ⚡ **Concurrent Processing**: Supports 20 simultaneous extractions
- 🔄 **Automatic Retry**: Built-in retry logic with exponential backoff
- 📊 **Real-time Monitoring**: Web dashboard for system health and job tracking
- 🗄️ **Supabase Storage**: Secure document storage and metadata management

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     Client      │────▶│   REST API      │────▶│  Redis Queue    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Supabase     │◀────│  Worker Pool    │◀────│   20 Workers    │
│  Storage & DB   │     │                 │     │   (AgentQL)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
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

4. Install dependencies:
```bash
npm install
```

5. Set up database tables:
```bash
# Run the migration in your Supabase dashboard
# File: supabase/migrations/001_create_extraction_tables.sql
```

6. Build the project:
```bash
npm run build
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