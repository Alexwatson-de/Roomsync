import { describe, it, expect } from 'vitest';
import { computeNetBalances, suggestSettlements, totalOutstanding, pairwiseFor } from '../balances.js';
import { splitEqual } from '../splits.js';

const sumNet = (net) => Object.values(net).reduce((a, b) => a + b, 0);

describe('net balances from the ledger', () => {
  it('handles the spec example: A pays 1200 split among A,B,C', () => {
    const shares = splitEqual(120000, ['A', 'B', 'C']);
    const net = computeNetBalances([{ payers: { A: 120000 }, shares }]);
    expect(net).toEqual({ A: 80000, B: -40000, C: -40000 });
    expect(sumNet(net)).toBe(0);
    const transfers = suggestSettlements(net);
    expect(transfers).toEqual([
      { from: 'B', to: 'A', amountPaise: 40000 },
      { from: 'C', to: 'A', amountPaise: 40000 },
    ]);
  });

  it('supports multiple payers on one expense', () => {
    // A and B each pay half of a 900 expense shared equally by A, B, C
    const net = computeNetBalances([
      { payers: { A: 45000, B: 45000 }, shares: splitEqual(90000, ['A', 'B', 'C']) },
    ]);
    expect(net).toEqual({ A: 15000, B: 15000, C: -30000 });
    expect(sumNet(net)).toBe(0);
  });

  it('accumulates multiple expenses across several members', () => {
    const net = computeNetBalances([
      { payers: { A: 30000 }, shares: splitEqual(30000, ['A', 'B']) },
      { payers: { B: 10000 }, shares: splitEqual(10000, ['A', 'B', 'C']) },
      { payers: { C: 6000 }, shares: splitEqual(6000, ['B', 'C']) },
    ]);
    expect(sumNet(net)).toBe(0);
    // A: +30000 -15000 -3334 = 11666 ; B: -15000 +10000 -3333 -3000 = -11333
    // C: -3333 +6000 -3000 = -333
    expect(net).toEqual({ A: 11666, B: -11333, C: -333 });
  });

  it('ignores deleted expenses (recalculates balances)', () => {
    const exp = { payers: { A: 10000 }, shares: splitEqual(10000, ['A', 'B']) };
    const before = computeNetBalances([exp]);
    expect(before.B).toBe(-5000);
    const after = computeNetBalances([{ ...exp, deleted: true }]);
    expect(after).toEqual({});
  });

  it('applies partial settlements', () => {
    const expenses = [{ payers: { A: 120000 }, shares: splitEqual(120000, ['A', 'B', 'C']) }];
    const net = computeNetBalances(expenses, [{ from: 'B', to: 'A', amountPaise: 25000 }]);
    expect(net).toEqual({ A: 55000, B: -15000, C: -40000 });
    expect(sumNet(net)).toBe(0);
  });

  it('full settlement zeroes the pair', () => {
    const expenses = [{ payers: { A: 120000 }, shares: splitEqual(120000, ['A', 'B', 'C']) }];
    const net = computeNetBalances(expenses, [
      { from: 'B', to: 'A', amountPaise: 40000 },
      { from: 'C', to: 'A', amountPaise: 40000 },
    ]);
    expect(net).toEqual({ A: 0, B: 0, C: 0 });
  });

  it('ignores reversed settlements', () => {
    const expenses = [{ payers: { A: 10000 }, shares: splitEqual(10000, ['A', 'B']) }];
    const net = computeNetBalances(expenses, [
      { from: 'B', to: 'A', amountPaise: 5000, reversed: true },
    ]);
    expect(net).toEqual({ A: 5000, B: -5000 });
  });

  it('handles multiple settlements including overpayment direction flip', () => {
    const expenses = [{ payers: { A: 10000 }, shares: splitEqual(10000, ['A', 'B']) }];
    const net = computeNetBalances(expenses, [
      { from: 'B', to: 'A', amountPaise: 3000 },
      { from: 'B', to: 'A', amountPaise: 3000 },
    ]);
    // B overpaid by 1000 -> now A owes B
    expect(net).toEqual({ A: -1000, B: 1000 });
    expect(suggestSettlements(net)).toEqual([{ from: 'A', to: 'B', amountPaise: 1000 }]);
  });

  it('rejects invalid settlement amounts', () => {
    expect(() => computeNetBalances([], [{ from: 'a', to: 'b', amountPaise: 0 }])).toThrow();
    expect(() => computeNetBalances([], [{ from: 'a', to: 'b', amountPaise: 10.5 }])).toThrow();
  });
});

describe('settlement suggestions', () => {
  it('nets out complex graphs with minimal transfers', () => {
    const net = { A: 70000, B: -30000, C: -40000, D: 0 };
    const transfers = suggestSettlements(net);
    const applied = {};
    for (const t of transfers) {
      applied[t.from] = (applied[t.from] || 0) + t.amountPaise;
      applied[t.to] = (applied[t.to] || 0) - t.amountPaise;
    }
    expect(applied.A).toBe(-70000);
    expect(applied.B).toBe(30000);
    expect(applied.C).toBe(40000);
    expect(transfers.length).toBe(2);
  });

  it('is deterministic for equal magnitudes', () => {
    const t1 = suggestSettlements({ A: 100, B: 100, C: -100, D: -100 });
    const t2 = suggestSettlements({ B: 100, A: 100, D: -100, C: -100 });
    expect(t1).toEqual(t2);
  });

  it('totalOutstanding sums the creditor side', () => {
    expect(totalOutstanding({ A: 70000, B: -30000, C: -40000 })).toBe(70000);
  });

  it('pairwiseFor reports owes/owedBy for a member', () => {
    const net = { A: 80000, B: -40000, C: -40000 };
    expect(pairwiseFor('B', net).owes).toEqual([{ id: 'A', amountPaise: 40000 }]);
    expect(pairwiseFor('A', net).owedBy).toEqual([
      { id: 'B', amountPaise: 40000 },
      { id: 'C', amountPaise: 40000 },
    ]);
  });
});
