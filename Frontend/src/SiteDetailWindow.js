// SiteDetailWindow.js
import React, { useRef, useEffect } from 'react';
import './SiteDetailWindow.css';

// 🚀 PERFORMANCE FIX: Memoize component to prevent unnecessary re-renders
const SiteDetailWindow = React.memo(({ siteData, onClose }) => {
    const windowRef = useRef(null);

    useEffect(() => {
        // 防止事件冒泡到地图
        if (windowRef.current) {
            const handleWheel = (e) => e.stopPropagation();
            const handleMouseDown = (e) => e.stopPropagation();
            const handleDoubleClick = (e) => e.stopPropagation();
            
            const element = windowRef.current;
            element.addEventListener('wheel', handleWheel);
            element.addEventListener('mousedown', handleMouseDown);
            element.addEventListener('dblclick', handleDoubleClick);
            
            return () => {
                element.removeEventListener('wheel', handleWheel);
                element.removeEventListener('mousedown', handleMouseDown);
                element.removeEventListener('dblclick', handleDoubleClick);
            };
        }
    }, []);

    useEffect(() => {
        // 🚀 PERFORMANCE FIX: Safer body style management to prevent memory leaks
        if (windowRef.current) {
            // Store original overflow value
            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            
            return () => {
                // Restore original value or remove if it was empty
                if (originalOverflow) {
                    document.body.style.overflow = originalOverflow;
                } else {
                    document.body.style.removeProperty('overflow');
                }
            };
        }
    }, []);

    if (!siteData) return null;

    const p = siteData.properties;
    
    // Utility function to format numeric values as integers
    const formatNumericValue = (value) => {
        if (value === null || value === undefined || value === '') return value;
        
        // Check if value is a number or can be converted to a number
        const numValue = parseFloat(value);
        if (!isNaN(numValue) && isFinite(numValue)) {
            return Math.round(numValue).toString();
        }
        
        // Return original value if not numeric
        return value;
    };
    
    // 🚀 NEW: 判断是规划站点还是现有站点
    const isPlanningSite = p['site ID'] || p.site_id || p['1_高投訴'] !== undefined;
    const siteTitle = isPlanningSite ? 
        (p['site ID'] || p.site_id || '規劃站點') : 
        (p.live_site_id || p.plan_site_name || '現有站點');

    // 🚀 NEW: 根据站点类型配置信息分組
    const siteInfo = isPlanningSite ? {
        basic: {
            title: '基本信息',
            fields: {
                'site ID': '站點ID',
                'site_id': '站點ID',
                'plan_site_id': '規劃站點ID', 
                'site_name': '站點名稱',
                'district': '行政區',
                'address': '地址',
                'ownership': '擁有權'
            }
        },
        scenario: {
            title: '場景信息',
            fields: {
                '1_高投訴': '高投訴',
                '2_重點場景': '重點場景', 
                '3_弱覆蓋': '弱覆蓋',
                '4_高負荷': '高負荷',
                '5_高端區域': '高端區域',
                '6_tobgn': 'To BGN'
            }
        },
        technical: {
            title: '技術參數',
            fields: {
                'master_solution_type': '主解決方案類型',
                '分區': '分區',
                '1_高投訴': '高投訴標記',
                '高投訴地標性場館': '高投訴地標',
                '高投訴地點': '高投訴地點',
                '高投訴remark': '高投訴備註'
            }
        },
        planning: {
            title: '規劃信息',
            fields: {
                '2_重點場館': '重點場館',
                'unique_site_id': '唯一站點ID',
                '高投訴地標性場館': '地標性場館'
            }
        }
    } : {
        basic: {
            title: '基本信息',
            fields: {
                'live_site_id': '站點ID',
                'plan_site_name': '站點名稱',
                'site_type': '站點類型',
                'district_chinese': '行政區',
                'address': '地址'
            }
        },
        technical: {
            title: '技術信息',
            fields: {
                'objective': '目標',
                'coverage_objective_chinese': '覆蓋目標',
                'site_on_air_date': '開通日期',
                'band_info': '頻段信息',
                'power_info': '功率信息'
            }
        },
        location: {
            title: '位置信息',
            fields: {
                'latitude': '緯度',
                'longitude': '經度',
                'height': '高度',
                'building_info': '建築信息'
            }
        },
        network: {
            title: '網絡信息',
            fields: {
                'network_type': '網絡類型',
                'carrier': '運營商',
                'cell_id': '小區ID',
                'pci': 'PCI',
                'earfcn': 'EARFCN'
            }
        }
    };

    return (
        <div className="site-detail-overlay">
            <div className="site-detail-backdrop" 
            onClick={(e) => {
               e.stopPropagation(); // 阻止事件冒泡，避免觸發關閉
            }}>
            </div>
            {p.onlyothers ?
            <div className="site-detail-window" ref={windowRef}>
                    <div className="site-detail-header">
                        <div className="site-detail-title">
                        </div>
                        <button className="site-detail-close" onClick={onClose}>
                            X
                        </button>
                    </div>

                    {/* 窗口內容 */}
                    <div className="site-detail-content">
                        {Object.entries(p)
                            .filter(([key]) => {
                                // 過濾掉已經顯示的字段和特殊字段
                                const allDisplayedFields = Object.values(siteInfo).flatMap(section => 
                                    Object.keys(section.fields)
                                );
                                return !allDisplayedFields.includes(key) && 
                                    key !== 'geom' && 
                                    key !== 'geometry' &&
                                    key !== 'onlyothers';
                            })
                            .map(([key, value]) => {
                                if (value !== undefined && value !== null && value !== '') {
                                    return (
                                        <div key={key} className="site-field-row">
                                            <span className="site-field-label">
                                                {key.replace(/_/g, ' ').toUpperCase()}
                                            </span>
                                            <span className="site-field-value">{formatNumericValue(value)}</span>
                                        </div>
                                    );
                                }
                                return null;
                            })}
                    </div>
                </div>
                : <div className="site-detail-window" ref={windowRef}>
                    {/* Panel Header - Professional Style */}
                    <div className="site-detail-header">
                        <div className="site-detail-title">
                            <div className="site-title-info">
                                <span className="site-name">SITE: {siteTitle}</span>
                                <span className="site-subtitle">TELECOM SITE ANALYSIS</span>
                            </div>
                            <span className="site-type-badge">
                                {isPlanningSite ? 'PLANNING' : 'LIVE'}
                            </span>
                        </div>
                        <button className="site-detail-close" onClick={onClose}>
                            X
                        </button>
                    </div>

                    {/* 窗口內容 */}
                    <div className="site-detail-content">
                        {Object.entries(siteInfo).map(([sectionKey, section]) => (
                            <div key={sectionKey} className="site-detail-section">
                                <h3 className="site-section-title">{section.title}</h3>
                                <div className="site-section-content">
                                    {Object.entries(section.fields).map(([fieldKey, fieldLabel]) => {
                                        const value = p[fieldKey];
                                        // 🚀 NEW: 特殊处理场景信息的布尔值显示
                                        if (sectionKey === 'scenario' && isPlanningSite) {
                                            const isTruthy = (v) => {
                                                if (v === true || v === 1) return true;
                                                if (typeof v === 'string') {
                                                    const s = v.toLowerCase();
                                                    return ['t', 'true', 'y', 'yes', '1'].includes(s);
                                                }
                                                return false;
                                            };
                                            
                                            if (isTruthy(value)) {
                                                return (
                                                    <div key={fieldKey} className="site-field-row scenario-active">
                                                        <span className="site-field-label">{fieldLabel}</span>
                                                        <span className="site-field-value scenario-yes">✓ 是</span>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }
                                        
                                        // 常规字段显示
                                        if (value !== undefined && value !== null && value !== '') {
                                            return (
                                                <div key={fieldKey} className="site-field-row">
                                                    <span className="site-field-label">{fieldLabel}</span>
                                                    <span className="site-field-value">{formatNumericValue(value)}</span>
                                                </div>
                                            );
                                        }
                                        return null;
                                    })}
                                </div>
                            </div>
                        ))}

                        {/* 其他所有屬性 */}
                        <div className="site-detail-section">
                            <h3 className="site-section-title">其他屬性</h3>
                            <div className="site-section-content">
                                {Object.entries(p)
                                    .filter(([key]) => {
                                        // 過濾掉已經顯示的字段和特殊字段
                                        const allDisplayedFields = Object.values(siteInfo).flatMap(section => 
                                            Object.keys(section.fields)
                                        );
                                        return !allDisplayedFields.includes(key) && 
                                            key !== 'geom' && 
                                            key !== 'geometry';
                                    })
                                    .map(([key, value]) => {
                                        if (value !== undefined && value !== null && value !== '') {
                                            return (
                                                <div key={key} className="site-field-row">
                                                    <span className="site-field-label">
                                                        {key.replace(/_/g, ' ').toUpperCase()}
                                                    </span>
                                                    <span className="site-field-value">{formatNumericValue(value)}</span>
                                                </div>
                                            );
                                        }
                                        return null;
                                    })}
                            </div>
                        </div>
                    </div>


                </div>
            }
        </div>
    );
});

// Add display name for debugging
SiteDetailWindow.displayName = 'SiteDetailWindow';

export default SiteDetailWindow;
