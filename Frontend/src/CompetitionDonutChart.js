import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import './CompetitionDonutChart.css';

/**
 * CompetitionDonutChart Component
 *
 * Displays competition analysis metrics as a donut chart with 4 segments:
 * - 競強我強 (comp_strong_we_strong): Both strong - Dark green
 * - 競弱我強 (comp_weak_we_strong): Competitor weak, we strong - Light green
 * - 競強我弱 (comp_strong_we_weak): Competitor strong, we weak - Red
 * - 競弱我弱 (comp_weak_we_weak): Both weak - Gray
 *
 * @param {Object} props.data - Competition metrics data
 * @param {number} props.data.comp_strong_we_strong - Percentage where both are strong
 * @param {number} props.data.comp_strong_we_weak - Percentage where competitor strong, we weak
 * @param {number} props.data.comp_weak_we_strong - Percentage where competitor weak, we strong
 * @param {number} props.data.comp_weak_we_weak - Percentage where both are weak
 * @param {number} props.size - Diameter of the donut chart in pixels (default: 80)
 */
const CompetitionDonutChart = ({ data, size = 80 }) => {
  // Define metric configurations
  const metrics = [
    {
      key: 'comp_strong_we_strong',
      label: '競強我強',
      shortLabel: '雙強',
      color: '#22c55e', // Dark green
      description: 'Both strong'
    },
    {
      key: 'comp_weak_we_strong',
      label: '競弱我強',
      shortLabel: '我優',
      color: '#86efac', // Light green
      description: 'We lead'
    },
    {
      key: 'comp_strong_we_weak',
      label: '競強我弱',
      shortLabel: '我弱',
      color: '#ef4444', // Red
      description: 'Need improvement'
    },
    {
      key: 'comp_weak_we_weak',
      label: '競弱我弱',
      shortLabel: '雙弱',
      color: '#9ca3af', // Gray
      description: 'Both weak'
    }
  ];

  /**
   * Prepare chart data from input
   */
  const chartData = metrics
    .map(metric => ({
      name: metric.label,
      shortName: metric.shortLabel,
      value: data[metric.key] || 0,
      color: metric.color,
      description: metric.description
    }))
    .filter(item => item.value > 0); // Only include non-zero values

  /**
   * Custom tooltip component
   */
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      return (
        <div className="donut-tooltip">
          <div className="donut-tooltip-label">{data.name}</div>
          <div className="donut-tooltip-value">{data.value.toFixed(1)}%</div>
          <div className="donut-tooltip-desc">{data.payload.description}</div>
        </div>
      );
    }
    return null;
  };

  /**
   * Custom label for pie segments (only show if value > 5%)
   */
  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
    if (percent < 0.05) return null; // Don't show label for small segments

    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text
        x={x}
        y={y}
        fill="white"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={10}
        fontWeight={600}
        style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  // Handle case where all values are 0 or data is missing
  if (!data || chartData.length === 0) {
    return (
      <div className="donut-chart-empty" style={{ width: size, height: size }}>
        <div className="donut-empty-message">N/A</div>
      </div>
    );
  }

  return (
    <div className="donut-chart-container" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius="50%"
            outerRadius="80%"
            paddingAngle={2}
            dataKey="value"
            label={renderCustomLabel}
            labelLine={false}
            animationDuration={800}
            animationBegin={0}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default React.memo(CompetitionDonutChart);
