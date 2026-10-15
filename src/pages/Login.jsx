import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login } from '../services/auth.js';

const FRIENDLY = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
  'auth/invalid-email': 'That email address is not valid.',
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login({ email, password });
      navigate('/');
    } catch (err) {
      setError(FRIENDLY[err.code] || `Sign-in failed: ${err.message}`);
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
        <h1 style={{ textAlign: 'center' }}>Welcome back</h1>
        <p style={{ textAlign: 'center', color: 'var(--text-soft)', marginBottom: '1rem' }}>
          Sign in to manage your household
        </p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <span className="hint">Sign in with Firebase. Previous browser-local accounts are separate and are not automatically uploaded.</span>
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '0.9rem', fontSize: '0.88rem' }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
        <p style={{ textAlign: 'center', fontSize: '0.88rem' }}>
          New to RoomSync? <Link to="/register">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
