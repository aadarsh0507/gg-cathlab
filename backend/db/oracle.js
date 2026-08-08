const oracledb = require('oracledb');

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

let pool;

async function getPool() {
  if (pool) return pool;

  pool = await oracledb.createPool({
    user: process.env.HIS_ORACLE_USER,
    password: process.env.HIS_ORACLE_PASSWORD,
    connectString: `${process.env.HIS_ORACLE_HOST}:${process.env.HIS_ORACLE_PORT}/${process.env.HIS_ORACLE_SERVICE}`,
    poolMin: 0,
    poolMax: 5,
    poolIncrement: 1,
  });

  return pool;
}

async function withConnection(fn) {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    return await fn(conn);
  } finally {
    await conn.close();
  }
}

module.exports = { getPool, withConnection };
