// Legend.js
import React, { useRef, useEffect } from 'react';
import L from 'leaflet';
import './MapStyles.css';

// Shape mappings imported from TelecomMap.js logic
const PLANNING_SCENARIO_SHAPE_MAP = {
    '1_高投訴': 'circle',
    '2_重點場景': 'triangle',
    '3_弱覆蓋': 'square',
    '4_高負荷': 'diamond',
    '5_高端區域': 'star',
    '6_tobgn': 'hexagon',
};

// Color maps for six-dimension data categories (following the same pattern as other sections)
export const COMPLAINT_DATA_COLOR_MAP = {
    'data_geojson': '#d17021',
    'toc_2024': '#ff0000ff',
    'toc_2025': '#ff0000ff',
};

export const SIMULATION_DATA_COLOR_MAP = {
    'RAW_5G_Layer': '#a83f39',
    'RAW_4G_Layer': '#8b5a00'
};

export const MICROPHONE_DATA_COLOR_MAP = {
    'grid_highload': '#d1b226'
};

export const LTE_COMPETITION_COLOR_MAP = {
    '競強我強': '#39ff23',
    '競強我弱': '#ff0000',
    '競弱我強': '#3729ff', 
    '競弱我弱': '#606060'
};

export const NR_COMPETITION_COLOR_MAP = {
    '競強我強': '#39ff23',
    '競強我弱': '#ff0000',
    '競弱我強': '#3729ff', 
    '競弱我弱': '#606060'
};

export const RSRP_COLOR_MAP = {
    '>= -70 dBm': '#006837',
    '-70 to -80 dBm': '#1a9850',
    '-80 to -90 dBm': '#66bd63',
    '-90 to -100 dBm': '#d9ef8b',
    '-100 to -110 dBm': '#fdae61',
    '-110 to -120 dBm': '#d73027',
    '< -120 dBm': '#a50026',
    'No Data': '#808080'
};

export const SINR_COLOR_MAP = {
    '> 0 ': '#91cebf',      
    '-3 to 0': '#e4d49a',  
    '< -3': '#9a641f',    
    'No Data': '#808080'     
};

export const COMPETITIVE_SITE_COLOR_MAP = {
    'hkt4g_1800_indoor': '#ff8c42',
    'hkt4g_1800_outdoor': '#ff6b35',
    'hkt4g_900_indoor': '#5dade2',
    'hkt4g_900_outdoor': '#3498db',
    'hkt2025_sites_indoor': '#f1948a',
    'hkt2025_sites_outdoor': '#e74c3c',
    'hut_sites_indoor': '#9b59b6',
    'hut_sites_outdoor': '#8e44ad',
    'smt_sites_indoor': '#27ae60',
    'smt_sites_outdoor': '#229954',
    'h3_sites': '#ffffff'
};

export const COMPETITIVE_SITE_LABEL_MAP = {
    'hkt4g_1800_indoor': 'H站點 LTE 1800 Indoor',
    'hkt4g_1800_outdoor': 'H站點 LTE 1800 Outdoor',
    'hkt4g_900_indoor': 'H站點 LTE 900 Indoor',
    'hkt4g_900_outdoor': 'H站點 LTE 900 Outdoor',
    'hkt2025_sites_indoor': 'H站點 2025 Indoor Sites',
    'hkt2025_sites_outdoor': 'H站點 2025 Outdoor Sites',
    'hut_sites_indoor': '3站點 Indoor',
    'hut_sites_outdoor': '3站點 Outdoor',
    'smt_sites_indoor': 'SMT 站點 Indoor',
    'smt_sites_outdoor': 'SMT 站點 Outdoor',
    'h3_sites': '2025Q2 競對數據'
};

// 簡化的圖標組件
const LegendIcon = ({ shape, color }) => {
    const baseStyle = {
        width: '12px',
        height: '12px',
        marginRight: '6px',
        flexShrink: 0,
        display: 'inline-block'
    };

    switch (shape) {
        case 'square':
            return (
                <div
                    style={{
                        ...baseStyle,
                        backgroundColor: color,
                        border: '1px solid #fff'
                    }}
                />
            );
        case 'circle':
            return (
                <div
                    style={{
                        ...baseStyle,
                        backgroundColor: color,
                        border: '1px solid #fff',
                        borderRadius: '50%'
                    }}
                />
            );
        case 'triangle':
            return (
                <div
                    style={{
                        width: '0',
                        height: '0',
                        borderLeft: '6px solid transparent',
                        borderRight: '6px solid transparent',
                        borderBottom: `12px solid ${color}`,
                        marginRight: '6px',
                        flexShrink: 0
                    }}
                />
            );
        case 'diamond':
            return (
                <div
                    style={{
                        ...baseStyle,
                        backgroundColor: color,
                        border: '1px solid #fff',
                        transform: 'rotate(45deg)'
                    }}
                />
            );
        case 'star':
            return (
                <div
                    style={{
                        ...baseStyle,
                        backgroundColor: color,
                        clipPath: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)'
                    }}
                />
            );
        case 'hexagon':
            return (
                <div
                    style={{
                        ...baseStyle,
                        backgroundColor: color,
                        clipPath: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)'
                    }}
                />
            );
        default:
            return (
                <div
                    style={{
                        ...baseStyle,
                        backgroundColor: color,
                        border: '1px solid #fff'
                    }}
                />
            );
    }
};

const Legend = ({
    isVisible = true,
    planningScenarioColors = {},
    planningScenarioLabels = {},
    liveSiteTypeColors = {},
    competitiveSiteColors = {},
    discoveryGridCategories = {},
    complaintDataColors = {},
    simulationDataColors = {},
    microphoneDataColors = {},
    lteCompetitionColors = {},
    nrCompetitionColors = {},
    rsrpColors = {},
    sinrColors = {},
}) => {

    // 🚀 IMPORTANT: Hooks must be called before any conditional returns
    // 使用ref来获取DOM元素，然后使用Leaflet的事件禁用方法
    const ref = useRef(null);

    // 使用Leaflet的DomEvent方法来防止事件传播到地图，与其他selection menu保持一致
    useEffect(() => {
        if (ref.current) {
            // 禁用滚轮传播 - 这是关键修复
            L.DomEvent.disableScrollPropagation(ref.current);
            // 禁用点击传播 - 防止双击和其他点击事件
            L.DomEvent.disableClickPropagation(ref.current);
        }
    }, []);

    // 🚀 UPDATED: Hide legend if not visible (after hooks are called)
    if (!isVisible) return null;

    // 簡化的標準區段組件
    const Section = ({ title, items }) => {
        if (!items || items.length === 0) return null;
        return (
            <div className="legend-section">
                <div className="legend-title">{title}</div>
                <div className="legend-items">
                    {items.map(({ key, color, label, shape }) => (
                        <div key={key} className="legend-item">
                            <LegendIcon shape={shape} color={color} />
                            <span className="legend-label">{label}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    // Build sections only if there are items
    const planningItems = Object.keys(planningScenarioColors).map(key => ({
        key,
        color: planningScenarioColors[key],
        label: planningScenarioLabels[key] || key,
        shape: PLANNING_SCENARIO_SHAPE_MAP[key] || 'circle',
    }));

    const allLiveSiteCategories = [
        'Outdoor Site',
        'Indoor Site',
        'Indoor-Pico/Micro Site',
        'Indoor + Outdoor Site'
    ];

    const liveTypeItems = allLiveSiteCategories.map(key => ({
        key,
        color: liveSiteTypeColors[key] || '#999999',
        label: key,
        shape: 'triangle',
    }));

    // Build competitive site items with proper shapes and labels
    const competitiveSiteItems = Object.keys(competitiveSiteColors).map(key => ({
        key,
        color: competitiveSiteColors[key],
        label: COMPETITIVE_SITE_LABEL_MAP[key] || key,
        shape: key === 'h3_sites' ? 'hexagon' : 'diamond',
    }));

    const gridItems = Object.keys(discoveryGridCategories).map(key => ({
        key,
        color: discoveryGridCategories[key]?.color || '#999999',
        label: discoveryGridCategories[key]?.label || key,
        shape: 'square',
    }));

    // Build six-dimension data sections following the same pattern
    const complaintItems = Object.keys(complaintDataColors).map(key => ({
        key,
        color: complaintDataColors[key],
        label: key === 'data_geojson' ? '網絡投訴' : key,
        shape: 'square',
    }));

    const simulationItems = Object.keys(simulationDataColors).map(key => ({
        key,
        color: simulationDataColors[key],
        label: key === 'RAW_5G_Layer' ? 'NR 仿真原始數據' :
               key === 'RAW_4G_Layer' ? 'LTE 仿真原始數據' : key,
        shape: 'square',
    }));

    const microphoneItems = Object.keys(microphoneDataColors).map(key => ({
        key,
        color: microphoneDataColors[key],
        label: key === 'grid_highload' ? '高負荷數據' : key,
        shape: 'square',
    }));

    // Merge LTE and NR competition colors (they have the same mappings)
    const competitionColors = { ...lteCompetitionColors, ...nrCompetitionColors };
    const lteCompetitionItems = Object.keys(competitionColors).map(key => ({
        key,
        color: competitionColors[key],
        label: key, // Use the key directly as it's already in the correct format
        shape: 'square',
    }));

    const rsrpItems = Object.keys(rsrpColors).map(key => ({
        key,
        color: rsrpColors[key],
        label: key,
        shape: 'square',
    }));

    const sinrItems = Object.keys(sinrColors).map(key => ({
        key,
        color: sinrColors[key],
        label: key,
        shape: 'square',
    }));

    return (
        <div
            ref={ref}
            className="map-legend"
            style={{
                pointerEvents: 'auto',
                zIndex: 1002
            }}
        >
            <Section title="投訴數據" items={complaintItems} />
            <Section title="MR競對數據" items={gridItems} />
            <Section title="仿真數據" items={simulationItems} />
            <Section title="高負荷數據" items={microphoneItems} />
            <Section title="規劃站點場景" items={planningItems} />
            <Section title="現有站點類型" items={liveTypeItems} />
            <Section title="競對站點" items={competitiveSiteItems} />
            {/* 合併 LTE 和 NR 競對場景為一個圖例 */ } 
            <Section title="LTE/NR 競對場景" items={lteCompetitionItems} />
            <Section title="RSRP" items={rsrpItems} />
            <Section title="SINR" items={sinrItems} />
        </div>
    );
};

export default Legend;