// USD list prices from the mobile app's subscriptionPlans.ts.
// Estimates only: currency, sandbox and tax are not stored in these rows.
const PRICES = {
  '1_5': { monthly: 79.99, '3_months': 229, '6_months': 439, '12_months': 859 },
  '6_10': { monthly: 89.99, '3_months': 249, '6_months': 494.99, '12_months': 969 },
  '11_15': { monthly: 119, '3_months': 339, '6_months': 659 },
  '16_25': { monthly: 149.99, '3_months': 424.99, '6_months': 829 },
  '26_40': { monthly: 199.99, '3_months': 569.99 },
  '40_plus': { monthly: 249.99, '3_months': 709.99 },
};
const MONTHS = { monthly: 1, '3_months': 3, '6_months': 6, '12_months': 12 };
const isCaptain = user => user.role === 'CAPTAIN_MOV';
function subscriptionMetrics(sub, now) {
  const current = new Date(sub.current_period_end).getTime() > now.getTime();
  const isActive = sub.status === 'active' && current;
  const isTrial = sub.status === 'trialing' && current;
  const price = PRICES[sub.plan_tier]?.[sub.billing_period];
  const estimate = price === undefined ? null : price / MONTHS[sub.billing_period];
  return {
    ...sub, isActive, isTrial,
    displayStatus: !current && ['active', 'trialing'].includes(sub.status) ? 'needs verification' : sub.status,
    estimatedMonthly: estimate,
    mrr: isActive ? (estimate || 0) : 0,
    trialMrr: isTrial ? (estimate || 0) : 0,
  };
}
module.exports = { PRICES, MONTHS, isCaptain, subscriptionMetrics };
