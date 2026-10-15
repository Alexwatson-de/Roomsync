import { describe, it, expect } from 'vitest';
import { nextDueDate, billStatus, rotationAssignee, periodKey } from '../recurrence.js';

describe('nextDueDate', () => {
  it('returns null for one-time', () => {
    expect(nextDueDate('one-time', '2026-01-01', '2026-01-01')).toBeNull();
  });
  it('advances daily/weekly', () => {
    expect(nextDueDate('daily', '2026-01-01', '2026-01-01')).toBe('2026-01-02');
    expect(nextDueDate('weekly', '2026-01-01', '2026-01-05')).toBe('2026-01-08');
  });
  it('advances monthly with short-month clamping', () => {
    expect(nextDueDate('monthly', '2026-01-31', '2026-01-31')).toBe('2026-02-28');
    // Anchor day is preserved, not drifting to the clamped day
    expect(nextDueDate('monthly', '2026-01-31', '2026-02-28')).toBe('2026-03-31');
  });
  it('advances yearly across leap days', () => {
    expect(nextDueDate('yearly', '2024-02-29', '2024-03-01')).toBe('2025-02-28');
  });
  it('skips directly past multiple elapsed periods', () => {
    expect(nextDueDate('monthly', '2025-01-10', '2025-06-20')).toBe('2025-07-10');
  });
});

describe('billStatus', () => {
  it('categorises paid/overdue/due/upcoming', () => {
    expect(billStatus({ paidAt: 123, dueDate: '2026-01-01' }, '2026-02-01')).toBe('paid');
    expect(billStatus({ dueDate: '2026-01-01' }, '2026-01-02')).toBe('overdue');
    expect(billStatus({ dueDate: '2026-01-03' }, '2026-01-01')).toBe('due');
    expect(billStatus({ dueDate: '2026-01-20' }, '2026-01-01')).toBe('upcoming');
  });
});

describe('chore rotation', () => {
  it('rotates deterministically through members', () => {
    const rot = ['u1', 'u2', 'u3'];
    expect(rotationAssignee(rot, 0)).toBe('u1');
    expect(rotationAssignee(rot, 1)).toBe('u2');
    expect(rotationAssignee(rot, 2)).toBe('u3');
    expect(rotationAssignee(rot, 3)).toBe('u1');
  });
  it('handles empty rotation', () => {
    expect(rotationAssignee([], 5)).toBeNull();
  });
});

describe('periodKey idempotency', () => {
  it('same occurrence -> same key', () => {
    expect(periodKey('weekly', '2026-01-08')).toBe('2026-01-08');
    expect(periodKey('one-time', '2026-01-08')).toBe('once');
  });
});
