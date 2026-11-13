import { cfg } from './config.js';
import { getUsage, addUsage, projectUnitsToday, countTenants } from './db.js';

// YouTube API unit costs (approx, official quota table)
export const COST = { list: 1, insert: 50, moderate: 50, chatList: 5, chatInsert: 20 };

/**
 * Quota PURE Google project ka hota hai (sab creators ke beech shared).
 * Isliye: har creator ko "fair share" milta hai, aur project 90% bharne par sab rok dete hain.
 */
export async function budgetFor(tenantId) {
  const tenants = Math.max(1, await countTenants());
  const fair = Math.floor((cfg.projectQuota * 0.9) / tenants);
  return Math.max(100, Math.min(cfg.tenantMaxUnits, fair));
}

export async function canSpend(tenantId, units) {
  const [used, budget, project] = await Promise.all([getUsage(tenantId), budgetFor(tenantId), projectUnitsToday()]);
  if (project + units > cfg.projectQuota * 0.9) return false;
  return used.units + units <= budget;
}
export const spend = (tenantId, units) => addUsage(tenantId, units, 0);
export const countAi = (tenantId) => addUsage(tenantId, 0, 1);
export async function aiAllowed(tenantId) {
  return (await getUsage(tenantId)).ai_replies < cfg.tenantMaxAiReplies;
}
