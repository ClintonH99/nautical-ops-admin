const { authorize, client, readAll } = require('../lib/admin');
const { isCaptain, subscriptionMetrics } = require('../lib/metrics');
module.exports = async function(req, res) {
  if (!authorize(req, res, ['GET'])) return;
  try {
    const db = client();
    const now = new Date();
    const count = async table => {
      const result = await db.from(table).select('id', { count: 'exact', head: true });
      if (result.error) throw result.error;
      if (result.count === null) throw new Error('Count unavailable');
      return result.count;
    };
    const [users, vessels, subscriptions, totalTrips, totalMaintenance, totalTasks, deletedUsers] = await Promise.all([
      readAll(db, 'users', 'id, name, email, role, position, vessel_id, created_at'),
      readAll(db, 'vessels', 'id, name, created_at'),
      readAll(db, 'vessel_subscriptions', 'id, vessel_id, plan_tier, billing_period, status, current_period_start, current_period_end, created_at, updated_at, payment_provider'),
      count('trips'), count('maintenance_logs'), count('vessel_tasks'),
      readAll(db, 'deleted_users', 'id, name, email, role, deleted_at', 'deleted_at', false),
    ]);
    const subs = subscriptions.map(s => subscriptionMetrics(s, now));
    const recent = item => new Date(item.created_at).getTime() >= now.getTime() - 7 * 86400000;
    const captains = users.filter(isCaptain);
    const dailySignups = {};
    for (let d = 13; d >= 0; d--) dailySignups[new Date(now - d * 86400000).toISOString().slice(0, 10)] = 0;
    users.forEach(u => {
      const day = (u.created_at || '').slice(0, 10);
      if (Object.hasOwn(dailySignups, day)) dailySignups[day]++;
    });
    const vesselDetails = vessels.map(v => {
      const members = users.filter(u => u.vessel_id === v.id);
      const captain = members.filter(isCaptain).map(u => u.name || '—').join(', ');
      const captainEmail = members.filter(isCaptain).map(u => u.email || '—').join(', ');
      const sub = subs.filter(s => s.vessel_id === v.id).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
      return {
        id: v.id, name: v.name, captain: captain || '—', captainEmail: captainEmail || '—', crewCount: members.length,
        plan: sub?.plan_tier || '—', billingPeriod: sub?.billing_period || '—', status: sub?.displayStatus || 'no subscription',
        renewalDate: sub?.current_period_end || null, createdAt: v.created_at,
        members: members.map(u => ({ ...u, createdAt: u.created_at })),
      };
    });
    res.status(200).json({
      overview: {
        totalCaptains: captains.length, totalHods: users.filter(u => u.role === 'HOD').length,
        totalCrew: users.filter(u => u.role === 'CREW').length, totalUsers: users.length, totalVessels: vessels.length,
        activeSubscriptions: subs.filter(s => s.isActive).length, trialSubscriptions: subs.filter(s => s.isTrial).length,
        mrr: Math.round(subs.reduce((sum, s) => sum + s.mrr, 0) * 100) / 100,
        trialMrr: Math.round(subs.reduce((sum, s) => sum + s.trialMrr, 0) * 100) / 100,
        newUsersLast7Days: users.filter(recent).length, newCaptainsLast7Days: captains.filter(recent).length,
        newVesselsLast7Days: vessels.filter(recent).length, totalTrips, totalMaintenance, totalTasks,
      },
      revenueNotice: 'USD list-price estimates only. Sandbox purchases cannot be separated in the current database. These figures are not confirmed revenue, payouts or donations.',
      vessels: vesselDetails, subscriptions: subs, users, deletedUsers, dailySignups,
    });
  } catch (error) {
    console.error('Dashboard query failed:', error.code || error.name);
    res.status(500).json({ error: 'Unable to load all dashboard data. Please retry; no totals have been updated.' });
  }
};
