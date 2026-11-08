import React, {useEffect, useState} from 'react';

const base = import.meta.env.VITE_API_BASE_URL || '';
async function request(path, body) {
 const response=await fetch(base+path,{credentials:'include',headers:body?{'Content-Type':'application/json'}:{},method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();
 if(!response.ok) { const error=new Error(data.error || 'Service unavailable'); error.status=response.status; throw error; }
 return data;
}
export default function BankPortalPage() {
 const [user,setUser]=useState(null),[ready,setReady]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [overview,setOverview]=useState(null),[devices,setDevices]=useState([]),[cursor,setCursor]=useState(null),[batches,setBatches]=useState(null);
 const [webhooks,setWebhooks]=useState(null);
 const [form,setForm]=useState({institution_id:'',email:'',password:''});
 async function refresh() {
  const [me,summary,list,delivery]=await Promise.all([request('/portal/v2/me'),request('/portal/v2/overview'),request('/portal/v2/devices'),request('/portal/v2/webhooks')]);
  setUser(me.user);setOverview(summary);setDevices(list.devices);setCursor(list.next_after);setWebhooks(delivery);setError('');
 }
 useEffect(()=>{let active=true;refresh().catch(e=>{if(active && e.status!==401)setError(e.message);}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[]);
 async function login(event) {event.preventDefault();setBusy(true);setError('');try{await request('/portal/v2/auth/login',form);setForm({...form,password:''});await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function logout() {setBusy(true);try{await request('/portal/v2/auth/logout',{});setUser(null);setOverview(null);setDevices([]);setBatches(null);}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function loadMore() {setBusy(true);try{const data=await request('/portal/v2/devices?after='+encodeURIComponent(cursor));setDevices(x=>[...x,...data.devices]);setCursor(data.next_after);}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function inspect(id) {setBusy(true);setError('');try{const data=await request('/portal/v2/devices/'+id+'/batches');setBatches({id,items:data.batches});}catch(e){setError(e.message);}finally{setBusy(false);}}
 if(!ready)return <div className="content">Loading institution workspace…</div>;
 if(!user)return <div className="login-wrap"><form className="card" onSubmit={login}><div className="brand">TRATUM / INSTITUTIONS</div><h1>Bank workspace</h1><p className="card-sub">Sign in to your institution’s network.</p>{error&&<p role="alert" className="error-text">{error}</p>}
  <label>Institution ID<input required value={form.institution_id} onChange={e=>setForm({...form,institution_id:e.target.value})}/></label>
  <label>Email<input required type="email" autoComplete="username" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
  <label>Password<input required type="password" autoComplete="current-password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label>
  <button disabled={busy}>{busy?'Signing in…':'Sign in'}</button><p><a href="/login">Tratum operator login</a></p></form></div>;
 return <div className="main"><header className="topbar"><strong>TRATUM <span className="badge">INSTITUTION WORKSPACE</span></strong><span>{user.name} · {user.email} <button onClick={logout} disabled={busy}>Sign out</button></span></header><main className="content">
  <div className="page-heading"><div><h1>{user.name}</h1><p>{user.type} · Institution {user.institution_id}</p></div><button disabled={busy} onClick={()=>{setBusy(true);refresh().catch(e=>{setError(e.message);if(e.status===401)setUser(null);}).finally(()=>setBusy(false));}}>Refresh</button></div>
  {error&&<p role="alert" className="error-text">{error}</p>}
  <div className="grid">{[['Registered devices',overview?.devices.total],['Active certificates',overview?.devices.active],['Received batches',overview?.batches.total],['Evidence records',overview?.records.total]].map(([title,value])=><section className="card" key={title}><div className="card-title">{title}</div><div className="card-value">{value ?? '—'}</div></section>)}</div>
  <p className="page-heading-note">Device-signed evidence is available here. Upload acceptance does not establish financial settlement.</p>
  <section className="card section-card"><h2>Webhook delivery</h2><p className="card-sub">{webhooks?.endpoint ? `${webhooks.endpoint.enabled?'Enabled':'Disabled'} · ${webhooks.endpoint.url}` : 'No delivery endpoint configured. Contact your Tratum operator.'}</p><div className="table-wrap"><table><thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>HTTP response</th></tr></thead><tbody>{webhooks?.events?.length?webhooks.events.map(e=><tr key={e.event_id}><td><code>{e.event_id}</code></td><td>{e.status}</td><td>{e.attempts}</td><td>{e.last_http_status ?? '—'}</td></tr>):<tr><td colSpan="4" className="empty-state">No delivery events.</td></tr>}</tbody></table></div></section>
  <section className="card section-card"><h2>Device network</h2><div className="table-wrap"><table><thead><tr><th>Device</th><th>Status</th><th>Key epoch</th><th>Next index</th><th>Certificate expiry</th><th>Evidence</th></tr></thead><tbody>{devices.length?devices.map(d=><tr key={d.device_id}><td><code>{d.device_id}</code></td><td>{d.status}</td><td>{d.key_epoch}</td><td>{d.next_index}</td><td>{new Date(d.expires_at).toLocaleString()}</td><td><button disabled={busy} onClick={()=>inspect(d.device_id)}>View batches</button></td></tr>):<tr><td colSpan="6" className="empty-state">No devices enrolled for this institution.</td></tr>}</tbody></table></div>{cursor&&<button disabled={busy} onClick={loadMore}>Load more devices</button>}</section>
  {batches&&<section className="card section-card"><h2>Upload evidence · {batches.id}</h2><div className="table-wrap"><table><thead><tr><th>Batch</th><th>Index range</th><th>Received</th></tr></thead><tbody>{batches.items.length?batches.items.map(b=><tr key={b.batch_id}><td><code>{b.batch_id}</code></td><td>{b.from_index}–{b.next_index} (exclusive)</td><td>{new Date(b.received_at).toLocaleString()}</td></tr>):<tr><td colSpan="3">No uploaded batches.</td></tr>}</tbody></table></div></section>}
 </main></div>;
}
