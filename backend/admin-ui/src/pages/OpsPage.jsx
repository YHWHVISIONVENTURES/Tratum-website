import Card from '../components/Card';
import Loader from '../components/Loader';
import ErrorBox from '../components/ErrorBox';
import useFetch from '../hooks/useFetch';

const number = (value) => Number(value || 0).toLocaleString();

export default function OpsPage() {
  const { data, loading, error } = useFetch('/admin/v1/dashboard/ops');
  if (loading && !data) return <Loader />;
  if (error) return <ErrorBox text={error} />;

  const snapshot = data?.data || {};
  const state = snapshot.sovereign_state || {};
  const transactions = snapshot.transactions || {};
  const rails = snapshot.rails || {};

  return (
    <div>
      <div className="page-heading">
        <div><h1>Operations</h1><p>Current network and transaction snapshot</p></div>
        <span className="updated-at">Updated {snapshot.generated_at ? new Date(snapshot.generated_at).toLocaleString() : '-'}</span>
      </div>
      <div className="grid">
        <Card title="Active institutions" value={number(state.active_institutions)} subtitle="connected partners" />
        <Card title="Active devices" value={number(state.active_devices)} subtitle={`${number(state.total_devices)} registered`} />
        <Card title="Transactions" value={number(transactions.total_transactions)} subtitle="all time" />
        <Card title="System health" value={`${number(state.health_score)}%`} subtitle="network score" />
        <Card title="Transaction velocity" value={`${number(transactions.tx_per_second)}/s`} subtitle="current rate" />
        <Card title="Rail failure rate" value={`${number(Number(rails.failure_rate || 0) * 100)}%`} subtitle={`${number(rails.failed_operations)} failed operations`} />
      </div>
    </div>
  );
}
