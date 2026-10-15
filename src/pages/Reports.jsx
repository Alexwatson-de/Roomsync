// Reports — charts, summaries, date range + category filters, CSV export.
import { useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useHousehold } from '../context/HouseholdContext.jsx';
import { useExpenses, useSettlements, useBills, useChores } from '../hooks/useHouseholdData.js';
import { computeNetBalances, suggestSettlements } from '../lib/balances.js';
import { formatPaise } from '../lib/money.js';
import { EXPENSE_CATEGORIES } from '../lib/constants.js';
import { isoDate } from '../lib/recurrence.js';
import { Spinner, EmptyState } from '../components/ui.jsx';

const PIE_COLORS = ['#27a35b', '#2563ab', '#b07714', '#c2402f', '#6b4ba3', '#1f8a8a', '#8a6d1f', '#555f55', '#a34b7c', '#4b7ca3'];

function defaultFrom() {
  const d = new Date();
  d.setMonth(d.getMonth() - 5);
  d.setDate(1);
  return isoDate(d);
}

export default function Reports() {
  const { members, memberName } = useHousehold();
  const { data: expenses, loading: le } = useExpenses();
  const { data: settlements, loading: ls } = useSettlements();
  const { data: bills } = useBills();
  const { data: chores } = useChores();

  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(isoDate(new Date()));
  const [category, setCategory] = useState('');

  const report = useMemo(() => {
    if (!expenses) return null;
    const inRange = expenses.filter(
      (e) => e.date >= from && e.date <= to && (!category || e.category === category)
    );
    const total = inRange.reduce((a, e) => a + e.totalPaise, 0);

    // monthly totals
    const byMonth = {};
    for (const e of inRange) {
      const k = e.date.slice(0, 7);
      byMonth[k] = (byMonth[k] || 0) + e.totalPaise;
    }
    const monthly = Object.entries(byMonth)
      .sort()
      .map(([month, paise]) => ({ month, rupees: Math.round(paise / 100) }));

    // by category
    const byCat = {};
    for (const e of inRange) byCat[e.category] = (byCat[e.category] || 0) + e.totalPaise;
    const categories = Object.entries(byCat)
      .sort((a, b) => b[1] - a[1])
      .map(([name, paise]) => ({ name, rupees: Math.round(paise / 100), paise }));

    // by payer
    const byPayer = {};
    for (const e of inRange) {
      for (const [uid, paid] of Object.entries(e.payers)) byPayer[uid] = (byPayer[uid] || 0) + paid;
    }
    const payers = Object.entries(byPayer)
      .sort((a, b) => b[1] - a[1])
      .map(([uid, paise]) => ({ name: memberName(uid), rupees: Math.round(paise / 100), paise }));

    // contribution = paid vs share consumed, in range
    const contribution = members.map((m) => {
      const paid = inRange.reduce((a, e) => a + (e.payers[m.uid] || 0), 0);
      const share = inRange.reduce((a, e) => a + (e.shares[m.uid] || 0), 0);
      return { name: m.displayName, paid, share, net: paid - share };
    });

    // bills monthly totals (paid, in range)
    const billMonthly = {};
    for (const b of bills || []) {
      if (!b.paidAt) continue;
      if (b.dueDate < from || b.dueDate > to) continue;
      const k = b.dueDate.slice(0, 7);
      billMonthly[k] = (billMonthly[k] || 0) + (b.paidPaise ?? b.expectedPaise);
    }
    const billTotals = Object.entries(billMonthly).sort().map(([month, paise]) => ({ month, rupees: Math.round(paise / 100) }));

    return { inRange, total, monthly, categories, payers, contribution, billTotals };
  }, [expenses, bills, from, to, category, members, memberName]);

  const pendingSettlements = useMemo(() => {
    if (!expenses || !settlements) return [];
    const net = computeNetBalances(
      expenses.map((e) => ({ payers: e.payers, shares: e.shares, deleted: e.deleted })),
      settlements.map((s) => ({ from: s.from, to: s.to, amountPaise: s.amountPaise, reversed: s.reversed }))
    );
    return suggestSettlements(net);
  }, [expenses, settlements]);

  if (le || ls || !report) return <Spinner label="Building reports…" />;

  const choreStats = {
    done: (chores || []).filter((c) => c.completedAt).length,
    pending: (chores || []).filter((c) => !c.completedAt).length,
  };

  const exportCsv = () => {
    const rows = [
      ['Date', 'Title', 'Category', 'Amount (INR)', 'Paid by', 'Split method', 'Participants', 'Description'],
      ...report.inRange.map((e) => [
        e.date,
        e.title,
        e.category,
        (e.totalPaise / 100).toFixed(2),
        Object.keys(e.payers).map(memberName).join('; '),
        e.splitMethod,
        e.participants.map(memberName).join('; '),
        e.description || '',
      ]),
    ];
    const csv = rows
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roomsync-expenses-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="section-head">
        <h1>Reports</h1>
        <button className="btn btn-secondary" onClick={exportCsv} disabled={report.inRange.length === 0}>
          Export CSV
        </button>
      </div>

      <div className="filters-bar card" style={{ padding: '0.8rem' }}>
        <div className="field">
          <label>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field">
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card stat">
          <span className="label">Total spending (range)</span>
          <span className="value">{formatPaise(report.total)}</span>
          <span className="sub">{report.inRange.length} expenses</span>
        </div>
        <div className="card stat">
          <span className="label">Pending settlements</span>
          <span className="value">{pendingSettlements.length}</span>
          <span className="sub">suggested transfers to settle up</span>
        </div>
        <div className="card stat">
          <span className="label">Chores</span>
          <span className="value">{choreStats.done} done</span>
          <span className="sub">{choreStats.pending} pending</span>
        </div>
      </div>

      {report.inRange.length === 0 ? (
        <div className="card" style={{ marginTop: '1rem' }}>
          <EmptyState icon="◔" title="No expenses in this range" hint="Adjust the date range or category filter." />
        </div>
      ) : (
        <div className="grid grid-2" style={{ marginTop: '1rem' }}>
          <div className="card">
            <div className="card-title"><h3>Spending trend</h3></div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={report.monthly}>
                <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={52} />
                <Tooltip formatter={(v) => [`₹${new Intl.NumberFormat('en-IN').format(v)}`, 'Spent']} />
                <Line type="monotone" dataKey="rupees" stroke="#1f8a4c" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <div className="card-title"><h3>Spending by category</h3></div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={report.categories} dataKey="rupees" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                  {report.categories.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => `₹${new Intl.NumberFormat('en-IN').format(v)}`} />
                <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <div className="card-title"><h3>Spending by payer</h3></div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={report.payers} layout="vertical">
                <XAxis type="number" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} fontSize={12} width={90} />
                <Tooltip formatter={(v) => [`₹${new Intl.NumberFormat('en-IN').format(v)}`, 'Paid']} />
                <Bar dataKey="rupees" fill="#27a35b" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <div className="card-title"><h3>Contribution summary</h3></div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Member</th><th className="num">Paid</th><th className="num">Share</th><th className="num">Net</th></tr>
                </thead>
                <tbody>
                  {report.contribution.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td className="num">{formatPaise(c.paid)}</td>
                      <td className="num">{formatPaise(c.share)}</td>
                      <td className={`num ${c.net > 0 ? 'amount-pos' : c.net < 0 ? 'amount-neg' : ''}`}>
                        {formatPaise(c.net, { signed: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {report.billTotals.length > 0 && (
            <div className="card">
              <div className="card-title"><h3>Monthly bill totals (paid)</h3></div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={report.billTotals}>
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} width={52} />
                  <Tooltip formatter={(v) => [`₹${new Intl.NumberFormat('en-IN').format(v)}`, 'Bills paid']} />
                  <Bar dataKey="rupees" fill="#2563ab" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </>
  );
}
