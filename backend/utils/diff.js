// Shallow field-by-field diff between two plain objects (DB rows). Returns
// { field: { from, to } } for every field whose value differs. Fields present
// only in `after` (e.g. auto-generated columns on create) are included with
// `from: null`; fields only meaningful internally (ids, timestamps) are
// excluded via `ignoreFields`.
function diffObjects(before, after, ignoreFields = []) {
  const ignored = new Set(['id', 'created_at', 'updated_at', ...ignoreFields]);
  const changes = {};

  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);

  for (const key of keys) {
    if (ignored.has(key)) continue;

    const fromValue = before ? before[key] : undefined;
    const toValue = after ? after[key] : undefined;

    const normalize = (v) => (v === undefined ? null : v);
    const a = normalize(fromValue);
    const b = normalize(toValue);

    if (String(a) !== String(b)) {
      changes[key] = { from: a, to: b };
    }
  }

  return changes;
}

module.exports = { diffObjects };
