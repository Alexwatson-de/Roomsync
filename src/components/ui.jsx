// ui.jsx — shared primitives: Modal, ConfirmDialog, Avatar, EmptyState,
// Spinner, Badge helpers, MemberSelect.

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatPaise } from '../lib/money.js';
import { resolveAvatar } from '../lib/avatars.js';

export function Modal({ title, onClose, children, footer }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  closeRef.current = onClose;
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter((el) => el.getClientRects().length);
    (focusable()[0] || dialog).focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const controls = focusable();
        const first = controls[0] || dialog;
        const last = controls.at(-1) || dialog;
        if (!controls.length || (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement)))) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          e.preventDefault(); first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);
  // Portal escapes the transformed page-content / glass-panel containing
  // blocks. Fixed overlay must cover the sidebar AND content at any scroll.
  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>, document.body
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel, busy = false }) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : ''}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

export function Avatar({ name, uid, profile, size }) {
  const avatar = resolveAvatar({ ...profile, uid: uid || profile?.uid, name: name || profile?.displayName });
  // Never render legacy photo URLs; no remote images or download/CORS calls.
  return <span role="img" aria-label={`${name || profile?.displayName || 'User'} avatar`}
    className={`avatar avatar-${avatar.avatarStyle} ${size === 'lg' ? 'avatar-lg' : ''}`}
    data-avatar-style={avatar.avatarStyle} data-avatar-color={avatar.avatarColor}
    data-avatar-uid={uid || profile?.uid || undefined}
    style={{ '--avatar-background': avatar.background, background: avatar.background, color: '#fff' }}>{avatar.initials}</span>;
}

export function EmptyState({ icon = '○', title, hint, action }) {
  return (
    <div className="empty-state">
      <div className="big">{icon}</div>
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
      {action && <div style={{ marginTop: '0.8rem' }}>{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="page-loading">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function Amount({ paise, signed = false }) {
  const cls = paise > 0 ? 'amount-pos' : paise < 0 ? 'amount-neg' : '';
  return <span className={signed ? cls : ''} style={{ fontVariantNumeric: 'tabular-nums' }}>{formatPaise(paise, { signed })}</span>;
}

/** Multi-select of household members as checkboxes. */
export function MemberSelect({ members, selected, onChange, label = 'Participants' }) {
  const toggle = (uid) => {
    onChange(selected.includes(uid) ? selected.filter((s) => s !== uid) : [...selected, uid]);
  };
  return (
    <div className="field">
      <label>{label}</label>
      {members.map((m) => (
        <label key={m.uid} className="checkbox-row">
          <input
            type="checkbox"
            checked={selected.includes(m.uid)}
            onChange={() => toggle(m.uid)}
          />
          <Avatar profile={m} />
          <span>{m.displayName}</span>
        </label>
      ))}
    </div>
  );
}
