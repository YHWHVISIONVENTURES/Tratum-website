import Card from '../components/Card';
import Loader from '../components/Loader';
import ErrorBox from '../components/ErrorBox';
import useFetch from '../hooks/useFetch';

const number = (value) => Number(value || 0).toLocaleString();

export default function SecurityPage() {
  const { data, loading, error } = useFetch('/admin/v1/dashboard/security');
  if (loading && !data) return <Loader />;
  if (error) return <ErrorBox text={error} />;

  const snapshot = data?.data || {};
  const summary = snapshot.summary || {};
  const suspicious = Array.isArray(snapshot.suspicious_references) ? snapshot.suspicious_references.length : 0;

  return (
    <div>
      <div className="page-heading">
        <div><h1>Security</h1><p>Fraud and integrity indicators</p></div>
        <span className="updated-at">Updated {snapshot.generated_at ? new Date(snapshot.generated_at).toLocaleString() : '-'}</span>
      </div>
      <div className="grid">
        <Card title="Risk score" value={number(summary.risk_score)} subtitle="risk index" />
        <Card title="Failed signatures" value={number(summary.failed_signatures)} subtitle="rejected requests" />
        <Card title="Rejected timestamps" value={number(summary.rejected_timestamps)} subtitle="replay window checks" />
        <Card title="Failed attestations" value={number(summary.failed_attestations)} subtitle="device verification" />
        <Card title="Critical devices" value={number(summary.critical_devices)} subtitle="trust alerts" />
        <Card title="Suspicious references" value={number(suspicious)} subtitle="flagged for review" />
      </div>
    </div>
  );
}
