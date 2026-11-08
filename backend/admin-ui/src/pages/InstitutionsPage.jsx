import api from '../lib/api';
import React from 'react';
import Card from '../components/Card';
import Loader from '../components/Loader';
import ErrorBox from '../components/ErrorBox';
import useFetch from '../hooks/useFetch';

export default function InstitutionsPage() {
  const [key,setKey]=React.useState('');
  const [issue,setIssue]=React.useState('');
  const [busy,setBusy]=React.useState(false);
  const [notice,setNotice]=React.useState('');
  async function createUser(event) {
    event.preventDefault();setBusy(true);setIssue('');setNotice('');
    const form=event.currentTarget, fields=new FormData(form);
    try {
      const result=await api.post('/admin/v2/institutions/'+encodeURIComponent(fields.get('institution_id'))+'/users',{email:fields.get('email'),password:fields.get('password')});
      setNotice('Bank user '+result.data.user.email+' created. Sign in at /bank with institution ID '+result.data.user.institution_id+'.');form.reset();
    } catch(error) {setIssue(error.response?.data?.error || 'User creation unavailable');} finally {setBusy(false);}
  }
  async function onboard(event) {
    event.preventDefault(); setBusy(true); setIssue(''); setKey('');
    const form=event.currentTarget;
    try {
      const fields=new FormData(form);
      const result=await api.post('/admin/institutions',{name:fields.get('name'),type:fields.get('type')});
      setKey(result.data.api_key_raw); form.reset();
    } catch(error) { setIssue(error.response?.data?.error || 'Onboarding unavailable'); }
    finally { setBusy(false); }
  }
  const { data, loading, error } = useFetch('/admin/v1/dashboard/institutions');
  if (loading && !data) return <Loader />;
  if (error) return <ErrorBox text={error} />;

  const summary = data?.summary || {};
  const institutions = Array.isArray(data?.institutions) ? data.institutions : [];

  return (
    <div>
      <div className="page-heading"><div><h1>Institutions</h1><p>Registered network partners</p></div></div>
      <section className="card"><h2>Bank workspace access</h2><p>Create an institution user. Deliver the initial password through your approved secret exchange process.</p><form className="intake-form" onSubmit={createUser}><label>Institution ID<input name="institution_id" required /></label><label>Email<input name="email" type="email" required autoComplete="off" /></label><label>Initial password<input name="password" type="password" minLength="14" maxLength="72" required autoComplete="new-password" /></label><button disabled={busy}>Create bank user</button></form>{notice&&<p role="status">{notice}</p>}</section>
      <section className="card section-card"><h2>Onboard an institution</h2><p>Requires INSTITUTIONS_MANAGE permission. Store the issued key securely; it is shown once.</p><form onSubmit={onboard}><label>Institution name <input name="name" required maxLength="200" /></label><label>Institution type <select name="type"><option value="BANK">Bank</option><option value="CENTRAL_BANK">Central bank</option><option value="FINTECH">Fintech</option></select></label><button disabled={busy}>{busy ? 'Creating…':'Create institution and API key'}</button></form>{issue && <ErrorBox text={issue}/>} {key && <div role="status"><p>New API key</p><code style={{overflowWrap:'anywhere'}}>{key}</code><button onClick={()=>setKey('')}>Dismiss key</button></div>}</section>
      <div className="grid">
        <Card title="Total" value={summary.total ?? 0} subtitle="partners" />
        <Card title="Active" value={summary.active ?? 0} subtitle="enabled" />
        <Card title="Disabled" value={summary.disabled ?? 0} subtitle="not enabled" />
      </div>
      <div className="card section-card">
        <div className="card-title">Institution directory</div>
        <div className="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Status</th><th>Added</th></tr></thead>
          <tbody>{institutions.length ? institutions.map((institution) => <tr key={institution.id}>
            <td>{institution.id}</td><td>{institution.name}</td><td>{institution.type}</td>
            <td><span className={`status ${String(institution.status).toLowerCase() === 'active' ? 'status-good' : 'status-pending'}`}>{institution.status}</span></td>
            <td>{institution.created_at ? new Date(institution.created_at).toLocaleDateString() : '-'}</td>
          </tr>) : <tr><td colSpan="5" className="empty-state">No institutions found.</td></tr>}</tbody>
        </table></div>
      </div>
    </div>
  );
}

