# 🔐 Worker Accounts System

**Last Updated**: October 15, 2025  
**Purpose**: Explain how the registre-extractor manages Quebec Registry login credentials

---

## 📋 Overview

The registre-extractor uses a **database-driven account management system** to handle Quebec Registry login credentials. This is NOT done through environment variables.

### Key Features

- ✅ **Centralized Storage**: All accounts stored in `worker_accounts` table in Supabase
- ✅ **Automatic Distribution**: Workers automatically fetch available accounts
- ✅ **Load Balancing**: Least-recently-used account selection
- ✅ **Failure Tracking**: Accounts with repeated failures are automatically skipped
- ✅ **Multi-Worker Support**: Multiple workers can use different accounts simultaneously
- ✅ **Easy Management**: Add/remove accounts via SQL without redeploying

---

## 🗄️ Database Schema

### `worker_accounts` Table

```sql
CREATE TABLE worker_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,              -- Quebec Registry username
  password TEXT NOT NULL,              -- Quebec Registry password
  is_active BOOLEAN DEFAULT true,      -- Enable/disable account
  last_used TIMESTAMPTZ,               -- Last time account was used
  failure_count INTEGER DEFAULT 0,     -- Number of consecutive failures
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `worker_status` Table

```sql
CREATE TABLE worker_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id TEXT UNIQUE NOT NULL,      -- Unique worker identifier
  status TEXT NOT NULL,                -- 'idle', 'busy', 'error', 'offline'
  current_job_id UUID,                 -- Current job being processed
  account_id UUID REFERENCES worker_accounts(id),  -- Account being used
  last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  jobs_completed INTEGER DEFAULT 0,
  jobs_failed INTEGER DEFAULT 0
);
```

---

## 🔄 How It Works

### 1. Worker Initialization

When a worker starts:

```typescript
// src/worker/index.ts - initialize()
async initialize(): Promise<void> {
  // 1. Register worker in worker_status table
  await this.registerWorker();
  
  // 2. Get an available account from worker_accounts
  this.currentAccount = await this.getAvailableAccount();
  
  // 3. Link account to worker status
  this.workerStatus.account_id = this.currentAccount.id;
  
  // 4. Initialize browser and login
  await this.initializeExtractor();
  await this.extractor.login();
}
```

### 2. Account Selection Algorithm

```typescript
// src/worker/index.ts - getAvailableAccount()
private async getAvailableAccount(): Promise<WorkerAccount> {
  const { data: accounts } = await supabase
    .from('worker_accounts')
    .select('*')
    .eq('is_active', true)           // Only active accounts
    .lt('failure_count', 3)          // Skip accounts with 3+ failures
    .order('last_used', { 
      ascending: true,               // Least recently used first
      nullsFirst: true               // Never-used accounts first
    })
    .limit(1);                       // Get one account
  
  // Mark account as in use
  await supabase
    .from('worker_accounts')
    .update({ last_used: new Date().toISOString() })
    .eq('id', account.id);
  
  return account;
}
```

**Selection Priority**:
1. Never-used accounts (`last_used IS NULL`)
2. Least recently used accounts
3. Only accounts with `is_active = true`
4. Only accounts with `failure_count < 3`

### 3. Account Usage

```typescript
// src/worker/extractor-ai.ts - login()
async login(): Promise<void> {
  // Fill login form with account credentials
  await loginElements.usernameField.fill(this.account.username);
  await loginElements.passwordField.fill(this.account.password);
  await loginElements.submitButton.click();
  
  // Verify login success
  if (loginFailed) {
    throw new Error('Login failed');
  }
}
```

### 4. Heartbeat & Status Updates

```typescript
// src/worker/index.ts - startHeartbeat()
private startHeartbeat(): void {
  this.heartbeatInterval = setInterval(async () => {
    await supabase
      .from('worker_status')
      .update({
        status: this.workerStatus.status,
        last_heartbeat: new Date().toISOString(),
        jobs_completed: this.workerStatus.jobs_completed,
        jobs_failed: this.workerStatus.jobs_failed,
      })
      .eq('worker_id', this.workerId);
  }, 10000); // Every 10 seconds
}
```

---

## 📝 Managing Accounts

### Adding Accounts

```sql
-- Add a single account
INSERT INTO worker_accounts (username, password, is_active) 
VALUES ('username123', 'password123', true);

-- Add multiple accounts
INSERT INTO worker_accounts (username, password, is_active) VALUES
  ('account1', 'pass1', true),
  ('account2', 'pass2', true),
  ('account3', 'pass3', true);
```

### Viewing Accounts

```sql
-- View all accounts
SELECT 
  id, 
  username, 
  is_active, 
  failure_count, 
  last_used,
  created_at
FROM worker_accounts 
ORDER BY last_used NULLS FIRST;

-- View active accounts only
SELECT * FROM worker_accounts 
WHERE is_active = true 
AND failure_count < 3
ORDER BY last_used NULLS FIRST;
```

### Disabling Accounts

```sql
-- Disable a specific account
UPDATE worker_accounts 
SET is_active = false 
WHERE username = 'account1';

-- Disable accounts with high failure count
UPDATE worker_accounts 
SET is_active = false 
WHERE failure_count >= 3;
```

### Resetting Failure Count

```sql
-- Reset failure count for a specific account
UPDATE worker_accounts 
SET failure_count = 0 
WHERE username = 'account1';

-- Reset all failure counts
UPDATE worker_accounts 
SET failure_count = 0;
```

### Deleting Accounts

```sql
-- Delete a specific account
DELETE FROM worker_accounts 
WHERE username = 'account1';

-- Delete inactive accounts
DELETE FROM worker_accounts 
WHERE is_active = false;
```

---

## 🔍 Monitoring

### Check Worker Status

```sql
-- View all workers and their accounts
SELECT 
  ws.worker_id,
  ws.status,
  ws.jobs_completed,
  ws.jobs_failed,
  wa.username as account_username,
  ws.last_heartbeat
FROM worker_status ws
LEFT JOIN worker_accounts wa ON ws.account_id = wa.id
ORDER BY ws.last_heartbeat DESC;
```

### Check Account Usage

```sql
-- See which accounts are being used
SELECT 
  wa.username,
  wa.is_active,
  wa.failure_count,
  wa.last_used,
  ws.worker_id,
  ws.status
FROM worker_accounts wa
LEFT JOIN worker_status ws ON ws.account_id = wa.id
ORDER BY wa.last_used DESC NULLS LAST;
```

### Find Unused Accounts

```sql
-- Accounts that have never been used
SELECT * FROM worker_accounts 
WHERE last_used IS NULL 
AND is_active = true;

-- Accounts not used in last hour
SELECT * FROM worker_accounts 
WHERE last_used < NOW() - INTERVAL '1 hour' 
AND is_active = true;
```

---

## 🛠️ Command Line Tools

### Check Accounts Script

```bash
# Run the check-accounts script
npm run check-accounts

# Or directly
npx ts-node src/check-accounts.ts
```

**Output**:
```
[INFO] Worker accounts in database: 5
[INFO] Account 1: username=30F3315, is_active=true, failure_count=0
[INFO] Account 2: username=account2, is_active=true, failure_count=1
[INFO] Account 3: username=account3, is_active=false, failure_count=3
...
```

---

## ⚠️ Common Issues

### Issue: "No available accounts"

**Cause**: All accounts are either:
- `is_active = false`
- `failure_count >= 3`
- Currently in use by other workers

**Solution**:
```sql
-- Check account status
SELECT username, is_active, failure_count, last_used 
FROM worker_accounts;

-- Reset failure counts if needed
UPDATE worker_accounts SET failure_count = 0;

-- Activate accounts if needed
UPDATE worker_accounts SET is_active = true;
```

### Issue: Account keeps failing

**Cause**: Invalid credentials or account locked

**Solution**:
1. Verify credentials are correct in Quebec Registry website
2. Check if account is locked/suspended
3. Update password in database:
```sql
UPDATE worker_accounts 
SET password = 'new_password', failure_count = 0 
WHERE username = 'account1';
```

### Issue: All workers using same account

**Cause**: Only one account available or timing issue

**Solution**:
- Add more accounts to the database
- Check that accounts have different `last_used` timestamps
- Ensure workers are starting at different times

---

## 🎯 Best Practices

### 1. Account Distribution

**Recommended**: 1-2 accounts per worker instance

- 3 worker instances → 3-6 accounts
- 5 worker instances → 5-10 accounts

### 2. Account Rotation

The system automatically rotates accounts based on `last_used`. No manual intervention needed.

### 3. Failure Handling

- Accounts with `failure_count >= 3` are automatically skipped
- Reset failure counts periodically if you've fixed the underlying issue
- Monitor failure counts to detect credential problems early

### 4. Security

- Store accounts in Supabase (encrypted at rest)
- Use Row Level Security (RLS) policies
- Never commit credentials to git
- Rotate passwords periodically

### 5. Monitoring

- Check `worker_status` table regularly
- Monitor `failure_count` in `worker_accounts`
- Set up alerts for high failure rates
- Track `last_heartbeat` to detect crashed workers

---

## 📊 Example Queries

### Account Health Dashboard

```sql
SELECT 
  COUNT(*) as total_accounts,
  COUNT(*) FILTER (WHERE is_active = true) as active_accounts,
  COUNT(*) FILTER (WHERE failure_count >= 3) as failed_accounts,
  COUNT(*) FILTER (WHERE last_used IS NULL) as unused_accounts,
  COUNT(*) FILTER (WHERE last_used > NOW() - INTERVAL '1 hour') as recently_used
FROM worker_accounts;
```

### Worker Performance

```sql
SELECT 
  worker_id,
  status,
  jobs_completed,
  jobs_failed,
  ROUND(jobs_completed::numeric / NULLIF(jobs_completed + jobs_failed, 0) * 100, 2) as success_rate,
  NOW() - last_heartbeat as time_since_heartbeat
FROM worker_status
ORDER BY jobs_completed DESC;
```

---

## 🔗 Related Files

- **Worker Implementation**: `src/worker/index.ts`
- **Account Types**: `src/types/index.ts`
- **Database Migration**: `supabase/migrations/001_create_extraction_tables.sql`
- **Check Script**: `src/check-accounts.ts`
- **Supabase Client**: `src/utils/supabase.ts`

---

## ✅ Summary

**Key Points**:
- ✅ Accounts are stored in `worker_accounts` table (NOT environment variables)
- ✅ Workers automatically fetch available accounts on startup
- ✅ Least-recently-used selection ensures even distribution
- ✅ Failure tracking prevents using broken accounts
- ✅ Easy to add/remove accounts via SQL
- ✅ No deployment needed to update accounts

**This system allows you to**:
- Scale workers without worrying about account assignment
- Add/remove accounts on the fly
- Monitor account health and usage
- Automatically handle account failures

