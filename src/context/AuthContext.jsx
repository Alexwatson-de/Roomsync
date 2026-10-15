import { createContext, useContext, useEffect, useState } from 'react';
import { listenAuth, listenUserProfile } from '../services/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState(null);

  useEffect(() => {
    const unsub = listenAuth((u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    setProfile(null);
    setProfileError(null);
    setProfileLoading(Boolean(user));
    if (!user) return undefined;
    return listenUserProfile(user.uid, (value) => { setProfile(value); setProfileLoading(false); }, (error) => { setProfileError(error); setProfileLoading(false); });
  }, [user?.uid]);

  return <AuthContext.Provider value={{ user, loading, profile, profileLoading, profileError }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
