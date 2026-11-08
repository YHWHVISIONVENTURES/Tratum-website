import React, { useState } from 'react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';

export default function LoginPage() {
  const { login, token } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] =
    useState('');

  const [error, setError] =
    useState('');

  const [loading, setLoading] =
    useState(false);

  if (token) {
    return (
      <Navigate
        to="/admin/network"
        replace
      />
    );
  }

  async function submit(e) {
    e.preventDefault();

    if (loading) return;

    setLoading(true);
    setError('');

    try {
      const res = await api.post(
        '/admin/v1/auth/login',
        {
          email,
          password
        }
      );

      login(res.data);

    } catch (err) {
      setError(
        (
          err.response?.data?.error ||
          'CONNECTION_REFUSED'
        ).toUpperCase()
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form
        onSubmit={submit}
        className="card"
      >
        <h2>Tratum Access</h2>

        {error && (
          <div
            className="card-sub"
            style={{
              color: '#ff3131',
              marginBottom: '1rem'
            }}
          >
            {error}
          </div>
        )}

        <input
          type="email"
          placeholder="ADMIN_EMAIL"
          required
          value={email}
          onChange={(e) =>
            setEmail(
              e.target.value
            )
          }
          disabled={loading}
        />

        <input
          type="password"
          placeholder="PASSWORD"
          required
          value={password}
          onChange={(e) =>
            setPassword(
              e.target.value
            )
          }
          disabled={loading}
          style={{
            marginTop: '12px'
          }}
        />

        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: '20px'
          }}
        >
          {loading
            ? 'AUTHENTICATING...'
            : 'LOGIN'}
        </button>

        <div
          className="card-sub"
          style={{
            marginTop: '18px',
            textAlign: 'center',
            fontSize: '11px'
          }}
        >
          TRATUM ADMIN CONTROL
        </div>
      </form>
    </div>
  );
}
