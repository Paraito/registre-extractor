# Registre Extractor V2 - Using extraction_queue

This is the updated implementation that uses the `extraction_queue` table in Supabase.

## Key Changes

### Database Structure
- Uses existing `extraction_queue` table
- Field mappings:
  - `document_source`: 'acte', 'index', 'plan_cadastraux'
  - `document_number`: The main document number
  - `document_number_normalized`: Normalized version (spaces removed)
  - `circonscription_fonciere`: Circumscription
  - `cadastre`: Cadastre (required for index and plan_cadastraux)
  - `acte_type`: Type of acte document (required for acte)
  - `status`: 'En attente', 'En traitement', 'Complété', 'Erreur'
  - `processing_started_at`: Timestamp when processing starts
  - `supabase_path`: Path to stored document
  - `attemtps`: Number of attempts (note the typo in database)

### Storage Structure
Documents are stored in three Supabase storage buckets:
1. `index` bucket: For index documents
   - Naming: `{document_number_normalized}-{circonscription}-{cadastre}-{timestamp}.pdf`
2. `actes` bucket: For acte documents
   - Naming: `{document_number_normalized}-{circonscription}-{timestamp}.pdf`
3. `plans-cadastraux` bucket: For plan cadastraux documents
   - Naming: `{document_number_normalized}-{circonscription}-{cadastre}-{timestamp}.pdf`

## Running the V2 Implementation

### 1. Start the API V2
```bash
npm run api:dev:v2
```
This starts the API server on http://localhost:3000

### 2. Start a Worker V2
```bash
npm run dev:v2
```
This starts a worker that:
- Continuously monitors `extraction_queue` for jobs with status 'En attente'
- Sets status to 'En traitement' when starting
- Processes the job and uploads to the correct storage bucket
- Sets status to 'Complété' or 'Erreur'
- Automatically picks up the next job without re-login

### 3. Create Test Jobs

Create an index document extraction:
```bash
npx tsx src/create-test-job-v2-index.ts
```

Create an acte document extraction:
```bash
npx tsx src/create-test-job-v2-acte.ts
```

Create a plan cadastraux extraction:
```bash
npx tsx src/create-test-job-v2-plan.ts
```

### 4. Monitor Progress
Open http://localhost:3000 in your browser to see the monitoring dashboard.

## API Endpoints

### Create Extraction Job
```
POST /api/extractions
{
  "document_source": "index" | "acte" | "plan_cadastraux",
  "document_number": "2784195",
  "circonscription_fonciere": "Montréal",
  "cadastre": "Cadastre du Québec",  // Required for index and plan_cadastraux
  "acte_type": "Acte",  // Required for acte
  "designation_secondaire": ""  // Optional
}
```

### Get Job Status
```
GET /api/extractions/{id}
```

### List Jobs
```
GET /api/extractions?status=all|queued|processing|completed|failed
```

### Retry Failed Job
```
POST /api/extractions/{id}/retry
```

## Worker Behavior

The V2 worker:
1. Logs in once at startup
2. Continuously polls for jobs with status 'En attente'
3. Claims a job by setting status to 'En traitement'
4. Navigates to the appropriate form based on document_source
5. Fills the form with fuzzy matching
6. Downloads the document
7. Uploads to the correct Supabase storage bucket
8. Updates job status to 'Complété'
9. Immediately looks for the next job
10. Never leaves a job in 'En traitement' status

## Error Handling

- If a job fails, status is set to 'Erreur' with error message
- Jobs have a max_attempts field (default 3)
- Failed jobs can be retried via the API
- If attempts < max_attempts, job goes back to 'En attente'
- If attempts >= max_attempts, job stays in 'Erreur'

## Production Deployment

For production:
1. Set up multiple workers with different WORKER_ID environment variables
2. Each worker uses a different account from the worker_accounts table
3. Workers automatically handle failures and retries
4. Monitor via the dashboard at the API endpoint