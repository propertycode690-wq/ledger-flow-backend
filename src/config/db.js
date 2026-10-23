import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/**
 * Execute a read-only database connectivity check against MySQL.
 * Uses a lightweight raw query (SELECT 1) without modifying any data.
 */
export async function testDatabaseConnection() {
  const startTime = Date.now();
  try {
    const result = await prisma.$queryRaw`SELECT 1 AS connected, DATABASE() AS database_name, CURRENT_TIMESTAMP() AS server_time`;
    const rawDetails = Array.isArray(result) && result[0] ? result[0] : result;
    const details = {};
    if (rawDetails && typeof rawDetails === 'object') {
      for (const [k, v] of Object.entries(rawDetails)) {
        details[k] = typeof v === 'bigint' ? Number(v) : v;
      }
    }
    const latencyMs = Date.now() - startTime;
    return {
      connected: true,
      latencyMs,
      details,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    return {
      connected: false,
      latencyMs,
      error: error.message || 'Unknown database connection error',
    };
  }
}

export default prisma;
