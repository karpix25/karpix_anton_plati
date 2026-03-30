import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'nadaraya',
  password: process.env.DB_PASS || '',
  port: parseInt(process.env.DB_PORT || '5432'),
});

export default pool;
