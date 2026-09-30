const { authorize, client, readAll, validId, hasText, mutationResult } = require('../lib/admin');
module.exports = async function(req, res) {
  if (!authorize(req, res, ['GET', 'POST', 'PUT', 'DELETE'])) return;
  try {
    const db = client();
    if (req.method === 'GET') return res.status(200).json(await readAll(db, 'app_updates', '*', 'created_at', false));
    const body = req.body || {};
    if (req.method !== 'POST' && !validId(body.id)) return res.status(400).json({ error: 'Invalid update id' });
    if (req.method === 'DELETE') return mutationResult(res, await db.from('app_updates').delete().eq('id', body.id).select('id'));
    const status = req.method === 'POST' ? (body.status || 'coming_soon') : body.status;
    if (!['coming_soon', 'released'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const release = { status, released_at: status === 'released' ? new Date().toISOString() : null };
    if (req.method === 'PUT') return mutationResult(res, await db.from('app_updates').update(release).eq('id', body.id).select().maybeSingle());
    if (!hasText(body.title) || !hasText(body.description) || (body.category != null && typeof body.category !== 'string')) return res.status(400).json({ error: 'Enter a title and description' });
    return mutationResult(res, await db.from('app_updates').insert({ title: body.title.trim(), description: body.description.trim(), category: body.category?.trim() || null, ...release }).select().maybeSingle());
  } catch (error) {
    return res.status(500).json({ error: 'Failed to process update. Please retry.' });
  }
};
