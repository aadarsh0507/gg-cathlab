# Implant Billing System

Full-stack billing system for hospital implant/item invoicing. Runs on the internal
hospital network. Frontend is Vite + React + TypeScript, backend is Node.js + Express,
app data lives in MySQL, and patient demographics are looked up read-only from the
hospital's Oracle HIS database. Patients are billed on MRP — this system does not
compute or bill GST/tax.

## Project structure

```
implant_billing/
├── frontend/        Vite + React + TypeScript frontend
├── backend/         Express backend (CommonJS)
│   ├── db/          MySQL pool + Oracle connection helper
│   ├── middleware/  JWT auth + role-check middleware
│   ├── migrations/  SQL schema
│   ├── routes/      auth, patients, items, invoices, users
│   ├── scripts/     runMigrations.js
│   ├── seed/        seed_admin.js
│   └── src/         Express app entrypoint (index.js)
└── README.md
```

## Prerequisites

- Node.js 18+
- Network access to the MySQL app DB and the Oracle HIS DB (both are on the
  `172.16.x.x` hospital LAN — connections will fail from outside that network,
  which is expected).

## Setup

### 1. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure environment

`backend/.env` has already been created with the credentials you supplied. Review it
before running anything, especially `JWT_SECRET` — replace the placeholder with a
long random secret before this goes anywhere near production:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`backend/.env.example` is the blank template for onboarding/deployment elsewhere.

### 3. Create the database, then run the migration

The migration only creates tables — it does not create the database itself. If
`implant_billing` doesn't already exist on the MySQL server, create it first:

```sql
CREATE DATABASE IF NOT EXISTS implant_billing CHARACTER SET utf8mb4;
```

(Run that in MySQL Workbench, or via `mysql -h <host> -u <user> -p -e "..."`.)

Then run the migrations, which create the `users`, `items`, `invoices`,
`invoice_items`, and `invoice_sequences` tables (plus indexes on invoice_no,
patient_uhid, and item_code), then apply schema updates in order. The runner
executes every `.sql` file in `backend/migrations/` in filename order, so it's
safe to re-run after pulling new migration files:

```bash
cd backend
npm run migrate
```

### 4. Seed an admin user

```bash
cd backend
npm run seed:admin -- --username admin --password "ChangeMe123!" --fullName "System Admin"
```

Or run it with no args and it will prompt interactively for username/password.

### 5. Start the backend

```bash
cd backend
npm run dev   # auto-restarts on file changes (node --watch)
# or: npm start
```

The backend listens on `http://localhost:5000` (configurable via `PORT` in `.env`).

### 6. Start the frontend

```bash
cd frontend
npm run dev
```

The frontend runs on `http://localhost:5173` and talks to the API at
`http://localhost:5000/api` (see `VITE_API_BASE_URL` if you need to override this —
create a `frontend/.env` with `VITE_API_BASE_URL=http://your-server:5000/api`).

### 7. Log in

Visit `http://localhost:5173`, log in with the admin account you seeded, and you're
in. Use the Users page (admin only) to create `billing_staff` accounts for the rest
of the billing desk.

## HIS patient lookup

`GET /api/patients/:uhid` (in `backend/routes/patients.js`) runs a confirmed query
against the hospital's real Oracle HIS schema (owner `ELLIDER`), verified live
against the production DB — not guessed. Table/column names below were confirmed
via `backend/scripts/debugHis.js` (see that script for how to re-verify or
re-diagnose if this ever breaks again).

**Tables joined**: `IPADMISS` (admission record, the primary table) with `DOCTOR`,
`DEPARTMENT`, `SPECIALITY`, `BED`, `NURSTATION`, and `DISREQUESTDETL` (discharge
request detail — **left-joined**, see below), filtered by `IPADMISS.PT_NO = :uhid`
(bind parameter, never interpolated).

**Columns returned, by source**:
| Field | Column | Notes |
|---|---|---|
| Name | `IPADMISS.PTC_PTNAME` | |
| Age | `IPADMISS.PTN_YEARAGE` | also available: `PTN_MONTHAGE`, `PTN_DAYAGE`, `PTD_DOB` for infants/precise DOB |
| Gender | `IPADMISS.PTC_SEX` | raw value is `'M'`/`'F'`, mapped to `Male`/`Female` in `formatGender()` |
| Mobile | `IPADMISS.PTC_MOBILE` | |
| Address | `IPADMISS.IPC_PRADD1..4` coalesced with `PTC_LOADD1..4` | permanent address (`IPC_PRADD*`) and local/current address (`PTC_LOADD*`) are both 4 free-text lines; in practice one is populated and the other is null, so they're combined line-by-line with `NVL()` and joined in `formatAddress()` |
| Doctor | `DOCTOR.DOC_NAME` | via `IPADMISS.DO_CODE` |
| Department | `DEPARTMENT.DPC_DESC` | via `SPECIALITY` (doctor → specialty → department) |
| Bed | `BED.BDC_NO` | via `IPADMISS.BD_CODE` |
| Nursing Station | `NURSTATION.NSC_DESC` | via `BED.NS_CODE` |
| Admission date | `IPADMISS.IPD_DATE` | |
| Discharge request/entry/billed | `DISREQUESTDETL.REQ_DATE` / `IPADMISS.IPD_DISC` / `IPADMISS.DMD_DATE` | null until the patient is actually discharged |

**Bug found and fixed (2026-07-17)**: the query originally **inner-joined**
`DISREQUESTDETL` on `IP_NO`. A currently-admitted patient has no discharge-request
row yet, so the inner join silently excluded every admitted (non-discharged)
patient — confirmed patients returned "No patient found" even though they existed
in `IPADMISS`. Fixed by changing it to a left join
(`AND A.IP_NO = E.IP_NO (+)` — Oracle's legacy outer-join syntax, matching the
rest of the query's non-ANSI comma-join style). Discharge fields simply come back
`null` for patients who haven't been discharged, which is correct.

**Error handling**: a real Oracle connection/query failure returns a generic 500
to the client (no raw Oracle internals leaked) while logging the real error
server-side (table names, Oracle error code). A genuinely empty result set (valid
UHID search, no matching row) returns 404. Every lookup attempt also logs the
exact SQL and bind values at debug level — check the server log first if this
breaks again, rather than re-diagnosing blind.

**Diagnostic script**: `backend/scripts/debugHis.js <UHID>` is a standalone,
read-only diagnostic — connection test, table reachability, a raw `IPADMISS`
lookup with no joins, a check of whether `DISREQUESTDETL` has a matching row, a
full `all_tables` candidate sweep, a synonym check, a run of the app's actual
current query, and a full `IPADMISS` column dump. Run it from a machine on the
hospital LAN (`172.16.7.85:1521`) if patient lookups start failing again.

## Notes on design decisions

- **JWT storage**: the frontend stores the JWT in `localStorage` for simplicity (an
  internal LAN tool). This is fine for this use case, but note the tradeoff: it's
  more exposed to XSS-based token theft than an httpOnly-cookie approach. Don't
  reuse this pattern for a public-facing app without reconsidering it.
- **MRP billing, no GST**: patients are billed at the item's MRP; the system does not
  compute, split, or display any tax (no HSN codes, no CGST/SGST/IGST). `items` tracks
  an internal `purchase_cost` (what we pay the supplier, visible to all roles but not
  patient-facing) separately from `mrp` (what the patient is billed).
- **Invoice numbering**: `IMP-{year}-{6-digit sequence}`, sequence resets each
  calendar year, tracked in the `invoice_sequences` table and incremented inside the
  same transaction as invoice creation (row-locked to avoid duplicate numbers under
  concurrent billing desk usage).
- **Backend-computed totals**: the frontend computes and displays live totals for UX,
  but the backend independently recomputes subtotal/discount/total from the item
  master (`mrp`) and request quantities — frontend-submitted totals are never trusted.
  Invoice-level discount is distributed across lines proportionally by subtotal share,
  so `sum(line_total) === total_amount` exactly.
- **Patient snapshot**: `invoices.patient_*` columns are a snapshot taken at billing
  time, not a live foreign key into the HIS DB, since HIS data can change after the
  bill is finalized and the invoice should reflect what was billed.

## Sanity checks already run

- `frontend`: `npm install` + `npm run build` — passes.
- `backend`: `npm install` + `node -c` syntax check on all `.js` files — passes.
- `backend`: booted the Express app locally to confirm it starts without module
  resolution errors (no live DB connections are attempted at startup — MySQL/Oracle
  connections are made lazily on first query, so DB reachability wasn't and can't be
  tested from outside the hospital LAN).
