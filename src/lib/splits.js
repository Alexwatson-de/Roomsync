// splits.js — expense splitting engine.
//
// Contract: every split function takes an integer total (paise) and returns a
// map { memberId: sharePaise } whose values ALWAYS sum exactly to the total.
// When a split cannot be divided evenly, leftover paise are distributed
// deterministically: one extra paisa each to the first N members in sorted
// member-id order (stable regardless of input order), so repeated computation
// of the same expense always yields identical shares.

export const SPLIT_METHODS = ['equal', 'custom', 'percentage', 'shares'];

function assertTotal(totalPaise) {
  if (!Number.isInteger(totalPaise) || totalPaise <= 0) {
    throw new Error('Split total must be a positive integer amount in paise');
  }
}

function sortedIds(memberIds) {
  const ids = [...memberIds];
  if (ids.length === 0) throw new Error('At least one participant is required');
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate participants');
  return ids.sort();
}

/** Equal split with deterministic remainder distribution. */
export function splitEqual(totalPaise, memberIds) {
  assertTotal(totalPaise);
  const ids = sortedIds(memberIds);
  const base = Math.floor(totalPaise / ids.length);
  let remainder = totalPaise - base * ids.length;
  const shares = {};
  for (const id of ids) {
    shares[id] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  }
  return shares;
}

/** Custom split: amounts are exact integer paise and must sum to the total. */
export function splitCustom(totalPaise, amountsByMember) {
  assertTotal(totalPaise);
  const ids = sortedIds(Object.keys(amountsByMember));
  let sum = 0;
  const shares = {};
  for (const id of ids) {
    const amt = amountsByMember[id];
    if (!Number.isInteger(amt) || amt < 0) {
      throw new Error('Custom amounts must be non-negative integer paise');
    }
    shares[id] = amt;
    sum += amt;
  }
  if (sum !== totalPaise) {
    throw new Error(`Custom amounts must add up to the total (got ${sum}, expected ${totalPaise})`);
  }
  return shares;
}

/**
 * Percentage split: percentages may have up to 2 decimals and must sum to 100.
 * Shares are computed via largest-remainder so they sum exactly to the total,
 * with ties broken by sorted member id (deterministic).
 */
export function splitPercentage(totalPaise, percentByMember) {
  assertTotal(totalPaise);
  const ids = sortedIds(Object.keys(percentByMember));
  // Work in basis points (1% = 100 bp) to keep percentage math integral.
  let bpSum = 0;
  const bps = {};
  for (const id of ids) {
    const p = percentByMember[id];
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) {
      throw new Error('Percentages must be non-negative numbers');
    }
    const bp = Math.round(p * 100);
    if (Math.abs(p * 100 - bp) > 1e-6) {
      throw new Error('Percentages support at most 2 decimal places');
    }
    bps[id] = bp;
    bpSum += bp;
  }
  if (bpSum !== 10000) throw new Error('Percentages must add up to 100%');
  return largestRemainder(totalPaise, ids, bps, 10000);
}

/** Shares split: weights are positive integers (2 shares vs 1 share, etc.). */
export function splitShares(totalPaise, sharesByMember) {
  assertTotal(totalPaise);
  const ids = sortedIds(Object.keys(sharesByMember));
  let weightSum = 0;
  for (const id of ids) {
    const w = sharesByMember[id];
    if (!Number.isInteger(w) || w <= 0) throw new Error('Shares must be positive integers');
    weightSum += w;
  }
  return largestRemainder(totalPaise, ids, sharesByMember, weightSum);
}

/**
 * Largest-remainder allocation of totalPaise across ids proportionally to
 * weights[id] / weightSum. Deterministic: ids are pre-sorted; ties on
 * remainder resolve in sorted-id order.
 */
function largestRemainder(totalPaise, ids, weights, weightSum) {
  const floors = {};
  const rems = [];
  let allocated = 0;
  for (const id of ids) {
    const exactNum = totalPaise * weights[id]; // integer
    const floor = Math.floor(exactNum / weightSum);
    floors[id] = floor;
    allocated += floor;
    rems.push({ id, rem: exactNum % weightSum });
  }
  let leftover = totalPaise - allocated;
  rems.sort((a, b) => (b.rem - a.rem) || (a.id < b.id ? -1 : 1));
  for (const { id } of rems) {
    if (leftover <= 0) break;
    floors[id] += 1;
    leftover -= 1;
  }
  return floors;
}

/** Dispatch helper used by the expense form and services. */
export function computeShares(method, totalPaise, participants, detail) {
  switch (method) {
    case 'equal':
      return splitEqual(totalPaise, participants);
    case 'custom':
      return splitCustom(totalPaise, detail);
    case 'percentage':
      return splitPercentage(totalPaise, detail);
    case 'shares':
      return splitShares(totalPaise, detail);
    default:
      throw new Error(`Unknown split method: ${method}`);
  }
}
