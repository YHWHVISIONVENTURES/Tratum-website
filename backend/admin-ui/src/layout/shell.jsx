// =======================================================
// FILE: admin-ui/src/layout/Shell.jsx
// TRUE LOGOUT / NO BACK NAV CACHE RETURN
// =======================================================

import React from 'react';
import {
  Outlet,
  NavLink,
  useNavigate
} from 'react-router-dom';

import { useAuth } from '../context/AuthContext';

import {
  LayoutDashboard,
  Wallet,
  Cpu,
  UserPlus,
  Receipt,
  Shield,
  Building2,
  ScrollText
} from 'lucide-react';

const menu = [
  {to:'/admin/network',label:'Network command',icon:LayoutDashboard},
  {to:'/admin/runtime',label:'Infrastructure',icon:Cpu},
  {to:'/admin/institutions',label:'Institutions',icon:Building2},
  {to:'/admin/device-intakes',label:'Device intake',icon:UserPlus},
  {to:'/admin/logs',label:'Audit logs',icon:ScrollText}
];

export default function Shell() {
  const navigate = useNavigate();

  const { logout } = useAuth();

  function handleLogout() {
    logout();

    // replace kills back-stack return
    navigate('/login', {
      replace: true
    });
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          TRATUM ADMIN
        </div>

        {menu.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive
                  ? 'nav active'
                  : 'nav'
              }
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            Global Operations Console
          </div>

          <div
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'center'
            }}
          >
            <div className="badge">
              TRATUM CONTROL PLANE
            </div>

            <button
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        </header>

        <section className="content">
          <Outlet />
        </section>
      </main>
    </div>
  );
}





