import React, { useMemo } from 'react';
import { RadialBarChart, RadialBar, ResponsiveContainer, Tooltip } from 'recharts';
import './CoverageGaugeGrid.css';

/**
 * CoverageGaugeGrid Component - FREQUENCY-FIRST LAYOUT
 *
 * Displays coverage data organized by frequency bands (NR, C-Band, LTE),
 * with operators sorted by performance within each band.
 *
 * Layout:
 * - 3 rows (one per band: NR, C-Band, LTE)
 * - Each row: [Band Label] + [4 gauges sorted by coverage % descending]
 *
 * @param {Object} props.data - Coverage data object containing operator coverage percentages
 * @param {Object} props.data.cmhk - CMHK coverage { nr, cband, lte }
 * @param {Object} props.data.hkt - HKT coverage { nr, cband, lte }
 * @param {Object} props.data['3hk'] - 3HK coverage { nr, cband, lte }
 * @param {Object} props.data.smt - SMT coverage { nr, cband, lte }
 */
const CoverageGaugeGrid = ({ data }) => {
  /**
   * Determine color based on coverage percentage
   * Cold color palette: Cyan → Blue → Purple → Magenta
   */
  const getCoverageColor = (percentage) => {
    if (percentage >= 90) return '#06b6d4'; // Bright Cyan
    if (percentage >= 80) return '#3b82f6'; // Sky Blue
    if (percentage >= 70) return '#a855f7'; // Purple
    return '#ec4899'; // Deep Magenta
  };

  /**
   * Get ranking badge (1st, 2nd, 3rd, 4th)
   */
  const getRankingBadge = (rank) => {
    const badges = ['🥇', '🥈', '🥉', '4️⃣'];
    return badges[rank] || '';
  };

  /**
   * Custom tooltip component for gauges
   */
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="gauge-tooltip">
          <div className="gauge-tooltip-title">{data.band} - {data.operator}</div>
          <div className="gauge-tooltip-value">{data.value.toFixed(2)}%</div>
          <div className="gauge-tooltip-rank">排名: #{data.rank}</div>
        </div>
      );
    }
    return null;
  };

  /**
   * Prepare data organized by frequency bands with sorted operators
   */
  const bandRows = useMemo(() => {
    if (!data) return [];

    const operators = [
      { key: 'cmhk', label: 'CMHK' },
      { key: 'hkt', label: 'HKT' },
      { key: '3hk', label: '3HK' },
      { key: 'smt', label: 'SMT' }
    ];

    const bands = [
      { key: 'nr', label: 'NR', displayName: '5G NR' },
      { key: 'cband', label: 'C-Band', displayName: 'C-Band' },
      { key: 'lte', label: 'LTE', displayName: '4G LTE' }
    ];

    // Build data structure: [{ band, gauges: [sorted operators] }]
    return bands.map(band => {
      // Collect all operators' data for this band
      const operatorsData = operators.map(operator => {
        const operatorData = data[operator.key];
        const value = operatorData ? (operatorData[band.key] || 0) : 0;

        return {
          operator: operator.label,
          operatorKey: operator.key,
          band: band.label,
          bandKey: band.key,
          displayBandName: band.displayName,
          value: value,
          color: getCoverageColor(value),
          fill: getCoverageColor(value)
        };
      });

      // Sort by coverage percentage (descending) and add rank
      const sortedOperators = operatorsData
        .sort((a, b) => b.value - a.value)
        .map((item, index) => ({
          ...item,
          rank: index + 1,
          rankBadge: getRankingBadge(index)
        }));

      return {
        band: band.label,
        bandKey: band.key,
        displayBandName: band.displayName,
        gauges: sortedOperators
      };
    });
  }, [data]);

  /**
   * Render a single mini gauge
   */
  const renderGauge = (gaugeData, rowIndex, colIndex) => {
    const chartData = [
      {
        name: 'background',
        value: 100,
        fill: 'rgba(255, 255, 255, 0.1)'
      },
      {
        name: 'coverage',
        value: gaugeData.value,
        fill: gaugeData.color
      }
    ];

    const animationDelay = (rowIndex * 4 + colIndex) * 0.05;

    return (
      <div
        key={`${gaugeData.bandKey}-${gaugeData.operatorKey}`}
        className="coverage-gauge-cell"
        style={{ animationDelay: `${animationDelay}s` }}
      >
        <div className="gauge-header">
          <span className="gauge-operator">{gaugeData.operator}</span>
          <span className="gauge-rank-badge">{gaugeData.rankBadge}</span>
        </div>
        <div className="gauge-chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              cx="50%"
              cy="50%"
              innerRadius="60%"
              outerRadius="90%"
              barSize={10}
              data={chartData}
              startAngle={90}
              endAngle={-270}
            >
              <RadialBar
                background
                dataKey="value"
                cornerRadius={5}
                animationDuration={1000}
                animationBegin={animationDelay * 1000}
              />
              <Tooltip content={<CustomTooltip />} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="gauge-value-overlay">
            <span className="gauge-percentage">{gaugeData.value.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    );
  };

  /**
   * Render a single band row
   */
  const renderBandRow = (bandRow, rowIndex) => {
    return (
      <div key={bandRow.bandKey} className="band-row">
        {/* Prominent Band Label */}
        <div className="band-label">
          <div className="band-name">{bandRow.displayBandName}</div>
          <div className="band-subtitle">{bandRow.band}</div>
        </div>

        {/* Gauges for this band (sorted by performance) */}
        <div className="band-gauges">
          {bandRow.gauges.map((gauge, colIndex) =>
            renderGauge(gauge, rowIndex, colIndex)
          )}
        </div>
      </div>
    );
  };

  if (!data) {
    return <div className="coverage-gauge-grid-loading">Loading coverage data...</div>;
  }

  return (
    <div className="coverage-gauge-grid-container">
      <div className="coverage-gauge-grid-bands">
        {bandRows.map((bandRow, index) => renderBandRow(bandRow, index))}
      </div>
    </div>
  );
};

export default React.memo(CoverageGaugeGrid);
