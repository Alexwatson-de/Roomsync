// Settings — profile, household settings, danger zone (delete household /
// delete account).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useHousehold } from '../context/HouseholdContext.jsx';
import { updateUserProfile, deleteAccount, changePassword } from '../services/auth.js';
import { updateHousehold, deleteHousehold } from '../services/households.js';
import { Avatar, ConfirmDialog, Modal } from '../components/ui.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { ThemeToggle } from '../context/ThemeContext.jsx';
import { uploadsEnabled } from '../firebase.js';

export default function Settings() {
  const { user } = useAuth();
  const { activeId, household, myRole, memberships } = useHousehold();
  const toast = useToast();
  const navigate = useNavigate();

  // profile
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [photoFile, setPhotoFile] = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // household
  const [hName, setHName] = useState(household?.name || '');
  const [hDesc, setHDesc] = useState(household?.description || '');
  const [savingHousehold, setSavingHousehold] = useState(false);

  const [confirmDeleteHousehold, setConfirmDeleteHousehold] = useState(false);
  const [deleteAccountModal, setDeleteAccountModal] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHName(household?.name || '');
    setHDesc(household?.description || '');
  }, [activeId, household?.name, household?.description]);

  const isOwner = myRole === 'owner';
  const isAdmin = ['owner', 'admin'].includes(myRole);

  const saveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateUserProfile({ displayName: displayName.trim(), photoFile });
      toast('Profile updated');
    } catch (err) {
      toast.error(`Could not update profile: ${err.message}`);
    } finally {
      setSavingProfile(false);
    }
  };

  const saveHousehold = async (e) => {
    e.preventDefault();
    setSavingHousehold(true);
    try {
      await updateHousehold(activeId, { name: hName.trim(), description: hDesc.trim() });
      toast('Household updated');
    } catch (err) {
      toast.error(`Could not update household: ${err.message}`);
    } finally {
      setSavingHousehold(false);
    }
  };

  return (
    <>
      <div className="section-head">
        <h1>Settings</h1>
      </div>

      <div className="card">
        <div className="card-title"><h3>Your profile</h3></div>
        <form onSubmit={saveProfile}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '0.8rem' }}>
            <Avatar name={user?.displayName || user?.email} photoURL={user?.photoURL} size="lg" />
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Profile picture</label>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!uploadsEnabled} onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />
              {!uploadsEnabled && <span className="hint">Photo uploads need Firebase Storage setup. Your display name can still be updated.</span>}
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>Display name</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Email</label>
              <input value={user?.email || ''} disabled />
            </div>
          </div>
          <button className="btn" disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save profile'}</button>
        </form>
      </div>

      {household && <div className="card">
        <div className="card-title"><h3>Household: {household?.name}</h3></div>
        {isAdmin ? (
          <form onSubmit={saveHousehold}>
            <div className="form-row">
              <div className="field">
                <label>Name</label>
                <input value={hName} onChange={(e) => setHName(e.target.value)} required />
              </div>
              <div className="field">
                <label>Currency</label>
                <input value={household?.currency || 'INR'} disabled />
              </div>
            </div>
            <div className="field">
              <label>Description</label>
              <input value={hDesc} onChange={(e) => setHDesc(e.target.value)} />
            </div>
            <button className="btn" disabled={savingHousehold}>{savingHousehold ? 'Saving…' : 'Save household'}</button>
          </form>
        ) : (
          <p style={{ color: 'var(--text-soft)' }}>Only owners and admins can edit household settings.</p>
        )}
      </div>}

      <PasswordSettings />
      <div className="card"><div className="card-title"><h3>Appearance</h3><ThemeToggle /></div><p style={{ color: 'var(--text-soft)' }}>Frosted surfaces, tactile controls and a theme that stays with this browser. Motion follows your device's accessibility preference.</p></div>

      <div className="card" style={{ borderColor: 'var(--red-100)' }}>
        <div className="card-title"><h3 style={{ color: 'var(--red-600)' }}>Danger zone</h3></div>
        {isOwner && (
          <div className="list-row">
            <div className="grow">
              <div className="title">Delete this household</div>
              <div className="sub">Permanent cloud deletion needs a trusted recursive cleanup service; it is not configured yet.</div>
            </div>
            <button className="btn btn-danger btn-sm" disabled title="Trusted cloud deletion is not configured">Delete household</button>
          </div>
        )}
        <div className="list-row">
          <div className="grow">
            <div className="title">Delete your account</div>
            <div className="sub">
              {memberships?.length
                ? 'Leave or delete your households first so balances are not orphaned.'
                : 'Permanently deletes your sign-in and profile.'}
            </div>
          </div>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => setDeleteAccountModal(true)}
            disabled={!!memberships?.length}
            title={memberships?.length ? 'Leave all households first' : undefined}
          >
            Delete account
          </button>
        </div>
      </div>

      {confirmDeleteHousehold && (
        <ConfirmDialog
          title={`Delete "${household?.name}"?`}
          message="This permanently deletes the household and ALL its data: expenses, settlements, bills, chores, shopping lists, activity and notifications. This cannot be undone."
          confirmLabel="Delete everything"
          danger
          busy={busy}
          onCancel={() => setConfirmDeleteHousehold(false)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await deleteHousehold(activeId);
              toast('Household deleted');
              navigate('/onboarding');
            } catch (err) {
              toast.error(`Could not delete household: ${err.message}`);
              setBusy(false);
            }
          }}
        />
      )}

      {deleteAccountModal && (
        <DeleteAccountModal
          onClose={() => setDeleteAccountModal(false)}
          onDeleted={() => navigate('/login')}
        />
      )}
    </>
  );
}

function PasswordSettings() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return <div className="card">
    <h3>Change password</h3>
    <p style={{ color: 'var(--text-soft)', fontSize: '0.85rem' }}>Reauthenticate with your current Firebase password before saving a new one.</p>
    <form onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      try {
        await changePassword(current, next);
        setCurrent(''); setNext(''); toast('Password changed');
      } catch (error) { toast.error(error.message); }
      finally { setBusy(false); }
    }}>
      <div className="form-row">
        <div className="field"><label>Current password</label><input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></div>
        <div className="field"><label>New password</label><input type="password" required minLength={6} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></div>
      </div>
      <button className="btn btn-secondary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
    </form>
  </div>;
}

function DeleteAccountModal({ onClose, onDeleted }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await deleteAccount(password);
      toast('Account deleted');
      onDeleted();
    } catch (err) {
      setError(
        err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password'
          ? 'Incorrect password.'
          : `Could not delete account: ${err.message}`
      );
      setBusy(false);
    }
  };

  return (
    <Modal title="Delete your account" onClose={onClose}>
      <p style={{ color: 'var(--text-soft)', fontSize: '0.9rem' }}>
        This permanently deletes your sign-in and profile. Enter your password to confirm.
      </p>
      <form onSubmit={submit}>
        <div className="field">
          <label>Password</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-danger" disabled={busy}>{busy ? 'Deleting…' : 'Permanently delete'}</button>
        </div>
      </form>
    </Modal>
  );
}
