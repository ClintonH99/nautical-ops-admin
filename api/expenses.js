const { authorize, client, readAll, validId, hasText, mutationResult } = require('../lib/admin');
module.exports = async function(req, res) {
  if (!authorize(req, res, ['GET', 'POST', 'PUT', 'DELETE'])) return;
  try {
    const db = client();
    if (req.method === 'GET') return res.status(200).json(await readAll(db, 'expenses', '*', 'created_at', false));
    const { id, name, amount, period } = req.body || {};
    if (req.method !== 'POST' && !validId(id)) return res.status(400).json({ error: 'Invalid expense id' });
    if (req.method === 'DELETE') return mutationResult(res, await db.from('expenses').delete().eq('id', id).select('id'));
    if (!hasText(name) || !['string', 'number'].includes(typeof amount) || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || !['monthly', 'weekly', 'annual', 'once-off'].includes(period)) {
      return res.status(400).json({ error: 'Enter a name, positive amount and valid payment type' });
    }
    const row = { name: name.trim(), amount: Number(amount), payment_type: period };
    const query = req.method === 'POST' ? db.from('expenses').insert(row) : db.from('expenses').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id);
    return mutationResult(res, await query.select().maybeSingle());
  } catch (error) {
    return res.status(500).json({ error: 'Failed to process expense. Please retry.' });
  }
};
