const { createClient } = require('@supabase/supabase-js');

const PLAN_MONTHLY = {
  '1_5': 79.99, '6_10': 89.99, '11_15': 119.99,
  '16_25': 149.99, '26_40': 199.99, '40_plus': 249.99,
};

const BILLING_DISCOUNTS = {
  monthly: 0, '3_months': 0.05, '6_months': 0.08, '12_months': 0.10,
};

function calcMRR(sub) {
  var monthly = PLAN_MONTHLY[sub.plan_tier] || 0;
  var discount = BILLING_DISCOUNTS[sub.billing_period] || 0;
  return monthly * (1 - discount);
}

function get(obj, key, def) {
  return (obj && obj[key] !== undefined && obj[key] !== null) ? obj[key] : def;
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-admin-password');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var password = req.headers['x-admin-password'];
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  var now = new Date();
  var sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    var results = await Promise.all([
      supabase.from('users').select('id, name, email, role, position, vessel_id, created_at'),
      supabase.from('vessels').select('id, name, created_at'),
      supabase.from('vessel_subscriptions').select('*'),
      supabase.from('users').select('id, created_at').gte('created_at', sevenDaysAgo),
      supabase.from('vessels').select('id, created_at').gte('created_at', sevenDaysAgo),
      supabase.from('trips').select('id', { count: 'exact', head: true }),
      supabase.from('maintenance_logs').select('id', { count: 'exact', head: true }),
      supabase.from('vessel_tasks').select('id', { count: 'exact', head: true }),
      supabase.from('deleted_users').select('*').order('deleted_at', { ascending: false }),
    ]);

    var users = results[0].data || [];
    var vessels = results[1].data || [];
    var subs = results[2].data || [];
    var newUsers = results[3].data || [];
    var newVessels = results[4].data || [];

    var captains = users.filter(function(u) { return u.role === 'HOD'; });
    var crew = users.filter(function(u) { return u.role !== 'HOD'; });
    var movs = captains.filter(function(u) { return u.position === 'Captain (MOV)'; });
    var hods = captains.filter(function(u) { return u.position !== 'Captain (MOV)'; });

    var activeSubs = subs.filter(function(s) {
      return s.status === 'active' && new Date(s.current_period_end) > now;
    });
    var trialSubs = subs.filter(function(s) {
      return s.status === 'trialing' && new Date(s.current_period_end) > now;
    });

    var mrr = activeSubs.reduce(function(sum, s) { return sum + calcMRR(s); }, 0);
    var trialMrr = trialSubs.reduce(function(sum, s) { return sum + calcMRR(s); }, 0);

    var vesselDetails = vessels.map(function(v) {
      var vesselUsers = users.filter(function(u) { return u.vessel_id === v.id; });
      var captain = null;
      for (var i = 0; i < vesselUsers.length; i++) {
        if (vesselUsers[i].role === 'HOD') { captain = vesselUsers[i]; break; }
      }
      var sub = null;
      for (var j = 0; j < subs.length; j++) {
        if (subs[j].vessel_id === v.id && (subs[j].status === 'active' || subs[j].status === 'trialing')) {
          sub = subs[j]; break;
        }
      }
      return {
        id: v.id,
        name: v.name,
        captain: get(captain, 'name', '—'),
        captainEmail: get(captain, 'email', '—'),
        crewCount: vesselUsers.length,
        plan: sub ? sub.plan_tier : '—',
        billingPeriod: sub ? sub.billing_period : '—',
        status: sub ? sub.status : 'no subscription',
        renewalDate: sub ? sub.current_period_end : null,
        createdAt: v.created_at,
        members: vesselUsers.map(function(u) {
          return {
            id: u.id,
            name: u.name || '—',
            email: u.email || '—',
            role: u.role,
            position: u.position || '—',
            createdAt: u.created_at,
          };
        }),
      };
    });

    var fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
    var dailySignups = {};
    for (var d = 13; d >= 0; d--) {
      var day = new Date(now - d * 24 * 60 * 60 * 1000);
      var key = day.toISOString().split('T')[0];
      dailySignups[key] = 0;
    }
    users.forEach(function(u) {
      var day = new Date(u.created_at);
      if (day >= fourteenDaysAgo) {
        var key = day.toISOString().split('T')[0];
        if (dailySignups[key] !== undefined) dailySignups[key]++;
      }
    });

    return res.status(200).json({
      overview: {
        totalCaptains: captains.length,
        totalCrew: crew.length,
        totalUsers: users.length,
        totalVessels: vessels.length,
        activeSubscriptions: activeSubs.length,
        trialSubscriptions: trialSubs.length,
        mrr: Math.round(mrr * 100) / 100,
        trialMrr: Math.round(trialMrr * 100) / 100,
        newUsersLast7Days: newUsers.length,
        newVesselsLast7Days: newVessels.length,
        totalTrips: results[5].count || 0,
        totalMaintenance: results[6].count || 0,
        totalTasks: results[7].count || 0,
      },
      vessels: vesselDetails,
      subscriptions: subs.map(function(s) {
        return Object.assign({}, s, { mrr: calcMRR(s) });
      }),
      dailySignups: dailySignups,
      users: users,
      deletedUsers: results[8].data || [],
    });
  } catch (err) {
    console.error('Dashboard data error:', err);
    return res.status(500).json({ error: 'Failed to fetch data' });
  }
};
