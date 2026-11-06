// =======================================================
// FILE: admin-ui/src/components/ErrorBox.jsx
// =======================================================
import React from 'react'; // <--- ADD THIS
export default function ErrorBox({ text }) {
  return (
    <div className="card card-error">
      <span className="error-text">Critical_Failure:</span>
      <p style={{ marginTop: '10px', color: '#ccc' }}>{text}</p>
    </div>
  );
}
