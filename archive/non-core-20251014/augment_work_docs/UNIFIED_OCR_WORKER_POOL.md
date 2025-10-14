# Unified OCR Worker Pool - Dynamic Resource Allocation

## 🎯 Concept

**Instead of**: Fixed worker counts (5 index + 10 acte)

**Use**: Dynamic worker pool that adapts to queue composition

---

## 💡 How It Works

### Single OCR Queue

All OCR jobs (index + acte) go into the **same** `extraction_queue` table:

```sql
SELECT * FROM extraction_queue 
WHERE status_id = 3  -- Ready for OCR
ORDER BY created_at ASC;
```

**Queue composition changes dynamically**:
- Morning: 50 index documents, 10 actes → Allocate more index workers
- Afternoon: 5 index documents, 100 actes → Allocate more acte workers
- Evening: 20 index, 20 actes → Balanced allocation

---

### Dynamic Worker Pool

**Single configuration**:
```bash
OCR_WORKER_POOL_SIZE=15         # Total OCR workers (index + acte combined)
OCR_MIN_INDEX_WORKERS=1         # Always keep at least 1 index worker
OCR_MIN_ACTE_WORKERS=1          # Always keep at least 1 acte worker
OCR_REBALANCE_INTERVAL_MS=30000 # Rebalance every 30 seconds
```

**Workers are generic** - they can process EITHER index OR acte documents based on queue needs.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    EXTRACTION QUEUE                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  ID  │  Type  │  Status  │  Priority  │  Created      │  │
│  ├──────┼────────┼──────────┼───────────┼───────────────┤  │
│  │  1   │ index  │    3     │    10     │  10:00 AM     │  │
│  │  2   │ acte   │    3     │     5     │  10:01 AM     │  │
│  │  3   │ index  │    3     │    10     │  10:02 AM     │  │
│  │  4   │ acte   │    3     │     5     │  10:03 AM     │  │
│  │  5   │ acte   │    3     │     5     │  10:04 AM     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              WORKER POOL MANAGER (Redis)                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Queue Analysis:                                      │  │
│  │  - Index docs waiting: 2                             │  │
│  │  - Acte docs waiting: 3                              │  │
│  │  - Ratio: 40% index, 60% acte                        │  │
│  │                                                       │  │
│  │  Worker Allocation (15 total):                       │  │
│  │  - Index workers: 6 (40% of 15)                      │  │
│  │  - Acte workers: 9 (60% of 15)                       │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   GENERIC OCR WORKERS                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Worker 1    │  │  Worker 2    │  │  Worker 3    │      │
│  │  Mode: INDEX │  │  Mode: INDEX │  │  Mode: ACTE  │ ...  │
│  │  CPU: 1.5    │  │  CPU: 1.5    │  │  CPU: 1      │      │
│  │  RAM: 750MB  │  │  RAM: 750MB  │  │  RAM: 512MB  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔄 Dynamic Rebalancing Algorithm

### Step 1: Analyze Queue Composition

```typescript
interface QueueAnalysis {
  indexCount: number;
  acteCount: number;
  totalCount: number;
  indexRatio: number;  // 0.0 - 1.0
  acteRatio: number;   // 0.0 - 1.0
}

async function analyzeQueue(): Promise<QueueAnalysis> {
  // Count documents by type
  const indexCount = await supabase
    .from('extraction_queue')
    .select('id', { count: 'exact' })
    .eq('status_id', 3)
    .eq('document_source', 'index');
  
  const acteCount = await supabase
    .from('extraction_queue')
    .select('id', { count: 'exact' })
    .eq('status_id', 3)
    .eq('document_source', 'acte');
  
  const total = indexCount + acteCount;
  
  return {
    indexCount,
    acteCount,
    totalCount: total,
    indexRatio: total > 0 ? indexCount / total : 0.5,
    acteRatio: total > 0 ? acteCount / total : 0.5
  };
}
```

---

### Step 2: Calculate Optimal Worker Allocation

```typescript
interface WorkerAllocation {
  indexWorkers: number;
  acteWorkers: number;
  totalWorkers: number;
}

function calculateAllocation(
  analysis: QueueAnalysis,
  poolSize: number,
  minIndex: number = 1,
  minActe: number = 1
): WorkerAllocation {
  // If queue is empty, use balanced allocation
  if (analysis.totalCount === 0) {
    return {
      indexWorkers: Math.floor(poolSize / 2),
      acteWorkers: Math.ceil(poolSize / 2),
      totalWorkers: poolSize
    };
  }
  
  // Calculate based on queue ratio
  let indexWorkers = Math.round(poolSize * analysis.indexRatio);
  let acteWorkers = poolSize - indexWorkers;
  
  // Enforce minimums
  if (indexWorkers < minIndex) {
    indexWorkers = minIndex;
    acteWorkers = poolSize - minIndex;
  }
  
  if (acteWorkers < minActe) {
    acteWorkers = minActe;
    indexWorkers = poolSize - minActe;
  }
  
  return {
    indexWorkers,
    acteWorkers,
    totalWorkers: poolSize
  };
}
```

---

### Step 3: Rebalance Workers

```typescript
async function rebalanceWorkers(
  currentAllocation: WorkerAllocation,
  targetAllocation: WorkerAllocation
): Promise<void> {
  // Calculate changes needed
  const indexDiff = targetAllocation.indexWorkers - currentAllocation.indexWorkers;
  const acteDiff = targetAllocation.acteWorkers - currentAllocation.acteWorkers;
  
  // Convert workers from acte to index
  if (indexDiff > 0 && acteDiff < 0) {
    const workersToConvert = Math.min(Math.abs(indexDiff), Math.abs(acteDiff));
    
    for (let i = 0; i < workersToConvert; i++) {
      // Find an idle acte worker
      const acteWorker = await findIdleWorker('acte');
      if (acteWorker) {
        // Switch it to index mode
        await switchWorkerMode(acteWorker.id, 'index');
      }
    }
  }
  
  // Convert workers from index to acte
  if (acteDiff > 0 && indexDiff < 0) {
    const workersToConvert = Math.min(Math.abs(acteDiff), Math.abs(indexDiff));
    
    for (let i = 0; i < workersToConvert; i++) {
      // Find an idle index worker
      const indexWorker = await findIdleWorker('index');
      if (indexWorker) {
        // Switch it to acte mode
        await switchWorkerMode(indexWorker.id, 'acte');
      }
    }
  }
}
```

---

## 💻 Generic OCR Worker Implementation

### Worker Can Process Both Types

```typescript
class GenericOCRWorker {
  private workerId: string;
  private currentMode: 'index' | 'acte' | 'idle';
  private isProcessing: boolean = false;
  
  async start(): Promise<void> {
    while (!this.shouldStop) {
      // Check current mode assignment from Redis
      const assignedMode = await this.getAssignedMode();
      
      if (assignedMode !== this.currentMode) {
        await this.switchMode(assignedMode);
      }
      
      // Get next job for current mode
      const job = await this.getNextJob(this.currentMode);
      
      if (!job) {
        // No jobs for current mode, wait
        await sleep(5000);
        continue;
      }
      
      // Process job based on type
      this.isProcessing = true;
      
      if (job.document_source === 'index') {
        await this.processIndexDocument(job);
      } else if (job.document_source === 'acte') {
        await this.processActeDocument(job);
      }
      
      this.isProcessing = false;
    }
  }
  
  private async switchMode(newMode: 'index' | 'acte'): Promise<void> {
    // Wait for current job to finish
    while (this.isProcessing) {
      await sleep(1000);
    }
    
    // Release old resources
    await capacityManager.releaseResources(this.workerId);
    
    // Allocate new resources
    const workerType = newMode === 'index' ? 'index-ocr' : 'acte-ocr';
    await capacityManager.allocateResources(this.workerId, workerType);
    
    this.currentMode = newMode;
    
    logger.info(`Worker ${this.workerId} switched to ${newMode} mode`);
  }
  
  private async getNextJob(mode: 'index' | 'acte'): Promise<Job | null> {
    const documentSource = mode === 'index' ? 'index' : 'acte';
    
    // Atomic job claiming
    const { data } = await supabase
      .from('extraction_queue')
      .update({
        status_id: 2,
        worker_id: this.workerId
      })
      .eq('status_id', 3)
      .eq('document_source', documentSource)
      .is('worker_id', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .select()
      .single();
    
    return data;
  }
}
```

---

## 📊 Example Scenarios

### Scenario 1: Morning Rush - Mostly Index Documents

**Queue**:
- 50 index documents
- 5 acte documents
- Ratio: 91% index, 9% acte

**Worker Allocation (15 total)**:
- Index workers: 13 (91% of 15)
- Acte workers: 2 (9% of 15, but min is 1)

**Result**: Fast processing of index backlog while still handling actes

---

### Scenario 2: Afternoon - Mostly Acte Documents

**Queue**:
- 3 index documents
- 80 acte documents
- Ratio: 4% index, 96% acte

**Worker Allocation (15 total)**:
- Index workers: 1 (min enforced)
- Acte workers: 14 (96% of 15)

**Result**: Fast processing of acte backlog while still handling index

---

### Scenario 3: Balanced Load

**Queue**:
- 25 index documents
- 25 acte documents
- Ratio: 50% index, 50% acte

**Worker Allocation (15 total)**:
- Index workers: 7 (50% of 15, rounded down)
- Acte workers: 8 (50% of 15, rounded up)

**Result**: Balanced processing of both types

---

### Scenario 4: Empty Queue

**Queue**:
- 0 index documents
- 0 acte documents

**Worker Allocation (15 total)**:
- Index workers: 7 (default 50%)
- Acte workers: 8 (default 50%)

**Result**: Ready to handle either type when jobs arrive

---

## 🔧 Configuration

### Simplified .env

```bash
# ============================================
# UNIFIED OCR WORKER POOL
# ============================================
# Single pool of workers that dynamically handle both index and acte OCR

OCR_WORKER_POOL_SIZE=15         # Total OCR workers (auto-allocated between index/acte)
OCR_MIN_INDEX_WORKERS=1         # Minimum index workers (always available)
OCR_MIN_ACTE_WORKERS=1          # Minimum acte workers (always available)
OCR_REBALANCE_INTERVAL_MS=30000 # How often to rebalance (30 seconds)

# Worker pool will automatically allocate workers based on queue composition:
# - If queue is 80% index, 20% acte → 12 index workers, 3 acte workers
# - If queue is 20% index, 80% acte → 3 index workers, 12 acte workers
# - If queue is empty → 50/50 split (7 index, 8 acte)

# Server capacity limits (same as before)
SERVER_MAX_CPU=16
SERVER_MAX_RAM=32
```

---

## 💡 Benefits

### 1. **Maximum Efficiency**

- No idle workers when queue is unbalanced
- Resources allocated where needed
- Faster overall processing

### 2. **Automatic Adaptation**

- No manual configuration changes
- Responds to workload patterns
- Handles bursts gracefully

### 3. **Guaranteed Coverage**

- Always at least 1 worker for each type
- Never starve one document type
- Parallel processing maintained

### 4. **Simpler Configuration**

- One number: `OCR_WORKER_POOL_SIZE=15`
- No need to guess optimal split
- System figures it out automatically

### 5. **Better Resource Utilization**

- Workers switch modes when idle
- No wasted capacity
- Maximizes throughput

---

## 🎯 Recommended Pool Sizes by Server

| Server Size | Pool Size | Index (50/50) | Acte (50/50) | CPU | RAM |
|-------------|-----------|---------------|--------------|-----|-----|
| Small (4 vCPU, 8 GB) | 2 | 1 | 1 | 2.5 | 1.25 GB |
| Medium (8 vCPU, 16 GB) | 4 | 2 | 2 | 5 | 2.5 GB |
| Large (16 vCPU, 32 GB) | 8 | 4 | 4 | 10 | 5 GB |
| XL (32 vCPU, 64 GB) | 15 | 7 | 8 | 18.75 | 9.4 GB |

**Note**: Actual allocation changes dynamically based on queue composition!

---

## 🚀 Implementation Priority

1. **Create GenericOCRWorker** - Can process both index and acte
2. **Create WorkerPoolManager** - Analyzes queue and rebalances
3. **Add mode switching** - Workers can change type dynamically
4. **Test rebalancing** - Verify workers switch correctly
5. **Monitor performance** - Ensure no thrashing (too frequent switches)

---

## 💡 Key Takeaways

1. ✅ **Single pool, dynamic allocation** - Much simpler than fixed counts
2. ✅ **Queue-driven** - Workers adapt to actual workload
3. ✅ **Always parallel** - Min 1 worker per type guarantees coverage
4. ✅ **Efficient** - No idle workers when queue is unbalanced
5. ✅ **Self-optimizing** - Automatically finds best allocation
6. ✅ **One configuration** - Just set pool size, system handles rest

---

**This is a much better architecture!** 🎉

