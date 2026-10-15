// balances.js — ledger-based balance computation.
//
// Sign convention (used everywhere in RoomSync):
//   net[member] > 0  => the household owes this member (they are a creditor).
//   net[member] < 0  => this member owes the household (they are a debtor).
//
// For an expense: payer's net increases by what others owe them
// (total - payer's own share); each other participant's net decreases by
// their share. Equivalently: net[m] += paid[m] - share[m].
//
// For a settlement (payer repays receiver): payer's net increases by the
// amount (debt reduced), receiver's net decreases (credit consumed).
// All inputs are integer paise; the nets always sum to exactly zero.

/**
 * @param {Array<{payers: Object<string,number>, shares: Object<string,number>, deleted?: boolean}>} expenses
 *   `payers` maps memberId -> paise paid (supports multiple payers).
 *   `shares` maps memberId -> paise owed for this expense.
 * @param {Array<{from: string, to: string, amountPaise: number, reversed?: boolean}>} settlements
 *   `from` repaid `to` by amountPaise.
 * @returns {Object<string, number>} net balance per member in paise.
 */
export function computeNetBalances(expenses, settlements = []) {
  const net = {};
  const add = (id, v) => {
    net[id] = (net[id] || 0) + v;
  };
  for (const exp of expenses) {
    if (exp.deleted) continue;
    for (const [id, paid] of Object.entries(exp.payers)) {
      if (!Number.isInteger(paid) || paid < 0) throw new Error('Invalid payer amount');
      add(id, paid);
    }
    for (const [id, share] of Object.entries(exp.shares)) {
      if (!Number.isInteger(share) || share < 0) throw new Error('Invalid share amount');
      add(id, -share);
    }
  }
  for (const s of settlements) {
    if (s.reversed) continue;
    if (!Number.isInteger(s.amountPaise) || s.amountPaise <= 0) {
      throw new Error('Invalid settlement amount');
    }
    add(s.from, s.amountPaise);
    add(s.to, -s.amountPaise);
  }
  return net;
}

/** Sum of positive balances == total outstanding owed within the household. */
export function totalOutstanding(net) {
  return Object.values(net).reduce((acc, v) => acc + (v > 0 ? v : 0), 0);
}

/**
 * Suggested settlements: greedy debtor->creditor matching that minimises
 * transfer count in practice. Deterministic: sorted by magnitude, then id.
 * Returns [{from, to, amountPaise}].
 */
export function suggestSettlements(net) {
  const debtors = [];
  const creditors = [];
  for (const [id, v] of Object.entries(net)) {
    if (v < 0) debtors.push({ id, amt: -v });
    else if (v > 0) creditors.push({ id, amt: v });
  }
  const byAmtThenId = (a, b) => (b.amt - a.amt) || (a.id < b.id ? -1 : 1);
  debtors.sort(byAmtThenId);
  creditors.sort(byAmtThenId);
  const transfers = [];
  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const pay = Math.min(debtors[di].amt, creditors[ci].amt);
    if (pay > 0) {
      transfers.push({ from: debtors[di].id, to: creditors[ci].id, amountPaise: pay });
    }
    debtors[di].amt -= pay;
    creditors[ci].amt -= pay;
    if (debtors[di].amt === 0) di += 1;
    if (creditors[ci].amt === 0) ci += 1;
  }
  return transfers;
}

/**
 * Pairwise view for "you owe X / X owes you" rows relative to one member,
 * derived from the suggested-settlement simplification of the net ledger.
 * Returns { owes: [{id, amountPaise}], owedBy: [{id, amountPaise}] }.
 */
export function pairwiseFor(memberId, net) {
  const transfers = suggestSettlements(net);
  const owes = [];
  const owedBy = [];
  for (const t of transfers) {
    if (t.from === memberId) owes.push({ id: t.to, amountPaise: t.amountPaise });
    if (t.to === memberId) owedBy.push({ id: t.from, amountPaise: t.amountPaise });
  }
  return { owes, owedBy };
}
