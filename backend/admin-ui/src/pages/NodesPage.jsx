import Card from '../components/Card';
import Loader from '../components/Loader';
import ErrorBox from '../components/ErrorBox';
import useFetch from '../hooks/useFetch';

const number = (value) => Number(value || 0).toLocaleString();

export default function NodesPage() {
  const { data, loading, error } = useFetch('/admin/v1/dashboard/nodes');
  if (loading && !data) return <Loader />;
  if (error) return <ErrorBox text={error} />;

  const snapshot = data?.data || {};
  const summary = snapshot.summary || {};
  const offline = Math.max(0, Number(summary.total_nodes || 0) - Number(summary.healthy_nodes || 0));

  return (
    <div>
      <div className="page-heading">
        <div><h1>Device nodes</h1><p>Fleet health and attestation snapshot</p></div>
        <span className="updated-at">Updated {snapshot.generated_at ? new Date(snapshot.generated_at).toLocaleString() : '-'}</span>
      </div>
      <div className="grid">
        <Card title="Healthy nodes" value={number(summary.healthy_nodes)} subtitle={`${number(summary.total_nodes)} total`} />
        <Card title="Not healthy" value={number(offline)} subtitle="requires investigation" />
        <Card title="Critical nodes" value={number(summary.critical_nodes)} subtitle="high priority" />
        <Card title="Stale nodes" value={number(summary.stale_nodes)} subtitle="not recently observed" />
        <Card title="Trust score" value={number(summary.avg_trust_score)} subtitle="average" />
        <Card title="Observability score" value={`${number(summary.observability_score)}%`} subtitle="fleet health" />
      </div>
    </div>
  );
}
