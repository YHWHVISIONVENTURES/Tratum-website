import React from 'react';
import useFetch from '../hooks/useFetch';
import Loader from '../components/Loader';
import ErrorBox from '../components/ErrorBox';
export default function NetworkPage(){
 const {data,loading,error}=useFetch('/admin/v2/network');
 if(loading&&!data)return <Loader/>;if(error)return <ErrorBox text={error}/>;
 return <div><div className="page-heading"><div><h1>Network command</h1><p>Tratum operator view across institution workspaces</p></div><span className="updated-at">{data?.observed_at&&new Date(data.observed_at).toLocaleString()}</span></div><section className="card"><div className="table-wrap"><table><thead><tr><th>Institution</th><th>Type</th><th>Status</th><th>Devices / active</th><th>Upload batches</th><th>Last evidence</th><th>Webhook delivery</th></tr></thead><tbody>{data?.institutions?.length?data.institutions.map(i=><tr key={i.id}><td>{i.name}<br/><small>ID {i.id}</small></td><td>{i.type}</td><td>{i.status}</td><td>{i.devices.total} / {i.devices.active}</td><td>{i.batches.total}</td><td>{i.batches.latest?new Date(i.batches.latest).toLocaleString():'No uploads'}</td><td>{i.webhooks.length?i.webhooks.map(w=><div key={w.status}>{w.status}: {w.total}</div>):'No events'}</td></tr>):<tr><td colSpan="7" className="empty-state">No institutions onboarded.</td></tr>}</tbody></table></div><p className="page-heading-note">These are measured device uploads and delivery states. Financial settlement and economic indicators require their respective verified engines.</p></section></div>;
}
