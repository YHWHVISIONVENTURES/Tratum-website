import React from 'react';
import useFetch from '../hooks/useFetch';
import ErrorBox from '../components/ErrorBox';
export default function RuntimePage() {
 const {data,error}=useFetch('/admin/v1/dashboard/runtime');
 return <div><div className="page-heading"><div><h1>Infrastructure</h1><p>Service observations refreshed every 10 seconds</p></div></div>
 {error && <ErrorBox text={error}/>} {data && <>
 <div className="grid"><section className="card"><h2>API server</h2><p>Uptime: {data.server.uptime_seconds}s</p><p>Memory: {Math.round(data.server.memory_bytes/1048576)} MB</p></section>
 <section className="card"><h2>PostgreSQL</h2><p>{data.database.status}</p><p>{data.database.latency_ms} ms</p></section></div>
 <section className="card"><h2>Workers: {data.workers.status}</h2><p>{data.workers.reason}</p>
 <div style={{overflowX:'auto'}}><table><thead><tr><th>Worker</th><th>Instance</th><th>State</th><th>Last cycle finished</th></tr></thead><tbody>
 {(data.workers.items || []).map(worker=><tr key={`${worker.worker_name}:${worker.instance_id}`}><td>{worker.worker_name}</td><td>{worker.instance_id}</td><td>{worker.status}</td><td>{worker.last_finished_at ? new Date(worker.last_finished_at).toLocaleString() : 'No completed cycle'}</td></tr>)}
 </tbody></table></div></section></>}
 <p>Last observation: {data?.observed_at || 'Awaiting server'}</p></div>;
}
