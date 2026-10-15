// recurrence.js — pure helpers for recurring bills and chores.
//
// Occurrences are identified by a deterministic period key so that generating
// the "next occurrence" is idempotent: the same (definitionId, periodKey) can
// only exist once, which prevents duplicate generated records even when two
// clients race (the occurrence doc id embeds the period key).

export const RECURRENCES = ['one-time', 'daily', 'weekly', 'monthly', 'yearly'];

/** ISO date (YYYY-MM-DD) for a Date in local time. */
export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD into a local Date at midnight. */
export function fromIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Next due date strictly after `afterIso` for a recurrence anchored at
 * `anchorIso`. Returns null for one-time items (they do not repeat).
 * Monthly/yearly clamp to the last day of short months (e.g. 31st -> Feb 28).
 */
export function nextDueDate(recurrence, anchorIso, afterIso) {
  if (recurrence === 'one-time') return null;
  const anchor = fromIso(anchorIso);
  const after = fromIso(afterIso);
  let d = new Date(anchor);
  const step = () => {
    if (recurrence === 'daily') d.setDate(d.getDate() + 1);
    else if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
    else if (recurrence === 'monthly') d = addMonthsClamped(anchor, monthsBetween(anchor, d) + 1);
    else if (recurrence === 'yearly') d = addMonthsClamped(anchor, (yearsBetween(anchor, d) + 1) * 12);
    else throw new Error(`Unknown recurrence: ${recurrence}`);
  };
  let guard = 0;
  while (d <= after) {
    step();
    if (++guard > 5000) throw new Error('nextDueDate: runaway loop');
  }
  return isoDate(d);
}

function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function yearsBetween(a, b) {
  return b.getFullYear() - a.getFullYear();
}

function addMonthsClamped(anchor, months) {
  const y = anchor.getFullYear();
  const m = anchor.getMonth() + months;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(anchor.getDate(), lastDay));
}

/** Deterministic period key for an occurrence of a recurring definition. */
export function periodKey(recurrence, dueIso) {
  if (recurrence === 'one-time') return 'once';
  return dueIso; // due date uniquely identifies the occurrence for all recurrences
}

/** Bill status from its state + today's date. */
export function billStatus(bill, todayIso) {
  if (bill.paidAt) return 'paid';
  if (bill.dueDate < todayIso) return 'overdue';
  const due = fromIso(bill.dueDate);
  const today = fromIso(todayIso);
  const days = Math.round((due - today) / 86400000);
  return days <= 3 ? 'due' : 'upcoming';
}

/**
 * Chore rotation: given an ordered rotation list and the number of occurrences
 * already generated, the assignee for occurrence N is rotation[N % len].
 * Deterministic and independent of who triggers generation.
 */
export function rotationAssignee(rotationMemberIds, occurrenceIndex) {
  if (!rotationMemberIds || rotationMemberIds.length === 0) return null;
  return rotationMemberIds[occurrenceIndex % rotationMemberIds.length];
}
