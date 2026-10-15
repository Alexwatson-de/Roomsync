// Onboarding — create a household or join one with an invite code.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createHousehold, joinHousehold } from '../services/households.js';
import { useHousehold } from '../context/HouseholdContext.jsx';
import { logout } from '../services/auth.js';

export default function Onboarding() {
  const [mode, setMode] = useState('create');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { switchHousehold, memberships } = useHousehold();
  const [pendingHousehold, setPendingHousehold] = useState(null);
  // A successful server write can precede its membership listener snapshot.
  // Wait for the snapshot before opening the protected household routes.
  useEffect(() => {
    if (pendingHousehold && memberships?.some((m) => m.householdId === pendingHousehold)) {
      switchHousehold(pendingHousehold);
      navigate('/');
    }
  }, [pendingHousehold, memberships, switchHousehold, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      let hid;
      if (mode === 'create') {
        if (!name.trim()) throw new Error('Household name is required.');
        hid = await createHousehold({ name: name.trim(), description, currency: 'INR' });
      } else {
        hid = await joinHousehold(inviteCode.trim());
      }
      setPendingHousehold(hid);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="card auth-card" style={{ maxWidth: 460 }}>
        <h1 style={{ textAlign: 'center' }}>Set up your household</h1>
        <p style={{ color: 'var(--text-soft)', fontSize: '0.85rem', textAlign: 'center' }}>Create a shared Firebase household or join your housemates with an invitation.</p>
        <div style={{ display: 'flex', justifyContent: 'center', margin: '0.8rem 0 1.2rem' }}>
          <div className="segmented">
            <button type="button" className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
              Create household
            </button>
            <button type="button" className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>
              Join with invite
            </button>
          </div>
        </div>
        <form onSubmit={submit}>
          {mode === 'create' ? (
            <>
              <div className="field">
                <label htmlFor="hname">Household name</label>
                <input id="hname" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Flat 4B, Indiranagar" />
              </div>
              <div className="field">
                <label htmlFor="hdesc">Description (optional)</label>
                <input id="hdesc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who lives here?" />
                <span className="hint">Currency: INR (₹). You can change settings later.</span>
              </div>
            </>
          ) : (
            <div className="field">
              <label htmlFor="code">Invite code</label>
              <input id="code" required value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Paste the code you received" />
              <span className="hint">Ask your household's owner or admin for an unexpired invitation code.</span>
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
          <button className="btn" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Working…' : mode === 'create' ? 'Create household' : 'Join household'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.85rem' }}>
          <Link to="/account">Account settings</Link> ·{' '}
          <button className="btn btn-ghost btn-sm" onClick={async () => { await logout(); navigate('/login'); }}>
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}
