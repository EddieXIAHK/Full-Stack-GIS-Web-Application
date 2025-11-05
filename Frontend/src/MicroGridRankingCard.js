import React from 'react';
import CompetitionDonutChart from './CompetitionDonutChart';
import './MicroGridRankingCard.css';

/**
 * MicroGridRankingCard Component
 *
 * Displays a single micro-grid ranking item with:
 * - Rank number
 * - Grid name (Chinese and English)
 * - District name
 * - Competition donut chart
 * - Leading/lagging percentage
 * - Click interaction for drill-down
 *
 * @param {Object} props.item - Ranking data object
 * @param {string} props.item.grid_name - Grid name in Chinese
 * @param {string} props.item.grid_name_eng - Grid name in English
 * @param {string} props.item.district - District name
 * @param {string} props.item.comp_lead_behind - "領先" or "落後"
 * @param {number} props.item.comp_lead_behind_percent - Leading/lagging percentage
 * @param {number} props.item.comp_strong_we_strong - Competition metric
 * @param {number} props.item.comp_strong_we_weak - Competition metric
 * @param {number} props.item.comp_weak_we_strong - Competition metric
 * @param {number} props.item.comp_weak_we_weak - Competition metric
 * @param {number} props.rank - Rank number (1-10)
 * @param {Function} props.onClick - Click handler for drill-down
 * @param {boolean} props.isLeading - Whether this is a leading grid (vs lagging)
 */
const MicroGridRankingCard = ({ item, rank, onClick, isLeading = true }) => {
  const isPositive = item.comp_lead_behind === '領先' || item.comp_lead_behind_percent > 0;

  const handleClick = () => {
    if (onClick) {
      onClick(item);
    }
  };

  return (
    <div
      className={`ranking-card ${isLeading ? 'leading' : 'lagging'}`}
      onClick={handleClick}
      style={{ animationDelay: `${rank * 0.05}s` }}
    >
      {/* Rank Badge */}
      <div className="ranking-badge">
        <span className="ranking-number">{rank}</span>
      </div>

      {/* Grid Info */}
      <div className="ranking-content">
        <div className="ranking-info">
          <div className="grid-name-container">
            <span className="grid-name-chinese">{item.grid_name}</span>
            {item.grid_name_eng && (
              <span className="grid-name-english">{item.grid_name_eng}</span>
            )}
          </div>
          <div className="district-name">{item.district}</div>
        </div>

        {/* Competition Donut Chart */}
        <div className="ranking-chart">
          <CompetitionDonutChart
            data={{
              comp_strong_we_strong: item.comp_strong_we_strong,
              comp_strong_we_weak: item.comp_strong_we_weak,
              comp_weak_we_strong: item.comp_weak_we_strong,
              comp_weak_we_weak: item.comp_weak_we_weak
            }}
            size={70}
          />
        </div>

        {/* Leading/Lagging Percentage */}
        <div className="ranking-percentage">
          <div className={`percentage-value ${isPositive ? 'positive' : 'negative'}`}>
            {isPositive ? '+' : ''}{Math.abs(item.comp_lead_behind_percent).toFixed(1)}%
          </div>
          <div className="percentage-label">
            {isPositive ? '領先' : '落後'}
          </div>
        </div>
      </div>

      {/* Click hint */}
      <div className="ranking-click-hint">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </div>
    </div>
  );
};

export default React.memo(MicroGridRankingCard);
