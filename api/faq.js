const { createClient } = require('@supabase/supabase-js');

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-admin-password, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const password = req.headers['x-admin-password'];
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (req.method === 'GET') {
    try {
      const [faqsRes, questionsRes] = await Promise.all([
        supabase.from('faqs').select('*').order('display_order', { ascending: true }),
        supabase.from('user_questions').select('*').order('created_at', { ascending: false })
      ]);
      return res.status(200).json({
        faqs: faqsRes.data || [],
        questions: questionsRes.data || []
      });
    } catch(e) {
      return res.status(500).json({ error: 'Failed to fetch FAQ data' });
    }
  }

  if (req.method === 'POST') {
    const body = req.body;

    if (body.type === 'answer_question') {
      const { error } = await supabase
        .from('user_questions')
        .update({ status: 'answered', answer: body.answer })
        .eq('id', body.id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (body.id) {
      const { error } = await supabase
        .from('faqs')
        .update({ question: body.question, answer: body.answer, updated_at: new Date().toISOString() })
        .eq('id', body.id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    } else {
      const maxOrder = await supabase.from('faqs').select('display_order').order('display_order', { ascending: false }).limit(1);
      const nextOrder = (((maxOrder.data || [])[0] && (maxOrder.data || [])[0].display_order) || 0) + 1;
      const { error } = await supabase
        .from('faqs')
        .insert({ question: body.question, answer: body.answer, display_order: nextOrder });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
