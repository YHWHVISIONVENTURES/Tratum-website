// =====================================================
// FILE: admin-ui/src/context/AuthContext.jsx
// HARD LOGOUT / CLEAN SESSION STATE
// =====================================================

import {
  createContext,
  useContext,
  useState
} from 'react';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [token, setToken] = useState(
    localStorage.getItem('admin_token')
  );

  const [role, setRole] = useState(
    localStorage.getItem('admin_role')
  );

  function login(payload) {
    localStorage.setItem(
      'admin_token',
      payload.token
    );

    localStorage.setItem(
      'admin_role',
      payload.role
    );

    setToken(payload.token);
    setRole(payload.role);
  }

  function logout() {
    // remove only admin auth keys
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_role');
    sessionStorage.clear();

    setToken(null);
    setRole(null);
  }

  return (
    <AuthContext.Provider
      value={{
        token,
        role,
        login,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}