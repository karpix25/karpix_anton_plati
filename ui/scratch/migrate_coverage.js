const { Pool } = require('pg');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'nadaraya',
  password: process.env.DB_PASS || '',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function migrate() {
  try {
    const res = await pool.query("UPDATE clients SET broll_coverage_percent = 75.0 WHERE broll_coverage_percent IS DISTINCT FROM 75.0");
    console.log(`Successfully updated ${res.rowCount} clients to 75% coverage.`);
    
    // Also update generated_scenarios if they have a similar column
    // (Assuming they might have inherited it, let's check generated_scenarios table meta later if needed, 
    // but usually coverage is a property of the generation request derived from client settings)
    
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
