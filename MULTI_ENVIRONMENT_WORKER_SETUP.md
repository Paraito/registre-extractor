# Multi-Environment Worker Setup

## Overview

**YES**, both the **Extraction Worker** and **OCR Monitor** are configured to poll jobs from **all three environments**: Production, Staging, and Development.

## Configuration

### Environment Setup

Your `.env` file configures three separate Supabase environments:

```bash
# Production
PROD_SUPABASE_URL=https://sqzqvxqcybghcgrpubsy.supabase.co
PROD_SUPABASE_ANON_KEY=...
PROD_SUPABASE_SERVICE_KEY=...

# Staging
STAGING_SUPABASE_URL=https://qtgeoensuacxrdbgvfjm.supabase.co
STAGING_SUPABASE_ANON_KEY=...
STAGING_SUPABASE_SERVICE_KEY=...

# Development
DEV_SUPABASE_URL=https://tmidwbceewlgqyfmuboq.supabase.co
DEV_SUPABASE_ANON_KEY=...
DEV_SUPABASE_SERVICE_KEY=...
```

### Current Status

✅ **All 3 environments are configured and connected:**
- ✅ Production (prod)
- ✅ Staging (staging)
- ✅ Development (dev)

## How It Works

### 1. Extraction Worker (`src/worker/index.ts`)

The extraction worker polls **all configured environments** for pending jobs:

```typescript
// From src/worker/index.ts line 375-418
private async getNextJob(): Promise<ExtractionQueueJobWithEnv | null> {
  // Get all available environments
  const environments = supabaseManager.getAvailableEnvironments();
  // Returns: ['prod', 'staging', 'dev']
  
  // Poll all environments for pending jobs
  for (const env of environments) {
    const client = supabaseManager.getServiceClient(env);
    
    const { data, error } = await client
      .from('extraction_queue')
      .select('*')
      .eq('status_id', EXTRACTION_STATUS.EN_ATTENTE)  // status_id = 1
      .order('created_at', { ascending: true })
      .limit(1);
    
    // If job found, claim it and return
    if (data && data.length > 0) {
      // Claim the job and return with environment metadata
      return { ...claimedJob, _environment: env };
    }
  }
}
```

**Polling Order:** prod → staging → dev (first-come, first-served)

### 2. OCR Monitor (`src/ocr/monitor.ts`)

The OCR monitor also polls **all configured environments** for documents needing OCR:

```typescript
// From src/ocr/monitor.ts line 98-153
private async processNextDocument(): Promise<void> {
  const environments = supabaseManager.getAvailableEnvironments();
  // Returns: ['prod', 'staging', 'dev']
  
  // Check each environment for documents needing OCR
  for (const env of environments) {
    const client = supabaseManager.getServiceClient(env);
    
    const { data: documents, error } = await client
      .from('extraction_queue')
      .select('*')
      .eq('status_id', EXTRACTION_STATUS.COMPLETE)      // status_id = 3
      .eq('document_source', 'index')                    // Only index docs
      .is('file_content', null)                          // Not yet processed
      .order('created_at', { ascending: true })
      .limit(1);
    
    // If document found, process it
    if (documents && documents.length > 0) {
      await this.processDocument(documents[0], env);
      return; // Only process one per poll cycle
    }
  }
}
```

**Polling Order:** prod → staging → dev (first-come, first-served)

## Job Processing Flow

### Extraction Worker Flow

```
┌─────────────────────────────────────────────────────────┐
│  Worker Polls Every 5 Seconds                           │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Check PROD for jobs (status_id = 1)                    │
│  ├─ Found? → Claim & Process                            │
│  └─ Not found? → Continue                               │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Check STAGING for jobs (status_id = 1)                 │
│  ├─ Found? → Claim & Process                            │
│  └─ Not found? → Continue                               │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Check DEV for jobs (status_id = 1)                     │
│  ├─ Found? → Claim & Process                            │
│  └─ Not found? → Wait 5s and repeat                     │
└─────────────────────────────────────────────────────────┘
```

### OCR Monitor Flow

```
┌─────────────────────────────────────────────────────────┐
│  OCR Monitor Polls Every 10 Seconds                     │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Check PROD for docs (status_id = 3, file_content NULL) │
│  ├─ Found? → Process OCR                                │
│  └─ Not found? → Continue                               │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Check STAGING for docs (status_id = 3, ...)            │
│  ├─ Found? → Process OCR                                │
│  └─ Not found? → Continue                               │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Check DEV for docs (status_id = 3, ...)                │
│  ├─ Found? → Process OCR                                │
│  └─ Not found? → Wait 10s and repeat                    │
└─────────────────────────────────────────────────────────┘
```

## Environment Metadata

When a job is claimed, it includes environment metadata:

```typescript
interface ExtractionQueueJobWithEnv extends ExtractionQueueJob {
  _environment: EnvironmentName; // 'prod' | 'staging' | 'dev'
}
```

This ensures:
- ✅ Jobs are processed in the correct environment
- ✅ Files are uploaded to the correct Supabase Storage bucket
- ✅ Database updates go to the correct environment
- ✅ Logs show which environment the job came from

## Stale Job Handling

Both workers reset stale jobs across **all environments**:

```typescript
// Check for stale jobs (stuck in processing for more than 5 minutes)
const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

for (const env of environments) {
  const { data: staleJobs } = await client
    .from('extraction_queue')
    .select('*')
    .eq('status_id', EXTRACTION_STATUS.EN_TRAITEMENT)
    .lt('processing_started_at', fiveMinutesAgo)
    .limit(1);
  
  if (staleJobs && staleJobs.length > 0) {
    // Reset stale job back to EN_ATTENTE
    await client
      .from('extraction_queue')
      .update({
        status_id: EXTRACTION_STATUS.EN_ATTENTE,
        worker_id: null,
        processing_started_at: null,
      })
      .eq('id', staleJobs[0].id);
  }
}
```

## Verification Commands

### Check Configured Environments
```bash
npx tsx -e "
import { supabaseManager } from './src/utils/supabase';
const envs = supabaseManager.getAvailableEnvironments();
console.log('Environments:', envs);
"
```

### Check Pending Jobs Across All Environments
```bash
npx tsx -e "
import { supabaseManager } from './src/utils/supabase';
import { EXTRACTION_STATUS } from './src/types';

async function checkJobs() {
  const envs = supabaseManager.getAvailableEnvironments();
  
  for (const env of envs) {
    const client = supabaseManager.getServiceClient(env);
    const { data, error } = await client
      .from('extraction_queue')
      .select('id, status_id, document_number')
      .eq('status_id', EXTRACTION_STATUS.EN_ATTENTE)
      .limit(5);
    
    console.log(\`\${env}: \${data?.length || 0} pending jobs\`);
  }
}

checkJobs();
"
```

### Check OCR Pending Across All Environments
```bash
npx tsx -e "
import { supabaseManager } from './src/utils/supabase';
import { EXTRACTION_STATUS } from './src/types';

async function checkOCR() {
  const envs = supabaseManager.getAvailableEnvironments();
  
  for (const env of envs) {
    const client = supabaseManager.getServiceClient(env);
    const { data } = await client
      .from('extraction_queue')
      .select('id')
      .eq('status_id', EXTRACTION_STATUS.COMPLETE)
      .eq('document_source', 'index')
      .is('file_content', null);
    
    console.log(\`\${env}: \${data?.length || 0} docs need OCR\`);
  }
}

checkOCR();
"
```

## Benefits of Multi-Environment Setup

### ✅ Advantages
1. **Single Worker Pool** - One set of workers handles all environments
2. **Resource Efficiency** - No need for separate worker deployments
3. **Automatic Failover** - If one environment is down, others continue
4. **Unified Monitoring** - All jobs visible in one place
5. **Cost Effective** - Shared infrastructure across environments

### ⚠️ Considerations
1. **Priority** - Production jobs are checked first (order: prod → staging → dev)
2. **Isolation** - Jobs from different environments don't interfere
3. **Schema Sync** - All environments should have the same schema (migrations)
4. **Rate Limiting** - Shared worker pool means shared rate limits

## Recommendations

### 1. Ensure Schema Consistency
All environments should have the same database schema:

```bash
# Check if boosted_file_content exists in all environments
npm run migrate:boosted prod
npm run migrate:boosted staging
npm run migrate:boosted dev
```

### 2. Monitor All Environments
```bash
# Check worker status
npm run diagnose

# Check specific row in any environment
npm run diagnose:ocr <row-id>
```

### 3. Environment-Specific Configuration
If you need to process only specific environments, you can:
- Set environment variables to disable certain environments
- Modify the config to filter environments
- Deploy separate workers for each environment

## Summary

**Your current setup:**
- ✅ **3 environments configured** (prod, staging, dev)
- ✅ **Extraction worker polls all 3** environments
- ✅ **OCR monitor polls all 3** environments
- ✅ **Jobs processed in order** (prod → staging → dev)
- ✅ **Environment metadata tracked** for each job

**The row you asked about** (`65a7ee1f-674d-4efa-a4a1-714b89333921`):
- Found in **production** environment
- Already has OCR content (file_content = 1869 chars)
- Won't be picked up by OCR worker (doesn't meet criteria)
- Missing `boosted_file_content` column in production DB

