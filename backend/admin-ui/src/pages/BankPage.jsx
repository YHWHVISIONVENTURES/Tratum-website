import React,{useState,useEffect} from 'react';
import axios from 'axios';
export default function BankPage(){
 const [token,setToken]=useState(''),[bank,setBank]=useState(null),[section,setSection]=useState('overview'),[data,setData]=useState(null),[error,setError]=useState('');
 const base=import.meta.env.VITE_API_BASE_URL || '';
 useEffect(()=>{if(!token)return; let active=true;
 async function load(){try{const r=await axios.get(`${base}/bank/v1/${section}`,{headers:{Authorization:`Bearer ${token}`}});if(active){setData(r.data);setError('');}}catch(e){if(active){setData(null);setError('Session expired or network data unavailable');}}}
 load();const timer=setInterval(load,10000);return()=>{active=false;clearInterval(timer);};},[token,section,base]);
 async function login(e){e.preventDefault();const form=e.currentTarget;const key=new FormData(form).get('key');form.reset();try{const r=await axios.post(`${base}/bank/v1/session`,{},{headers:{'x-api-key':key}});setToken(r.data.token);setBank(r.data.institution);setError('');}catch{setError('Institution credential rejected or service unavailable');}}
  function renderData(value){
  const records=value.nodes || value.logs;
  if(records){const keys=records.length?Object.keys(records[0]):[];return <div className="table-wrap"><table><thead><tr>{keys.map(k=><th key={k}>{k.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{records.map((row,i)=><tr key={row.device_id || row.id || i}>{keys.map(k=><td key={k}>{row[k] == null ? '—' : typeof row[k]==='object'?JSON.stringify(row[k]):String(row[k])}</td>)}</tr>)}</tbody></table>{!records.length && <p>No records for this institution.</p>}</div>;}
  return <div className="grid">{Object.entries(value.summary || {}).map(([k,v])=><section className="card" key={k}><h3>{k.replaceAll('_',' ')}</h3><p className="card-value">{String(v ?? '—')}</p></section>)}</div>;
 }
 return <main style={{maxWidth:1200,margin:'40px auto',padding:24}}><h1>TRATUM / Institution network</h1><p>{bank?.name || 'Secure institution workspace'}</p>{!token?<form onSubmit={login}><label>Institution API credential<input name="key" type="password" required autoComplete="off"/></label><button>Open network workspace</button></form>:<><nav style={{display:'flex',gap:12}}>{['overview','nodes','billing','logs'].map(s=><button key={s} onClick={()=>{setData(null);setSection(s);}}>{s}</button>)}<button onClick={()=>{setToken('');setData(null);setBank(null);}}>Sign out</button></nav><section className="card"><h2>{section}</h2>{data?renderData(data):<p>Waiting for network data</p>}</section></>}{error && <p role="alert">{error}</p>}</main>;
}

