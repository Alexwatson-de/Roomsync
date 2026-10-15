// Members — roles, invitations, removal. Role enforcement mirrors the
// security rules (hiding buttons is UX; rules are the real gate).
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useHousehold } from '../context/HouseholdContext.jsx';
import { createInvite, listInvites, revokeInvite, setMemberRole, removeMember } from '../services/households.js';
import { Avatar, Modal, ConfirmDialog, EmptyState } from '../components/ui.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function Members() {
  const { user } = useAuth();
  const { activeId, household, members, myRole } = useHousehold();
  const toast = useToast();
  const [inviteModal, setInviteModal] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = ['owner', 'admin'].includes(myRole);
  const isOwner = myRole === 'owner';

  return (
    <>
      <div className="section-head">
        <h1>Members</h1>
        {isAdmin && <button className="btn" onClick={() => setInviteModal(true)}>Invite member</button>}
      </div>

      <div className="card">
        {members.map((m) => (
          <div className="list-row" key={m.uid}>
            <span className="member-chip grow">
              <Avatar name={m.displayName} photoURL={m.photoURL} />
              <span>
                <div className="title">
                  {m.displayName} {m.uid === user.uid && <span className="badge badge-grey">you</span>}
                </div>
                <div className="sub">joined {m.joinedAt?.toDate ? m.joinedAt.toDate().toLocaleDateString() : '—'}</div>
              </span>
            </span>

            {isAdmin && m.uid !== user.uid && m.role !== 'owner' ? (
              <select
                value={m.role}
                onChange={async (e) => {
                  try {
                    await setMemberRole(activeId, m.uid, e.target.value);
                    toast(`${m.displayName} is now ${e.target.value}`);
                  } catch (err) {
                    toast.error(`Could not change role: ${err.message}`);
                  }
                }}
                style={{ padding: '0.25rem 0.4rem', borderRadius: 6, border: '1px solid var(--border-strong)' }}
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            ) : (
              <span className={`badge ${m.role === 'owner' ? '' : 'badge-grey'}`}>{m.role}</span>
            )}

            {((isAdmin && m.role !== 'owner' && m.uid !== user.uid) || (m.uid === user.uid && m.role !== 'owner')) && (
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red-600)' }} onClick={() => setRemoving(m)}>
                {m.uid === user.uid ? 'Leave' : 'Remove'}
              </button>
            )}
          </div>
        ))}
      </div>

      {isOwner && (
        <p className="hint" style={{ fontSize: '0.8rem', color: 'var(--text-faint)', marginTop: '0.6rem' }}>
          As owner you cannot leave and orphan this household. Ownership transfer and permanent recursive cloud deletion need a trusted administrative workflow; they are not configured yet. Your records are retained.
        </p>
      )}

      {inviteModal && <InviteModal hid={activeId} householdName={household?.name} onClose={() => setInviteModal(false)} />}

      {removing && (
        <ConfirmDialog
          title={removing.uid === user.uid ? 'Leave household?' : `Remove ${removing.displayName}?`}
          message={
            removing.uid === user.uid
              ? 'You will lose access to this household. Expenses you participated in remain in the ledger so balances stay correct.'
              : `${removing.displayName} will lose access. Their expense history remains in the ledger so balances stay correct.`
          }
          confirmLabel={removing.uid === user.uid ? 'Leave' : 'Remove'}
          danger
          busy={busy}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await removeMember(activeId, removing.uid, removing.displayName, removing.uid === user.uid);
              toast(removing.uid === user.uid ? 'You left the household' : 'Member removed');
              setRemoving(null);
            } catch (err) {
              toast.error(err.message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}

function InviteModal({ hid, householdName, onClose }) {
  const [role, setRole] = useState('member');
  const [token, setToken] = useState(null);
  const [invites, setInvites] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = async () => {
    try {
      setInvites(await listInvites(hid));
    } catch {
      setInvites([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async () => {
    setBusy(true);
    try {
      const t = await createInvite(hid, householdName || '', role);
      setToken(t);
      await load();
    } catch (err) {
      toast.error(`Could not create invite: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Invite to household" onClose={onClose}>
      <div className="form-row" style={{ alignItems: 'flex-end' }}>
        <div className="field">
          <label>Invite as</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="field">
          <button type="button" className="btn" onClick={generate} disabled={busy}>
            {busy ? 'Creating…' : 'Generate invite code'}
          </button>
        </div>
      </div>

      {token && (
        <div className="card" style={{ background: 'var(--green-50)', boxShadow: 'none' }}>
          <strong style={{ fontSize: '0.85rem' }}>Share this code (valid 7 days):</strong>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.4rem' }}>
            <code style={{ fontSize: '0.95rem', wordBreak: 'break-all' }}>{token}</code>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => {
                navigator.clipboard.writeText(token);
                toast('Invite code copied');
              }}
            >
              Copy
            </button>
          </div>
          <p className="hint" style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: '0.4rem' }}>
            The recipient signs in on their device, chooses “Join with invite”, and pastes this code. Anyone with the code can use it until expiry or revocation; share it privately.
          </p>
        </div>
      )}

      <h3 style={{ marginTop: '1rem' }}>Active invites</h3>
      {!invites || invites.filter((i) => i.active && i.expiresAt > Date.now()).length === 0 ? (
        <EmptyState title="No active invites" />
      ) : (
        invites
          .filter((i) => i.active && i.expiresAt > Date.now())
          .map((i) => (
            <div className="list-row" key={i.token}>
              <div className="grow">
                <code style={{ fontSize: '0.8rem' }}>{i.token.slice(0, 10)}…</code>
                <div className="sub">
                  as {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--red-600)' }}
                onClick={async () => {
                  await revokeInvite(i.token);
                  await load();
                  toast('Invite revoked');
                }}
              >
                Revoke
              </button>
            </div>
          ))
      )}
    </Modal>
  );
}
