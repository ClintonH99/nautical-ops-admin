const { createClient } = require('@supabase/supabase-js');

function authorize(req, res, methods) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
  res.setHeader('Access-Control-Allow-Headers', 'x-admin-password, content-type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return false; }
  if (!process.env.ADMIN_PASSWORD || req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Unauthorized' }); return false;
  }
  if (!methods.includes(req.method)) { res.status(405).json({ error: 'Method not allowed' }); return false; }
  return true;
}
function client() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
// PostgREST caps responses. Page each collection in a stable order.
async function readAll(db, table, columns = '*', order = 'id', ascending = true) {
  const rows = [];
  const size = 500;
  for (let offset = 0; ; offset += size) {
    let query = db.from(table).select(columns).order(order, { ascending });
    if (order !== 'id') query = query.order('id');
    const result = await query.range(offset, offset + size - 1);
    if (result.error) throw result.error;
    if (!Array.isArray(result.data)) throw new Error('Invalid collection response');
    rows.push(...result.data);
    if (result.data.length < size) return rows;
  }
}
const validId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const hasText = value => typeof value === 'string' && value.trim().length > 0;
function mutationResult(res, result) {
  if (result.error) throw result.error;
  if (!result.data || (Array.isArray(result.data) && !result.data.length)) {
    return res.status(404).json({ error: 'Record no longer exists. Refresh and try again.' });
  }
  return res.status(200).json(Array.isArray(result.data) ? { success: true } : result.data);
}
module.exports = { authorize, client, readAll, validId, hasText, mutationResult };
