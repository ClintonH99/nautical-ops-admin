const { createClient } = require('@supabase/supabase-js');

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-admin-password, content-type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const password = req.headers['x-admin-password'];
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('expenses').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const { name, amount, period } = req.body;
      if (!name || !amount || !period) return res.status(400).json({ error: 'Missing fields' });
      const { data, error } = await supabase.from('expenses').insert([{ name, amount: parseFloat(amount), payment_type: period }]).select().single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'PUT') {
      const { id, name, amount, period } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const { data, error } = await supabase.from('expenses').update({ name, amount: parseFloat(amount), payment_type: period, updated_at: new Date().toISOString() }).eq('id', id).select().single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const { error } = await supabase.from('expenses').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Expenses error:', err);
    return res.status(500).json({ error: 'Failed to process request' });
  }
};
