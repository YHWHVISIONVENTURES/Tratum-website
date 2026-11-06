// =======================================================
// FILE: admin-ui/src/main.jsx
// UPDATED PRODUCTION ENTRY
// =======================================================

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import App from './App';
import './styles.css';

// -------------------------------------------------------
// OPTIONAL GLOBAL CONFIG
// -------------------------------------------------------
const root = ReactDOM.createRoot(
  document.getElementById('root')
);

// -------------------------------------------------------
// RENDER APPLICATION
// -------------------------------------------------------
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);