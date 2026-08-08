const express = require('express');
const { withConnection } = require('../db/oracle');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Admission lookup against the real HIS schema (confirmed against the hospital's
// Oracle DB — see backend/scripts/debugHis.js for how this was diagnosed).
//
// DISREQUESTDETL (discharge request detail) is joined with a LEFT JOIN, not an
// INNER JOIN: a currently-admitted patient has no discharge request row yet, so
// an inner join here would silently exclude every admitted (non-discharged)
// patient — which is exactly what caused "No patient found" for real, admitted
// patients (e.g. GG00238841) even though they exist in IPADMISS. The discharge
// fields (DISC_REQ_DATE etc.) are already nullable on the API response — they
// simply come back null for patients who haven't been discharged yet.
//
// Age/gender/mobile/address come straight off IPADMISS itself (confirmed present
// via backend/scripts/debugHis.js — PTC_SEX, PTN_YEARAGE, PTC_MOBILE, and address
// lines). Address is stored as up to 4 free-text lines in two possible places:
// IPC_PRADD1-4 (permanent address) and PTC_LOADD1-4 (local/current address). In
// practice PTC_LOADD tends to be populated when IPC_PRADD is blank (and vice
// versa), so both are coalesced together, line by line, then joined.
// IP lookup — most recent admission for this UHID
const IP_LOOKUP_SQL = `
  SELECT A.IPD_DATE AS ADMISSION_DATE,
    A.PT_NO AS PT_NO,
    A.PTC_PTNAME AS PT_NAME,
    A.PTC_SEX AS PT_SEX,
    A.PTN_YEARAGE AS PT_AGE,
    A.PTC_MOBILE AS PT_MOBILE,
    NVL(A.IPC_PRADD1, A.PTC_LOADD1) AS ADDR_LINE1,
    NVL(A.IPC_PRADD2, A.PTC_LOADD2) AS ADDR_LINE2,
    NVL(A.IPC_PRADD3, A.PTC_LOADD3) AS ADDR_LINE3,
    NVL(A.IPC_PRADD4, A.PTC_LOADD4) AS ADDR_LINE4,
    B.DOC_NAME AS DOCTOR,
    C.DPC_DESC AS DEPARTMENT,
    F.BDC_NO AS BED,
    G.NSC_DESC AS NUR_STATION,
    E.REQ_DATE AS DISC_REQ_DATE,
    A.IPD_DISC AS DISC_ENTRY_TIME,
    A.DMD_DATE AS DISC_BILLED_TIME
  FROM IPADMISS A, DOCTOR B, DEPARTMENT C, SPECIALITY D, BED F, NURSTATION G, DISREQUESTDETL E
  WHERE A.DO_CODE = B.DO_CODE
    AND B.SP_CODE = D.SP_CODE
    AND C.DP_CODE = D.DP_CODE
    AND A.BD_CODE = F.BD_CODE
    AND F.NS_CODE = G.NS_CODE
    AND A.PT_NO = :uhid
    AND A.IP_NO = E.IP_NO (+)
  ORDER BY A.IPD_DATE DESC
`;

// OP lookup — most recent outpatient visit using PATIENT master + VISITMAST/VISITDETL.
// PATIENT is the central registration table for all patients (IP and OP).
// VISITMAST + VISITDETL hold OP visit records with the treating doctor.
const OP_LOOKUP_SQL = `
  SELECT
    P.PT_NO,
    P.PTC_PTNAME AS PT_NAME,
    P.PTC_SEX AS PT_SEX,
    P.PTN_YEARAGE AS PT_AGE,
    P.PTC_MOBILE AS PT_MOBILE,
    NVL(P.PTC_PRADD1, P.PTC_LOADD1) AS ADDR_LINE1,
    NVL(P.PTC_PRADD2, P.PTC_LOADD2) AS ADDR_LINE2,
    NVL(P.PTC_PRADD3, P.PTC_LOADD3) AS ADDR_LINE3,
    VM.VSD_DATE AS VISIT_DATE,
    B.DOC_NAME AS DOCTOR,
    C.DPC_DESC AS DEPARTMENT
  FROM PATIENT P
  JOIN VISITMAST VM ON VM.PT_NO = P.PT_NO
  JOIN VISITDETL VD ON VD.VS_NO = VM.VS_NO
  JOIN DOCTOR B ON B.DO_CODE = VD.DO_CODE
  JOIN SPECIALITY D ON D.SP_CODE = B.SP_CODE
  JOIN DEPARTMENT C ON C.DP_CODE = D.DP_CODE
  WHERE P.PT_NO = :uhid
  ORDER BY VM.VSD_DATE DESC
`;

function formatGender(sexCode) {
  if (sexCode === 'M') return 'Male';
  if (sexCode === 'F') return 'Female';
  return sexCode || null;
}

function formatAddress(row) {
  const lines = [row.ADDR_LINE1, row.ADDR_LINE2, row.ADDR_LINE3, row.ADDR_LINE4].filter(Boolean);
  return lines.length > 0 ? lines.join(', ') : null;
}

router.get('/:uhid', requireAuth, async (req, res) => {
  const { uhid } = req.params;

  if (!uhid || !uhid.trim()) {
    return res.status(400).json({ error: 'UHID is required.' });
  }

  const trimmedUhid = uhid.trim();

  let ipResult, opResult;
  try {
    [ipResult, opResult] = await withConnection((conn) =>
      Promise.all([
        conn.execute(IP_LOOKUP_SQL, { uhid: trimmedUhid }, { maxRows: 1 }),
        conn.execute(OP_LOOKUP_SQL, { uhid: trimmedUhid }, { maxRows: 1 }),
      ])
    );
  } catch (err) {
    console.error('HIS patient lookup: query/connection error', {
      uhid: trimmedUhid,
      code: err.code,
      message: err.message,
    });
    return res.status(500).json({
      error: 'Unable to reach the Hospital Information System right now. Please try again or enter patient details manually.',
    });
  }

  const ipRow = ipResult.rows && ipResult.rows[0];
  const opRow = opResult.rows && opResult.rows[0];

  if (!ipRow && !opRow) {
    console.debug('HIS patient lookup: no matching row in IP or OP', { uhid: trimmedUhid });
    return res.status(404).json({ error: 'No patient found with this UHID.' });
  }

  // Prefer IP if found (has richer context: bed, ward, admission date).
  // Fall back to OP for outpatients who have no current admission.
  if (ipRow) {
    return res.json({
      uhid: ipRow.PT_NO,
      name: ipRow.PT_NAME,
      age: ipRow.PT_AGE,
      gender: formatGender(ipRow.PT_SEX),
      mobile: ipRow.PT_MOBILE,
      address: formatAddress(ipRow),
      doctor: ipRow.DOCTOR,
      department: ipRow.DEPARTMENT,
      bed: ipRow.BED,
      nurseStation: ipRow.NUR_STATION,
      admissionDate: ipRow.ADMISSION_DATE,
      dischargeRequestDate: ipRow.DISC_REQ_DATE,
      dischargeEntryTime: ipRow.DISC_ENTRY_TIME,
      dischargeBilledTime: ipRow.DISC_BILLED_TIME,
      patientType: 'IP',
    });
  }

  // OP patient
  return res.json({
    uhid: opRow.PT_NO,
    name: opRow.PT_NAME,
    age: opRow.PT_AGE,
    gender: formatGender(opRow.PT_SEX),
    mobile: opRow.PT_MOBILE,
    address: formatAddress(opRow),
    doctor: opRow.DOCTOR,
    department: opRow.DEPARTMENT,
    bed: null,
    nurseStation: null,
    admissionDate: null,
    dischargeRequestDate: null,
    dischargeEntryTime: null,
    dischargeBilledTime: null,
    patientType: 'OP',
    visitDate: opRow.VISIT_DATE,
  });
});

module.exports = router;
