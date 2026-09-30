const { authorize } = require('../lib/admin');
const SENTRY_ORG = process.env.SENTRY_ORG || 'nautical-ops';
const SENTRY_PROJECT = process.env.SENTRY_PROJECT || 'nautical-ops-mobile';

module.exports = async function(req, res) {
  if (!authorize(req, res, ['GET'])) return;
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-admin-password, content-type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const password = req.headers['x-admin-password'];
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.SENTRY_READ_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'SENTRY_READ_TOKEN is not set on this deployment' });
  }

  // Sentry only accepts '', '24h' or '14d' here - anything else is a 400.
  const period = req.query && req.query.period === '24h' ? '24h' : '14d';
  const url =
    'https://sentry.io/api/0/projects/' +
    encodeURIComponent(SENTRY_ORG) + '/' +
    encodeURIComponent(SENTRY_PROJECT) +
    '/issues/?per_page=100&statsPeriod=' + period + '&query=' + encodeURIComponent('lastSeen:-' + period);

  try {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });

    if (!r.ok) {
      return res.status(502).json({
        error: 'Sentry returned ' + r.status,
      });
    }

    const raw = await r.json();
    if (!Array.isArray(raw)) {
      return res.status(502).json({ error: 'Unexpected response from Sentry' });
    }

    const issues = raw.map(function(i) {
      return {
        id: i.id,
        title: i.title || 'Untitled',
        culprit: i.culprit || '',
        count: Number(i.count) || 0,
        userCount: Number(i.userCount) || 0,
        level: i.level || 'error',
        status: i.status || 'unresolved',
        firstSeen: i.firstSeen || null,
        lastSeen: i.lastSeen || null,
        permalink: i.permalink || null,
      };
    });

    const unresolved = issues.filter(function(i) { return i.status === 'unresolved'; });
    const totalEvents = issues.reduce(function(sum, i) { return sum + i.count; }, 0);

    return res.status(200).json({
      period: period,
      project: SENTRY_ORG + '/' + SENTRY_PROJECT,
      sentryUrl: 'https://' + SENTRY_ORG + '.sentry.io/issues/',
      summary: {
        issues: issues.length,
        unresolved: unresolved.length,
        events: totalEvents,
      },
      issues: issues,
      hasMore: /rel="next"[^,]*results="true"/.test(r.headers.get('link') || ''),
      countNotice: 'Counts cover the issues shown (up to 100). Events and affected users are lifetime counts for each issue, not totals for this date range.',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reach Sentry: ' + err.message });
  }
};
