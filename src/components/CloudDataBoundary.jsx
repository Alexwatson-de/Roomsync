import { Component } from 'react';
// A failed Firestore query is not an empty household. Never turn permission,
// configuration or index failures into fake zero balances or empty reports.
export default class CloudDataBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="card" role="alert">
      <h2>Shared data couldn't be loaded</h2>
      <p className="error-text">{this.state.error.message}</p>
      <p style={{ color: 'var(--text-soft)', marginBottom: '1rem' }}>Check Firebase services, membership, rules and indexes. No local-storage fallback or fabricated totals are being displayed.</p>
      <button className="btn btn-secondary" onClick={() => location.reload()}>Retry connection</button>
    </div>;
  }
}
