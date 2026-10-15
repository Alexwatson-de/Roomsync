import { useState } from 'react';
import { Link } from 'react-router-dom';
import { resetPassword } from '../services/auth.js';
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="auth-screen"><div className="card auth-card">
    <div className="brand"><span className="brand-dot">R</span>&nbsp;<strong>RoomSync</strong></div>
    <h1>Reset your password</h1>
    {sent ? <p role="status">If an account exists for this email, Firebase will send a reset link. Check your inbox and spam folder.</p> : <form onSubmit={async (event) => {
      event.preventDefault(); setError(''); setBusy(true);
      try { await resetPassword(email); setSent(true); }
      catch (failure) { setError(`Reset request failed: ${failure.message}`); }
      finally { setBusy(false); }
    }}>
      <p style={{ color: 'var(--text-soft)', marginBottom: '1rem' }}>Enter your Firebase account email to request a reset link.</p>
      <div className="field"><label htmlFor="reset-email">Email</label><input id="reset-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      {error && <p role="alert" className="error-text">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
    </form>}
    <p style={{ marginTop: '1rem' }}><Link to="/login">Back to sign in</Link></p>
  </div></div>;
}
