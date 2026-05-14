import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'nadaraya',
  password: process.env.DB_PASS || process.env.DB_PASSWORD || '',
  port: parseInt(process.env.DB_PORT || '5432'),
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT_MS || '15000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '15000', 10),
});

export default pool;
