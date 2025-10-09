import Redis from 'ioredis';
import { config } from './src/config';
import { logger } from './src/utils/logger';

/**
 * Script to check Redis connectivity and health
 */
async function checkRedis() {
  console.log('🔍 Checking Redis connection...\n');
  console.log(`Host: ${config.redis.host}`);
  console.log(`Port: ${config.redis.port}`);
  console.log(`Password: ${config.redis.password ? '***' : 'none'}\n`);

  const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    retryStrategy: (times) => {
      if (times > 3) {
        return null; // Stop retrying
      }
      return Math.min(times * 100, 3000);
    },
  });

  try {
    // Test basic connectivity
    console.log('📡 Testing basic connectivity...');
    const pong = await redis.ping();
    console.log(`✅ PING response: ${pong}\n`);

    // Test write operation
    console.log('✍️  Testing write operation...');
    await redis.set('test:health-check', 'OK', 'EX', 60);
    console.log('✅ Write successful\n');

    // Test read operation
    console.log('📖 Testing read operation...');
    const value = await redis.get('test:health-check');
    console.log(`✅ Read successful: ${value}\n`);

    // Get Redis info
    console.log('📊 Redis Server Info:');
    const info = await redis.info('server');
    const lines = info.split('\r\n');
    for (const line of lines) {
      if (line && !line.startsWith('#')) {
        console.log(`   ${line}`);
      }
    }
    console.log('');

    // Check memory usage
    console.log('💾 Memory Info:');
    const memInfo = await redis.info('memory');
    const memLines = memInfo.split('\r\n');
    for (const line of memLines) {
      if (line && !line.startsWith('#') && 
          (line.includes('used_memory') || line.includes('maxmemory'))) {
        console.log(`   ${line}`);
      }
    }
    console.log('');

    // Check for Bull queues
    console.log('🔍 Checking for Bull queues...');
    const keys = await redis.keys('bull:*');
    if (keys.length > 0) {
      console.log(`✅ Found ${keys.length} Bull queue keys:`);
      const queueNames = new Set<string>();
      keys.forEach(key => {
        const match = key.match(/^bull:([^:]+)/);
        if (match) {
          queueNames.add(match[1]);
        }
      });
      queueNames.forEach(name => {
        console.log(`   - ${name}`);
      });
    } else {
      console.log('⚠️  No Bull queue keys found');
    }
    console.log('');

    // Check for stale jobs in Bull queues
    console.log('🔍 Checking for stale jobs in Bull queues...');
    for (const queueName of ['extraction-queue', 'extraction-queue-v2']) {
      try {
        const activeKey = `bull:${queueName}:active`;
        const activeJobs = await redis.llen(activeKey);
        const waitingKey = `bull:${queueName}:wait`;
        const waitingJobs = await redis.llen(waitingKey);
        const delayedKey = `bull:${queueName}:delayed`;
        const delayedJobs = await redis.zcard(delayedKey);
        const failedKey = `bull:${queueName}:failed`;
        const failedJobs = await redis.llen(failedKey);
        
        console.log(`   Queue: ${queueName}`);
        console.log(`     Active: ${activeJobs}`);
        console.log(`     Waiting: ${waitingJobs}`);
        console.log(`     Delayed: ${delayedJobs}`);
        console.log(`     Failed: ${failedJobs}`);
      } catch (e) {
        console.log(`   Queue: ${queueName} - not found or error`);
      }
    }
    console.log('');

    // Clean up test key
    await redis.del('test:health-check');

    console.log('✅ Redis is healthy and working correctly!\n');
    
  } catch (error) {
    console.error('❌ Redis health check failed:');
    console.error(error);
    console.log('\n⚠️  Possible issues:');
    console.log('   1. Redis server is not running');
    console.log('   2. Incorrect host/port configuration');
    console.log('   3. Authentication failure (wrong password)');
    console.log('   4. Network connectivity issues');
    console.log('   5. Firewall blocking the connection\n');
    
    if (config.redis.host === 'localhost' || config.redis.host === '127.0.0.1') {
      console.log('💡 To start Redis locally:');
      console.log('   - macOS: brew services start redis');
      console.log('   - Linux: sudo systemctl start redis');
      console.log('   - Docker: docker run -d -p 6379:6379 redis\n');
    }
  } finally {
    redis.disconnect();
  }
}

// Run the check
checkRedis()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Script error:', error);
    process.exit(1);
  });

