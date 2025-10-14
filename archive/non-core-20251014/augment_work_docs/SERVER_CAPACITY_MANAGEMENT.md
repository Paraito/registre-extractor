# Server Capacity Management - Complete System Analysis

## 🎯 Executive Summary

**CRITICAL**: We have **3 different worker types** with **vastly different resource requirements**. Without coordination, they could overload the server.

**SOLUTION**: Use Redis to track total server capacity usage across ALL worker types and enforce limits.

---

## 📊 Worker Resource Analysis

### Worker Type 1: Registre Extractor (HEAVY)

**What it does**: Downloads documents from Quebec registry using browser automation

**Resource Usage per Worker**:
- **CPU**: 2-4 vCPUs (browser rendering, JavaScript execution)
- **RAM**: 500 MB - 1 GB (Chromium browser instance)
- **Disk I/O**: High (downloads PDFs, screenshots)
- **Network**: Moderate (website navigation)

**Why it's heavy**:
- Runs full Chromium browser (Playwright)
- Renders web pages
- Executes JavaScript
- Takes screenshots
- Downloads files

**From ecosystem.config.js**:
```javascript
{
  name: 'registre-worker',
  max_memory_restart: '1G',  // Restarts if exceeds 1GB
  instances: 1
}
```

---

### Worker Type 2: Index OCR (MODERATE)

**What it does**: OCR processing for index documents

**Resource Usage per Worker**:
- **CPU**: 1-2 vCPUs (image processing with Sharp)
- **RAM**: 512 MB - 1 GB (image buffers)
- **Disk I/O**: Moderate (temp image files)
- **Network**: High (Gemini API calls)

**Why it's moderate**:
- PDF to image conversion (Sharp library)
- Image upscaling
- Multiple concurrent pages (6-10)
- Gemini API calls (network-bound)

---

### Worker Type 3: Acte OCR (LIGHT)

**What it does**: OCR processing for acte documents using Gemini File API

**Resource Usage per Worker**:
- **CPU**: 1 vCPU (minimal processing)
- **RAM**: 256 MB - 512 MB (small buffers)
- **Disk I/O**: Low (just file uploads)
- **Network**: High (Gemini API calls)

**Why it's light**:
- No image processing
- No browser
- Just file upload + API calls
- Network-bound, not CPU-bound

**From ecosystem.config.js**:
```javascript
{
  name: 'registre-ocr',
  max_memory_restart: '512M',  // Restarts if exceeds 512MB
  instances: 1,
  env: {
    OCR_WORKER_COUNT: '5'  // Can run 5 workers in 512MB
  }
}
```

---

## ⚠️ THE PROBLEM

### Uncoordinated Worker Scaling

**Scenario**: Each system scales independently

| System | Workers | CPU | RAM | Total |
|--------|---------|-----|-----|-------|
| Registre Extractor | 5 | 20 vCPUs | 5 GB | Heavy |
| Index OCR | 5 | 10 vCPUs | 5 GB | Moderate |
| Acte OCR | 10 | 10 vCPUs | 5 GB | Light |
| **TOTAL** | **20** | **40 vCPUs** | **15 GB** | **💥 Server overload** |

**On a typical server (8 vCPUs, 16 GB RAM)**:
- ❌ CPU: 40 vCPUs needed > 8 available → **500% oversubscription**
- ❌ RAM: 15 GB needed < 16 GB available → **Close to limit**
- ❌ Result: **Severe performance degradation, swapping, crashes**

---

## ✅ THE SOLUTION: Unified Capacity Management

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         REDIS                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Server Capacity State                                │  │
│  │  - server:cpu:allocated (vCPUs in use)                │  │
│  │  - server:ram:allocated (GB in use)                   │  │
│  │  - server:workers (all workers with resource usage)   │  │
│  │  - server:limits (max CPU, max RAM)                   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
         │                    │                    │
┌────────┴────────┐  ┌────────┴────────┐  ┌────────┴────────┐
│  Registre       │  │  Index OCR      │  │  Acte OCR       │
│  Extractor      │  │  Workers        │  │  Workers        │
│  Workers        │  │                 │  │                 │
│  (4 vCPU, 1GB)  │  │  (2 vCPU, 1GB)  │  │  (1 vCPU, 512MB)│
│                 │  │                 │  │                 │
│  Before start:  │  │  Before start:  │  │  Before start:  │
│  checkCapacity()│  │  checkCapacity()│  │  checkCapacity()│
│                 │  │                 │  │                 │
│  On start:      │  │  On start:      │  │  On start:      │
│  allocate()     │  │  allocate()     │  │  allocate()     │
│                 │  │                 │  │                 │
│  On stop:       │  │  On stop:       │  │  On stop:       │
│  release()      │  │  release()      │  │  release()      │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 📋 Resource Allocation Strategy

### Define Resource Requirements per Worker Type

```typescript
interface WorkerResourceRequirements {
  type: 'registre' | 'index-ocr' | 'acte-ocr';
  cpu: number;      // vCPUs
  ram: number;      // GB
  priority: number; // 1-10 (higher = more important)
}

const WORKER_RESOURCES: Record<string, WorkerResourceRequirements> = {
  'registre': {
    type: 'registre',
    cpu: 3,      // 2-4 vCPUs average
    ram: 1,      // 1 GB
    priority: 10 // Highest priority (downloads documents)
  },
  'index-ocr': {
    type: 'index-ocr',
    cpu: 1.5,    // 1-2 vCPUs average
    ram: 0.75,   // 750 MB
    priority: 5  // Medium priority
  },
  'acte-ocr': {
    type: 'acte-ocr',
    cpu: 1,      // 1 vCPU
    ram: 0.5,    // 512 MB
    priority: 5  // Medium priority
  }
};
```

### Server Capacity Limits

```typescript
interface ServerCapacity {
  maxCPU: number;      // Total vCPUs available
  maxRAM: number;      // Total RAM in GB
  reservedCPU: number; // Reserved for OS/system (20%)
  reservedRAM: number; // Reserved for OS/system (20%)
}

// Example: 8 vCPU, 16 GB RAM server
const SERVER_CAPACITY: ServerCapacity = {
  maxCPU: 8,
  maxRAM: 16,
  reservedCPU: 1.6,    // 20% reserved
  reservedRAM: 3.2,    // 20% reserved
  // Available: 6.4 vCPUs, 12.8 GB RAM
};
```

---

## 🏗️ Recommended Worker Configurations by Server Size

### Small Server (4 vCPUs, 8 GB RAM)

**Available**: 3.2 vCPUs, 6.4 GB RAM (after 20% reserve)

```yaml
Registre Extractor: 1 worker
  CPU: 3 vCPUs
  RAM: 1 GB

Index OCR: 0 workers
  CPU: 0 vCPUs
  RAM: 0 GB

Acte OCR: 0 workers
  CPU: 0 vCPUs
  RAM: 0 GB

Total Usage:
  CPU: 3 / 3.2 vCPUs (94%)
  RAM: 1 / 6.4 GB (16%)

⚠️ WARNING: Only enough for extraction, no OCR capacity
```

---

### Medium Server (8 vCPUs, 16 GB RAM)

**Available**: 6.4 vCPUs, 12.8 GB RAM (after 20% reserve)

```yaml
Registre Extractor: 1 worker
  CPU: 3 vCPUs
  RAM: 1 GB

Index OCR: 1 worker
  CPU: 1.5 vCPUs
  RAM: 0.75 GB

Acte OCR: 2 workers
  CPU: 2 vCPUs
  RAM: 1 GB

Total Usage:
  CPU: 6.5 / 6.4 vCPUs (102%) ⚠️ Slightly over
  RAM: 2.75 / 12.8 GB (21%)

Adjusted Configuration:
Registre: 1, Index: 1, Acte: 1
  CPU: 5.5 / 6.4 vCPUs (86%) ✅
  RAM: 2.25 / 12.8 GB (18%) ✅
```

---

### Large Server (16 vCPUs, 32 GB RAM)

**Available**: 12.8 vCPUs, 25.6 GB RAM (after 20% reserve)

```yaml
Registre Extractor: 2 workers
  CPU: 6 vCPUs
  RAM: 2 GB

Index OCR: 2 workers
  CPU: 3 vCPUs
  RAM: 1.5 GB

Acte OCR: 3 workers
  CPU: 3 vCPUs
  RAM: 1.5 GB

Total Usage:
  CPU: 12 / 12.8 vCPUs (94%) ✅
  RAM: 5 / 25.6 GB (20%) ✅

Gemini API Usage:
  RPM: (2 × 0) + (2 × 6.7) + (3 × 7.2) = 35 RPM (2.2%)
  TPM: (2 × 0) + (2 × 53K) + (3 × 242K) = 832K TPM (13%)
```

---

### Extra Large Server (32 vCPUs, 64 GB RAM)

**Available**: 25.6 vCPUs, 51.2 GB RAM (after 20% reserve)

```yaml
Registre Extractor: 5 workers
  CPU: 15 vCPUs
  RAM: 5 GB

Index OCR: 5 workers
  CPU: 7.5 vCPUs
  RAM: 3.75 GB

Acte OCR: 10 workers
  CPU: 10 vCPUs
  RAM: 5 GB

Total Usage:
  CPU: 32.5 / 25.6 vCPUs (127%) ❌ OVER CAPACITY
  RAM: 13.75 / 51.2 GB (27%) ✅

Adjusted Configuration:
Registre: 4, Index: 5, Acte: 10
  CPU: 24.5 / 25.6 vCPUs (96%) ✅
  RAM: 12.75 / 51.2 GB (25%) ✅

Gemini API Usage:
  RPM: (5 × 6.7) + (10 × 7.2) = 106 RPM (6.6%)
  TPM: (5 × 53K) + (10 × 242K) = 2.69M TPM (42%)
```

---

## 🔧 Implementation: Capacity Manager

### Create Shared Capacity Manager

**File**: `src/shared/capacity-manager.ts`

```typescript
export class ServerCapacityManager {
  private redis: RedisClientType;
  private serverLimits: ServerCapacity;
  
  async checkCapacity(
    workerType: 'registre' | 'index-ocr' | 'acte-ocr'
  ): Promise<{ allowed: boolean; reason?: string }> {
    const requirements = WORKER_RESOURCES[workerType];
    
    // Get current allocations
    const currentCPU = parseFloat(await this.redis.get('server:cpu:allocated') || '0');
    const currentRAM = parseFloat(await this.redis.get('server:ram:allocated') || '0');
    
    // Calculate available
    const availableCPU = this.serverLimits.maxCPU - this.serverLimits.reservedCPU;
    const availableRAM = this.serverLimits.maxRAM - this.serverLimits.reservedRAM;
    
    // Check if we have capacity
    if (currentCPU + requirements.cpu > availableCPU) {
      return {
        allowed: false,
        reason: `Insufficient CPU (need ${requirements.cpu}, available ${availableCPU - currentCPU})`
      };
    }
    
    if (currentRAM + requirements.ram > availableRAM) {
      return {
        allowed: false,
        reason: `Insufficient RAM (need ${requirements.ram}GB, available ${availableRAM - currentRAM}GB)`
      };
    }
    
    return { allowed: true };
  }
  
  async allocateResources(workerId: string, workerType: string): Promise<void> {
    const requirements = WORKER_RESOURCES[workerType];
    
    // Increment allocated resources
    await this.redis.incrByFloat('server:cpu:allocated', requirements.cpu);
    await this.redis.incrByFloat('server:ram:allocated', requirements.ram);
    
    // Register worker
    await this.redis.hSet('server:workers', workerId, JSON.stringify({
      type: workerType,
      cpu: requirements.cpu,
      ram: requirements.ram,
      startedAt: Date.now()
    }));
  }
  
  async releaseResources(workerId: string): Promise<void> {
    const workerData = await this.redis.hGet('server:workers', workerId);
    if (!workerData) return;
    
    const worker = JSON.parse(workerData);
    
    // Decrement allocated resources
    await this.redis.incrByFloat('server:cpu:allocated', -worker.cpu);
    await this.redis.incrByFloat('server:ram:allocated', -worker.ram);
    
    // Unregister worker
    await this.redis.hDel('server:workers', workerId);
  }
}
```

---

## 📊 Combined Limits: API + Server Capacity

### The Complete Picture

**You need to respect BOTH limits**:

1. **Gemini API Limits** (shared across all OCR workers)
   - 1,600 RPM safe
   - 6.4M TPM safe

2. **Server Capacity Limits** (shared across ALL workers)
   - Available vCPUs (after 20% reserve)
   - Available RAM (after 20% reserve)

### Example: 16 vCPU, 32 GB Server

**Server Capacity Limits**:
- Available: 12.8 vCPUs, 25.6 GB RAM

**Optimal Configuration**:

| Worker Type | Count | CPU | RAM | RPM | TPM |
|-------------|-------|-----|-----|-----|-----|
| Registre | 2 | 6 | 2 GB | 0 | 0 |
| Index OCR | 2 | 3 | 1.5 GB | 13 | 106K |
| Acte OCR | 3 | 3 | 1.5 GB | 22 | 726K |
| **TOTAL** | **7** | **12** | **5 GB** | **35** | **832K** |

**Limits Check**:
- ✅ CPU: 12 / 12.8 vCPUs (94%)
- ✅ RAM: 5 / 25.6 GB (20%)
- ✅ RPM: 35 / 1600 (2.2%)
- ✅ TPM: 832K / 6.4M (13%)

**All limits respected!**

---

## 💡 Best Strategy

### 1. Configure Server Limits in .env

```bash
# Server Capacity Configuration
SERVER_MAX_CPU=8              # Total vCPUs on server
SERVER_MAX_RAM=16             # Total RAM in GB
SERVER_RESERVED_CPU_PERCENT=20  # Reserve 20% for OS
SERVER_RESERVED_RAM_PERCENT=20  # Reserve 20% for OS
```

### 2. Workers Check Capacity Before Starting

```typescript
// Before starting worker
const capacityCheck = await capacityManager.checkCapacity('registre');
if (!capacityCheck.allowed) {
  logger.warn(`Cannot start worker: ${capacityCheck.reason}`);
  await sleep(60000); // Wait and retry
  return;
}

// Allocate resources
await capacityManager.allocateResources(workerId, 'registre');

// Start worker...

// On shutdown
await capacityManager.releaseResources(workerId);
```

### 3. Monitor Both Limits

```bash
# Check server capacity
redis-cli
GET server:cpu:allocated
GET server:ram:allocated
HGETALL server:workers

# Check API limits
GET gemini:rpm:current
GET gemini:tpm:current
```

---

## 🎓 Key Takeaways

1. ✅ **Registre workers are HEAVY** (3 vCPUs, 1 GB each)
2. ✅ **Index OCR workers are MODERATE** (1.5 vCPUs, 750 MB each)
3. ✅ **Acte OCR workers are LIGHT** (1 vCPU, 512 MB each)
4. ✅ **Must track BOTH API limits AND server capacity**
5. ✅ **Reserve 20% of server resources** for OS/system
6. ✅ **Use Redis to coordinate** all worker types
7. ✅ **Start small and scale gradually** based on actual usage

---

**RECOMMENDATION**: Implement unified capacity management to prevent server overload. The registre extractor workers are resource-intensive and must be carefully limited.

