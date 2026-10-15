// Real-time Firestore subscriptions; cleaned up on household changes.

import { useEffect, useState } from 'react';
import { useHousehold } from '../context/HouseholdContext.jsx';
import { listenExpenses } from '../services/expenses.js';
import { listenSettlements } from '../services/settlements.js';
import { listenBills } from '../services/bills.js';
import { listenChores } from '../services/chores.js';
import { listenItems } from '../services/groceries.js';
import { listenActivity } from '../services/activity.js';

function useLive(listenFn, hid) {
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null);
  useEffect(() => {
    setData(null);
    setError(null);
    if (!hid) return undefined;
    const unsub = listenFn(hid, setData, (e) => { setError(e); setData([]); });
    return unsub;
  }, [hid, listenFn]);
  if (error) throw error;
  return { data, loading: data === null && !error, error };
}

export function useExpenses() {
  const { activeId } = useHousehold();
  return useLive(listenExpenses, activeId);
}

export function useSettlements() {
  const { activeId } = useHousehold();
  return useLive(listenSettlements, activeId);
}

export function useBills() {
  const { activeId } = useHousehold();
  return useLive(listenBills, activeId);
}

export function useChores() {
  const { activeId } = useHousehold();
  return useLive(listenChores, activeId);
}

export function useGroceryItems() {
  const { activeId } = useHousehold();
  return useLive(listenItems, activeId);
}

export function useActivity() {
  const { activeId } = useHousehold();
  return useLive(listenActivity, activeId);
}
