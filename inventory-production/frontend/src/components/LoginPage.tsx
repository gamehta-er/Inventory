import { ArrowRight, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAppState } from '../state/AppState';

export function LoginPage() {
  const { directory, login } = useAppState();
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = useMemo(() => directory.find((user) => user.id === Number(userId)), [directory, userId]);
  async function submit() {
    if (!selected) { setError('Select your name to continue.'); return; }
    setBusy(true); setError('');
    try { await login(selected.id); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Sign in failed.'); } finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-panel">
      <img className="login-panel__logo" src="/brand/nvidia-logo.png" alt="NVIDIA"/>
      <p className="eyebrow">Inventory Project</p>
      <h1>Welcome back.</h1>
      <p className="login-panel__intro">Choose your team account. Access is assigned by the application and every change is recorded.</p>
      <label className="field" htmlFor="login-user"><span className="field__label">Team member *</span><select id="login-user" value={userId} onChange={(event) => { setUserId(event.target.value); setError(''); }}><option value="">Select your name</option>{directory.map((user) => <option value={user.id} key={user.id}>{user.displayName}</option>)}</select></label>
      {selected && <div className="login-identity"><UserRound/><div><strong>{selected.displayName}</strong><span>{selected.roles.map((role) => role.replaceAll('_', ' ')).join(' / ')}</span></div></div>}
      {error && <p className="form-alert">{error}</p>}
      <button className="button button--primary button--full" onClick={submit} disabled={busy}>{busy ? 'Signing in...' : 'Continue'}<ArrowRight size={17}/></button>
      <small className="login-panel__note">Phase 1 company-network access. SSO is planned for Phase 2.</small>
    </section>
  </main>;
}
