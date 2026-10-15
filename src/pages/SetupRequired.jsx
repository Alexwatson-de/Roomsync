// Shown when Firebase env vars are missing — never pretend to be connected.
export default function SetupRequired() {
  return (
    <div className="auth-screen">
      <div className="card auth-card" style={{ maxWidth: 560 }}>
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.8rem' }}>
          <span className="brand-dot">R</span> <strong>RoomSync</strong>
        </div>
        <h1>Firebase configuration required</h1>
        <p style={{ color: 'var(--text-soft)' }}>
          RoomSync is not connected to Firebase yet. To run the app:
        </p>
        <ol style={{ color: 'var(--text-soft)', lineHeight: 1.7 }}>
          <li>Create a Firebase project at <strong>console.firebase.google.com</strong>.</li>
          <li>Enable <strong>Email/Password</strong> in Authentication → Sign-in method.</li>
          <li>Create a <strong>Cloud Firestore</strong> database (production mode).</li>
          <li>Enable <strong>Storage</strong> if you want receipt and avatar uploads.</li>
          <li>Register a <strong>Web app</strong> in Project settings and copy its config.</li>
          <li>Copy <code>.env.example</code> to <code>.env.local</code> and fill in the values.</li>
          <li>Deploy the security rules: <code>firebase deploy --only firestore,storage</code>.</li>
          <li>Restart the dev server.</li>
        </ol>
        <p style={{ color: 'var(--text-soft)', fontSize: '0.85rem' }}>
          Full instructions are in the project README.
        </p>
      </div>
    </div>
  );
}
