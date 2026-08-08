// Throwaway diagnostic for HIS Oracle patient lookup issues. Run from a machine
// on the hospital LAN (172.16.7.85 is not reachable elsewhere):
//
//   node scripts/debugHis.js GG00238841
//
// Does NOT touch app code or .env — read-only queries against the live HIS DB.
require('dotenv').config();
const oracledb = require('oracledb');

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const uhid = process.argv[2];
if (!uhid) {
  console.error('Usage: node scripts/debugHis.js <UHID>');
  process.exit(1);
}

function section(title) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

async function main() {
  section('STEP 1: Oracle connection test');
  let conn;
  try {
    conn = await oracledb.getConnection({
      user: process.env.HIS_ORACLE_USER,
      password: process.env.HIS_ORACLE_PASSWORD,
      connectString: `${process.env.HIS_ORACLE_HOST}:${process.env.HIS_ORACLE_PORT}/${process.env.HIS_ORACLE_SERVICE}`,
    });
    const test = await conn.execute('SELECT 1 AS OK FROM DUAL');
    console.log('Connection OK:', test.rows);
  } catch (err) {
    console.error('CONNECTION FAILED:', err.message);
    console.error(err);
    process.exit(1);
  }

  section('STEP 2: Confirm the tables the app currently queries exist and are reachable');
  const currentTables = ['IPADMISS', 'DOCTOR', 'DEPARTMENT', 'SPECIALITY', 'DISREQUESTDETL', 'BED', 'NURSTATION'];
  for (const t of currentTables) {
    try {
      const r = await conn.execute(`SELECT COUNT(*) AS CNT FROM ${t}`);
      console.log(`  ${t}: reachable, ${r.rows[0].CNT} rows`);
    } catch (err) {
      console.log(`  ${t}: ERROR — ${err.message}`);
    }
  }

  section(`STEP 3: Does UHID ${uhid} exist in IPADMISS at all (no joins)?`);
  try {
    const r = await conn.execute(
      `SELECT PT_NO, PTC_PTNAME, IP_NO, DO_CODE, BD_CODE, IPD_DATE, IPD_DISC, DMD_DATE
       FROM IPADMISS WHERE PT_NO = :uhid`,
      { uhid }
    );
    console.log(`  Rows found: ${r.rows.length}`);
    console.log(r.rows);
    if (r.rows.length === 0) {
      console.log('  -> Patient not in IPADMISS under this exact PT_NO. Check for whitespace/case/leading zeros.');
    } else if (!r.rows[0].IPD_DISC) {
      console.log('  -> IPD_DISC (discharge entry time) is NULL: this patient has NOT been discharged.');
      console.log('     The app\'s current query INNER JOINs through DISREQUESTDETL (discharge request');
      console.log('     detail) on IP_NO, which will only have a row once a discharge REQUEST exists.');
      console.log('     A currently-admitted patient with no discharge request yet will legitimately');
      console.log('     produce zero rows from that join — this is the likely root cause.');
    }
  } catch (err) {
    console.log('  ERROR:', err.message);
  }

  section(`STEP 4: Does UHID ${uhid} have a DISREQUESTDETL row (what the current query requires)?`);
  try {
    const r = await conn.execute(
      `SELECT E.* FROM IPADMISS A, DISREQUESTDETL E
       WHERE A.IP_NO = E.IP_NO AND A.PT_NO = :uhid`,
      { uhid }
    );
    console.log(`  Rows found: ${r.rows.length}`);
    console.log(r.rows);
    if (r.rows.length === 0) {
      console.log('  -> Confirms: no discharge-request row yet, so the app\'s current INNER JOIN query');
      console.log('     returns nothing for this (still-admitted) patient, even though IPADMISS has them.');
    }
  } catch (err) {
    console.log('  ERROR:', err.message);
  }

  section('STEP 5: Full candidate table sweep (in case IPADMISS is not actually the right table)');
  try {
    const r = await conn.execute(`
      SELECT owner, table_name FROM all_tables
      WHERE table_name LIKE '%PATIENT%' OR table_name LIKE '%ADMISSION%'
         OR table_name LIKE '%ADMIT%' OR table_name LIKE '%IP%'
         OR table_name LIKE '%VISIT%' OR table_name LIKE '%MASTER%'
         OR table_name LIKE '%UHID%' OR table_name LIKE '%REG%'
      ORDER BY owner, table_name
    `);
    console.log(`  ${r.rows.length} candidate tables:`);
    console.log(r.rows.map((row) => `${row.OWNER}.${row.TABLE_NAME}`).join('\n  '));
  } catch (err) {
    console.log('  ERROR:', err.message);
  }

  section('STEP 6: Synonyms pointing at patient-related objects');
  try {
    const r = await conn.execute(`SELECT synonym_name, table_owner, table_name FROM all_synonyms WHERE synonym_name LIKE '%PATIENT%'`);
    console.log(`  ${r.rows.length} synonyms:`);
    console.log(r.rows);
  } catch (err) {
    console.log('  ERROR:', err.message);
  }

  section(`STEP 7: Try the app's FIXED query (LEFT JOIN on DISREQUESTDETL) for UHID ${uhid}`);
  try {
    const r = await conn.execute(
      `SELECT A.IPD_DATE AS ADMISSION_DATE, A.PT_NO AS PT_NO, A.PTC_PTNAME AS PT_NAME,
         B.DOC_NAME AS DOCTOR, C.DPC_DESC AS DEPARTMENT, F.BDC_NO AS BED, G.NSC_DESC AS NUR_STATION,
         E.REQ_DATE AS DISC_REQ_DATE, A.IPD_DISC AS DISC_ENTRY_TIME, A.DMD_DATE AS DISC_BILLED_TIME
       FROM IPADMISS A, DOCTOR B, DEPARTMENT C, SPECIALITY D, BED F, NURSTATION G, DISREQUESTDETL E
       WHERE A.DO_CODE = B.DO_CODE AND B.SP_CODE = D.SP_CODE
         AND C.DP_CODE = D.DP_CODE AND A.BD_CODE = F.BD_CODE AND F.NS_CODE = G.NS_CODE
         AND A.PT_NO = :uhid
         AND A.IP_NO = E.IP_NO (+)
       ORDER BY A.IPD_DATE DESC`,
      { uhid },
      { maxRows: 1 }
    );
    console.log(`  Rows found: ${r.rows.length}`);
    console.log(r.rows);
    if (r.rows.length > 0) {
      console.log('  -> SUCCESS. This is the query now live in backend/routes/patients.js.');
    }
  } catch (err) {
    console.log('  ERROR:', err.message);
  }

  section('STEP 8: IPADMISS columns — look for age/gender/mobile/address (not currently returned by the app)');
  try {
    const r = await conn.execute(
      `SELECT column_name, data_type FROM all_tab_columns WHERE table_name = 'IPADMISS' ORDER BY column_id`
    );
    console.log(r.rows.map((row) => `  ${row.COLUMN_NAME} (${row.DATA_TYPE})`).join('\n'));
    console.log('  Look through this list for age/DOB, sex/gender, mobile/phone, and address columns.');
    console.log('  The current query only pulls PT_NO/PTC_PTNAME plus admission context (doctor, dept,');
    console.log('  bed, nursing station) — it does not return age/gender/mobile/address at all, since');
    console.log('  those were confirmed absent from this schema in an earlier session. If IPADMISS (or');
    console.log('  a related table) actually has them, they can be added to PATIENT_LOOKUP_SQL.');
  } catch (err) {
    console.log('  ERROR:', err.message);
  }

  await conn.close();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
