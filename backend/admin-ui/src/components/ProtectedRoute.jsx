// =====================================================
// FILE: admin-ui/src/components/ProtectedRoute.jsx
// =====================================================
import React from 'react'; // <--- ADD THIS
import { useAuth } from '../context/AuthContext';
import LoginPage from '../pages/LoginPage';

export default function ProtectedRoute({
 children
}) {
  const { token } = useAuth();

  if (!token) return <LoginPage />;

  return children;
}