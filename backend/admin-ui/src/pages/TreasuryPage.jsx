import React from 'react';
import Card from '../components/Card';
import Loader from '../components/Loader';
import ErrorBox from '../components/ErrorBox';
import useFetch from '../hooks/useFetch';

const number = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function TreasuryPage() {
  const { data, loading, error } = useFetch('/admin/v1/dashboard/treasury');
  if (loading && !data) return <Loader />;
  if (error) return <ErrorBox text={error} />;

  const snapshot = data?.data || {};
  const reserves = snapshot.reserves || {};
  const obligations = snapshot.obligations || {};
  const risk = snapshot.risk || {};
  const stablecoins = Array.isArray(reserves.stablecoin_reserves) ? reserves.stablecoin_reserves : [];

  return (
    <div>
      <div className="page-heading">
        <div><h1>Treasury</h1><p>Reserve, obligations, and liquidity indicators</p></div>
        <span className="updated-at">Updated {snapshot.generated_at ? new Date(snapshot.generated_at).toLocaleString() : '-'}</span>
      </div>
      <div className="grid">
        <Card title="Fiat float" value={number(reserves.fiat_float)} subtitle="reported reserve balance" />
        <Card title="Stablecoin assets" value={number(stablecoins.length)} subtitle="token balances listed below" />
        <Card title="Pending settlement obligations" value={number(obligations.pending_settlement_obligations)} subtitle="current queue" />
        <Card title="Treasury liabilities" value={number(obligations.treasury_liabilities)} subtitle="open obligations" />
        <Card title="Residual liquidity" value={number(risk.liquidity_coverage)} subtitle="reserves less exposure" />
        <Card title="Solvency ratio" value={`${number(risk.solvency_ratio)}x`} subtitle="reserve to exposure" />
      </div>
      <div className="card section-card">
        <div className="card-title">Stablecoin reserves by token</div>
        <div className="table-wrap"><table><thead><tr><th>Token</th><th>Balance</th></tr></thead>
          <tbody>{stablecoins.length ? stablecoins.map((item) => <tr key={item.token}>
            <td>{item.token}</td><td>{number(item.balance)}</td>
          </tr>) : <tr><td colSpan="2" className="empty-state">No stablecoin reserve rows.</td></tr>}</tbody>
        </table></div>
      </div>
    </div>
  );
}
