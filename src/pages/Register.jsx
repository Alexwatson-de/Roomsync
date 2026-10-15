import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register } from '../services/auth.js';

const FRIENDLY = {
  'auth/email-already-in-use': 'An account already exists with that email.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/invalid-email': 'That email address is not valid.',
};

export default function Register() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!displayName.trim()) {
      setError('Please enter your name.');
      return;
    }
    setBusy(true);
    try {
      await register({ email, password, displayName: displayName.trim() });
      navigate('/onboarding');
    } catch (err) {
      setError(FRIENDLY[err.code] || `Registration failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <div className="brand">
          <span className="brand-dot">R</span>&nbsp;<strong>RoomSync</strong>
        </div>
        <h1 style={{ textAlign: 'center' }}>Create your account</h1>
        <p style={{ textAlign: 'center', color: 'var(--text-soft)', marginBottom: '1rem' }}>
          Shared expenses, chores and groceries — sorted.
        </p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <span className="hint">Your account is managed by Firebase Authentication. Household access is protected by membership rules.</span>
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="field">
              <label htmlFor="confirm">Confirm</label>
              <input id="confirm" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '0.9rem', fontSize: '0.88rem' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
