const { authorize, client, readAll, validId, hasText, mutationResult } = require('../lib/admin');
module.exports = async function(req, res) {
  if (!authorize(req, res, ['GET', 'POST'])) return;
  try {
    const db = client();
    if (req.method === 'GET') {
      const [faqs, questions] = await Promise.all([
        readAll(db, 'faqs', '*', 'display_order'), readAll(db, 'user_questions', '*', 'created_at', false),
      ]);
      return res.status(200).json({ faqs, questions });
    }
    const body = req.body || {};
    if ((body.id != null && !validId(body.id)) || (body.type && body.type !== 'answer_question')) return res.status(400).json({ error: 'Invalid request' });
    if (!hasText(body.answer)) return res.status(400).json({ error: 'An answer is required' });
    if (body.type === 'answer_question') {
      if (!validId(body.id)) return res.status(400).json({ error: 'Question id is required' });
      return mutationResult(res, await db.from('user_questions').update({ status: 'answered', answer: body.answer.trim() }).eq('id', body.id).select('id'));
    }
    if (!hasText(body.question)) return res.status(400).json({ error: 'A question is required' });
    const row = { question: body.question.trim(), answer: body.answer.trim() };
    if (body.id) return mutationResult(res, await db.from('faqs').update({ ...row, updated_at: new Date().toISOString() }).eq('id', body.id).select('id'));
    const max = await db.from('faqs').select('display_order').order('display_order', { ascending: false }).limit(1);
    if (max.error) throw max.error;
    return mutationResult(res, await db.from('faqs').insert({ ...row, display_order: (max.data?.[0]?.display_order || 0) + 1 }).select('id'));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to process FAQ data. Please retry.' });
  }
};
