import RuntimePage from './pages/RuntimePage';
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Shell from './layout/shell';
import LoginPage from './pages/LoginPage';
import OpsPage from './pages/OpsPage';
import TreasuryPage from './pages/TreasuryPage';
import NodesPage from './pages/NodesPage';
import BillingPage from './pages/BillingPage';
import SecurityPage from './pages/SecurityPage';
import InstitutionsPage from './pages/InstitutionsPage';
import LogsPage from './pages/LogsPage';
import DeviceIntakesPage from './pages/DeviceIntakesPage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<ProtectedRoute><Shell /></ProtectedRoute>}>
          <Route index element={<Navigate to="ops" replace />} />
          <Route path="runtime" element={<RuntimePage />} /><Route path="ops" element={<OpsPage />} />
          <Route path="treasury" element={<TreasuryPage />} />
          <Route path="nodes" element={<NodesPage />} />
          <Route path="device-intakes" element={<DeviceIntakesPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="institutions" element={<InstitutionsPage />} />
          <Route path="logs" element={<LogsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin/ops" replace />} />
      </Routes>
    </AuthProvider>
  );
}


