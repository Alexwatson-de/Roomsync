// ui.jsx — shared primitives: Modal, ConfirmDialog, Avatar, EmptyState,
// Spinner, Badge helpers, MemberSelect.

import { useEffect } from 'react';
import { formatPaise } from '../lib/money.js';

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
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

export function Avatar({ name, photoURL, size }) {
  const initials = (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const cls = `avatar ${size === 'lg' ? 'avatar-lg' : ''}`;
  if (photoURL) return <img className={cls} src={photoURL} alt={name} />;
  return <span className={cls}>{initials}</span>;
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
          <Avatar name={m.displayName} photoURL={m.photoURL} />
          <span>{m.displayName}</span>
        </label>
      ))}
    </div>
  );
}
