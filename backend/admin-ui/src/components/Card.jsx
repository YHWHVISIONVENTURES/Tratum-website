// =======================================================
// FILE: admin-ui/src/components/Card.jsx
// =======================================================
import React from 'react'; // <--- ADD THIS
export default function Card({
 title,
 value,
 subtitle
}) {
 return (
  <div className="card">
    <div className="card-title">{title}</div>
    <div className="card-value">{value}</div>
    <div className="card-sub">{subtitle}</div>
  </div>
 );
}