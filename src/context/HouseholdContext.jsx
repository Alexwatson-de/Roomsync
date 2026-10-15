// HouseholdContext — tracks the user's memberships, the active household,
// its member list, and live notifications. All listeners are cleaned up on
// unmount / household switch.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { listenMyMemberships, listenHousehold, listenMembers } from '../services/households.js';
import { listenNotifications } from '../services/activity.js';

const HouseholdContext = createContext(null);
const LS_KEY = 'roomsync.activeHousehold';

export function HouseholdProvider({ children }) {
  const { user } = useAuth();
  const [memberships, setMemberships] = useState(null); // null = loading
  const [activeId, setActiveId] = useState(() => localStorage.getItem(LS_KEY) || null);
  const [household, setHousehold] = useState(null);
  const [members, setMembers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState(null);

  // My memberships (live)
  useEffect(() => {
    setMemberships(null);
    setError(null);
    if (!user) {
      return undefined;
    }
    const unsub = listenMyMemberships(
      user.uid,
      (ms) => {
        setMemberships(ms);
        setError(null);
      },
      (e) => setError(e)
    );
    return unsub;
  }, [user?.uid]);

  // Resolve/repair the active household id
  useEffect(() => {
    if (!memberships) return;
    const ids = memberships.map((m) => m.householdId);
    if (ids.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !ids.includes(activeId)) {
      setActiveId(ids[0]);
    }
  }, [memberships, activeId]);

  useEffect(() => {
    if (activeId) localStorage.setItem(LS_KEY, activeId);
    else localStorage.removeItem(LS_KEY);
  }, [activeId]);

  // Active household doc + members (live)
  useEffect(() => {
    if (!activeId || !user || !memberships?.some((m) => m.householdId === activeId)) {
      setHousehold(null);
      setMembers([]);
      return undefined;
    }
    const unsub1 = listenHousehold(activeId, setHousehold, (e) => setError(e));
    const unsub2 = listenMembers(activeId, setMembers, (e) => setError(e));
    return () => {
      unsub1();
      unsub2();
    };
  }, [activeId, user?.uid, memberships]);

  // Notifications for me in the active household (live)
  useEffect(() => {
    if (!activeId || !user || !memberships?.some((m) => m.householdId === activeId)) {
      setNotifications([]);
      return undefined;
    }
    const unsub = listenNotifications(activeId, user.uid, setNotifications, (e) => setError(e));
    return unsub;
  }, [activeId, user?.uid, memberships]);

  const value = useMemo(() => {
    const myMembership = memberships?.find((m) => m.householdId === activeId) || null;
    return {
      memberships,
      activeId,
      switchHousehold: setActiveId,
      household,
      members,
      myRole: myMembership?.role || null,
      notifications,
      unreadCount: notifications.filter((n) => !n.read).length,
      memberName: (uid) => members.find((m) => m.uid === uid)?.displayName || 'Former member',
      error,
    };
  }, [memberships, activeId, household, members, notifications, error]);

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold() {
  return useContext(HouseholdContext);
}
