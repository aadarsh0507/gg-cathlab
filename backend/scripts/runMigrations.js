require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db/mysql');

async function run() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const conn = await pool.getConnection();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        // Strip SQL line comments then check if anything real remains
        .map((s) => s.replace(/--[^\n]*/g, '').trim())
        .filter((s) => s.length > 0);

      console.log(`Running ${file} (${statements.length} statement(s))...`);
      for (const statement of statements) {
        await conn.query(statement);
      }
    }
    console.log('Migrations applied successfully.');
  } finally {
    conn.release();
  }

  await pool.end();
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
