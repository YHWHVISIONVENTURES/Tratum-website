import React from 'react';
import useFetch from '../hooks/useFetch';
import ErrorBox from '../components/ErrorBox';
export default function RuntimePage() {
 const {data,error}=useFetch('/admin/v1/dashboard/runtime');
 return <div><div className="page-heading"><div><h1>Infrastructure</h1><p>Live service observations</p></div></div>{error && <ErrorBox text={error}/>}{data && <div className="grid"><section className="card"><h2>API server</h2><p>Uptime: {data.server.uptime_seconds}s</p><p>Memory: {Math.round(data.server.memory_bytes/1048576)} MB</p></section><section className="card"><h2>PostgreSQL</h2><p>{data.database.status}</p><p>{data.database.latency_ms} ms</p></section><section className="card"><h2>Workers</h2><p>{data.workers.status}</p><p>{data.workers.reason}</p></section></div>}<p>Last observation: {data?.observed_at || 'Awaiting server'}</p></div>;
}
