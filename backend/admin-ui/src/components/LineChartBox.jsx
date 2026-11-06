// =======================================================
// FILE: admin-ui/src/components/LineChartBox.jsx
// =======================================================
import React from 'react'; // <--- ADD THIS
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip
} from 'recharts';

export default function LineChartBox({
  title,
  data,
  lineKey
}) {
  return (
    <div className="card chart-card">
      <div className="card-title">{title}</div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Line
            type="monotone"
            dataKey={lineKey}
            stroke="#39ff14"         /* Neon Green Line */
            strokeWidth={3}
            dot={{ r: 4, fill: '#39ff14' }} /* Glowing points */
            activeDot={{ r: 8, stroke: '#fff', strokeWidth: 2 }}
            />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}