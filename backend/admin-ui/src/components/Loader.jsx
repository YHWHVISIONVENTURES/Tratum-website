// =======================================================
// FILE: admin-ui/src/components/Loader.jsx
// =======================================================
import React from 'react'; // <--- ADD THIS
export default function Loader() {
  return (
    <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
      <div className="loading-text">
        SYNCING_WITH_CORE...
      </div>
    </div>
  );
}
