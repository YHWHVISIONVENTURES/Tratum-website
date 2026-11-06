import React from 'react';
import Card from '../components/Card';
import Loader from '../components/Loader';
import ErrorBox from '../components/ErrorBox';
import useFetch from '../hooks/useFetch';

export default function LogsPage() {
  const { data, loading, error } = useFetch('/admin/v1/dashboard/logs');
  if (loading && !data) return <Loader />;
  if (error) return <ErrorBox text={error} />;

  const logs = Array.isArray(data?.logs) ? data.logs : [];
  return (
    <div>
      <div className="page-heading"><div><h1>Audit logs</h1><p>Most recent recorded events</p></div></div>
      <div className="grid"><Card title="Recent records" value={logs.length} subtitle="latest 50" /></div>
      <div className="card section-card">
        <div className="table-wrap"><table><thead><tr><th>ID</th><th>Event</th><th>Actor</th><th>Details</th><th>Time</th></tr></thead>
          <tbody>{logs.length ? logs.map((row, index) => <tr key={row.id || index}>
            <td>{row.id ?? '-'}</td><td>{row.event_code || row.action || row.event_type || '-'}</td>
            <td>{row.actor_id || row.user_id || row.actor || 'System'}</td>
            <td>{row.description || row.message || '-'}</td>
            <td>{row.created_at ? new Date(row.created_at).toLocaleString() : '-'}</td>
          </tr>) : <tr><td colSpan="5" className="empty-state">No audit records found.</td></tr>}</tbody>
        </table></div>
      </div>
    </div>
  );
}
