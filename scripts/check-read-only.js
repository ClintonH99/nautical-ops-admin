// GET-only integration check. Never writes to Supabase or displays user records.
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  assert.ok(process.env.ADMIN_PASSWORD && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY, 'Required server environment is missing');
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const results = {};
  for (const name of ['data', 'faq', 'expenses', 'updates', 'sentry']) {
    const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() {} };
    await require('../api/' + name)({ method: 'GET', headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, query: {} }, response);
    assert.equal(response.code, 200, name + ' failed: ' + response.body?.error);
    results[name] = response.body;
    console.log(name + ': authenticated GET passed');
  }
  const checks = {
    users: results.data.users.length, vessels: results.data.vessels.length,
    vessel_subscriptions: results.data.subscriptions.length, deleted_users: results.data.deletedUsers.length,
    trips: results.data.overview.totalTrips, maintenance_logs: results.data.overview.totalMaintenance,
    vessel_tasks: results.data.overview.totalTasks, faqs: results.faq.faqs.length,
    user_questions: results.faq.questions.length, expenses: results.expenses.length, app_updates: results.updates.length,
  };
  for (const [table, actual] of Object.entries(checks)) {
    const result = await db.from(table).select('id', { count: 'exact', head: true });
    if (result.error) throw new Error(table + ': count request failed');
    assert.equal(actual, result.count, table + ': totals differ (retry if live records changed during the check)');
    console.log(table + ': count matches (' + actual + ')');
  }
  console.log('All checks passed. No records created, edited or deleted.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
