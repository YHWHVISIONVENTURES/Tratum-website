import React,{useEffect,useState} from 'react';
import CommandCenterPage from './CommandCenterPage';
const base=import.meta.env.VITE_API_BASE_URL || '';
export default function BankPortalPage(){
 const [user,setUser]=useState(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [form,setForm]=useState({institution_id:'',email:'',password:''});
 async function request(path,body){
  const r=await fetch(base+path,{credentials:'include',method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json();if(!r.ok){const e=new Error(data.error || 'Service unavailable');e.status=r.status;throw e;}return data;
 }
 useEffect(()=>{let active=true;request('/portal/v2/me').then(d=>{if(active)setUser(d.user);}).catch(e=>{if(active&&e.status!==401)setError(e.message);}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[]);
 async function login(e){e.preventDefault();setBusy(true);setError('');try{await request('/portal/v2/auth/login',form);const me=await request('/portal/v2/me');setUser(me.user);setForm({...form,password:''});}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function logout(){setBusy(true);try{await request('/portal/v2/auth/logout',{});setUser(null);}catch(e){setError(e.message);}finally{setBusy(false);}}
 if(!ready)return <div className="login-wrap">Loading institutional command…</div>;
 if(user)return <CommandCenterPage audience="institution" onLogout={logout} onUnauthenticated={()=>setUser(null)}/>;
 return <div className="login-wrap cc-login"><form className="card" onSubmit={login}><div className="brand">≋ TRATUM</div><span className="cc-kicker">INSTITUTIONAL COMMAND</span><h1>Infrastructure,<br/>under your command.</h1><p className="card-sub">Bank, supervisory and enterprise fleet access.</p>{error&&<p role="alert" className="error-text">{error}</p>}<label>Institution ID<input required value={form.institution_id} onChange={e=>setForm({...form,institution_id:e.target.value})}/></label><label>Work email<input required type="email" autoComplete="username" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Password<input required type="password" autoComplete="current-password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label><button disabled={busy}>{busy?'Signing in…':'Enter command center'}</button><p><a href="/login">Tratum organization access</a></p></form></div>;
}
