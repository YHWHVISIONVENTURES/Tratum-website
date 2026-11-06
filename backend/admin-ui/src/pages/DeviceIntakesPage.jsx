import React, { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';

export default function DeviceIntakesPage() {
  const [intakes, setIntakes] = useState([]);
  const [form, setForm] = useState({ serial_number: '', customer_ref: '', institution_id: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get('/admin/v1/device-intakes');
      setIntakes(response.data.intakes || []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load device intake queue.');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/admin/v1/device-intakes', form);
      setForm({ serial_number: '', customer_ref: '', institution_id: '' });
      await refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to create device intake.');
    } finally {
      setSaving(false);
    }
  }

  return <div>
    <div className="page-heading"><div><h1>Device intake</h1><p>Record an agent’s device handoff against an existing customer reference.</p></div></div>
    <div className="card">
      <div className="card-title">New intake</div>
      <form className="intake-form" onSubmit={submit}>
        <label>Device serial number<input required maxLength="128" value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} /></label>
        <label>Customer reference<input required maxLength="128" value={form.customer_ref} onChange={(e) => setForm({ ...form, customer_ref: e.target.value })} /></label>
        <label>Institution ID (optional)<input maxLength="128" value={form.institution_id} onChange={(e) => setForm({ ...form, institution_id: e.target.value })} /></label>
        <button disabled={saving}>{saving ? 'Recording…' : 'Record intake'}</button>
      </form>
      <p className="page-heading-note">Use the customer’s existing banking reference. This intake does not provision cryptographic credentials or pair the customer’s app.</p>
      {error && <div className="error-text" role="alert">{error}</div>}
    </div>
    <div className="card section-card">
      <div className="card-title">Recent intakes</div>
      <div className="table-wrap"><table><thead><tr><th>Serial number</th><th>Customer ref</th><th>Institution</th><th>Status</th><th>Recorded</th></tr></thead>
        <tbody>{intakes.length ? intakes.map((item) => <tr key={item.id}><td>{item.serial_number}</td><td>{item.customer_ref}</td><td>{item.institution_id || '—'}</td><td><span className="status status-pending">{item.status}</span></td><td>{new Date(item.created_at).toLocaleString()}</td></tr>) : <tr><td colSpan="5" className="empty-state">No device intakes recorded.</td></tr>}</tbody>
      </table></div>
    </div>
  </div>;
}
