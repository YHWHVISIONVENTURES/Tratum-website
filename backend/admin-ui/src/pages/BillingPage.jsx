import React from 'react';
import Card from '../components/Card';
import Loader from '../components/Loader';
import ErrorBox from '../components/ErrorBox';
import useFetch from '../hooks/useFetch';

const number = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function BillingPage() {
  const { data, loading, error } = useFetch('/admin/v1/dashboard/billing');
  if (loading && !data) return <Loader />;
  if (error) return <ErrorBox text={error} />;

  const summary = data?.summary || {};
  const invoices = Array.isArray(data?.invoices) ? data.invoices : [];

  return (
    <div>
      <div className="page-heading">
        <div><h1>Billing</h1><p>{data?.period?.from || 'Current period'} through {data?.period?.to || '-'}</p></div>
      </div>
      <div className="grid">
        <Card title="Total billed" value={number(summary.total_billed)} subtitle="current period" />
        <Card title="Total paid" value={number(summary.total_paid)} subtitle="collected" />
        <Card title="Unpaid balance" value={number(summary.unpaid_balance)} subtitle="awaiting payment" />
        <Card title="Unpaid items" value={number(summary.unpaid_items)} subtitle="open invoices" />
      </div>
      <div className="card section-card">
        <div className="card-title">Recent billing entries</div>
        <div className="table-wrap">
          <table><thead><tr><th>Reference</th><th>Institution</th><th>Fee</th><th>Amount</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>{invoices.length ? invoices.map((row) => <tr key={row.id}>
              <td>{row.id}</td><td>{row.actor_id || '-'}</td><td>{row.fee_code || '-'}</td><td>{number(row.amount)}</td>
              <td><span className={`status ${row.paid ? 'status-good' : 'status-pending'}`}>{row.paid ? 'Paid' : 'Unpaid'}</span></td>
              <td>{row.created_at ? new Date(row.created_at).toLocaleString() : '-'}</td>
            </tr>) : <tr><td colSpan="6" className="empty-state">No billing entries for this period.</td></tr>}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
