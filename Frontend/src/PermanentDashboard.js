import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './PermanentDashboard.css';
import CoverageGaugeGrid from './CoverageGaugeGrid';
import MicroGridRankingCard from './MicroGridRankingCard';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const PermanentDashboard = ({
    position = 'top-right',
    isVisible = false,
    selectedMicroGrids = [],
    showComplaintChart = true,
    isLegendVisible = false
}) => {
    const [activeTab, setActiveTab] = useState('coverage'); // 'coverage', 'vol', 'complaint'
    
    // 🚀 沿用原有的 EXTERNAL_SERVER_URL 配置
    const EXTERNAL_SERVER_URL = 'http://10.250.52.75:3050';

    // 🚀 儀表板數據狀態 - 沿用原有命名規範
    const [dashboardData, setDashboardData] = useState({
        qualityScore: -9999,
        microGridDetail: -9999,
        microGridRanking: -9999,
        totalRanking: -9999,
        districtRanking: -9999,
        trendData: Array(12).fill(-9999),
        radarData: {
            業務感知: -9999,
            網路基礎: -9999,
            網路流程: -9999,
            投訴支撐: -9999,
            競先亮對: -9999
        },
        compareData: {
            value: -9999,
            type: '網格方式比'
        },
        lastUpdated: null,
        dataSource: 'mock',
        selectedRegion: null
    });

    const [volData, setVolData] = useState([]);
    const [isLoadingVol, setIsLoadingVol] = useState(false);

    // 🚀 NEW: 投訴數據狀態管理
    const [complaintData, setComplaintData] = useState([]);
    const [isLoadingComplaint, setIsLoadingComplaint] = useState(false);
    const [errorState, setErrorState] = useState(null);
    const [complaintDataSource, setComplaintDataSource] = useState('general'); // 🚀 NEW: Data source selector

    // 🚀 FIXED: 內聯詳情顯示狀態（不使用獨立彈窗）
    const [selectedDataPoint, setSelectedDataPoint] = useState(null);

    // 🚀 NEW: Vol chart animation state - track if animation has played
    const [volChartAnimated, setVolChartAnimated] = useState(false);

    // 🚀 NEW: 排名數據狀態管理
    const [rankingData, setRankingData] = useState([]);
    const [isLoadingRanking, setIsLoadingRanking] = useState(false);
    
    // 🚀 NEW: 覆蓋率狀態管理
    const [coverageData, setCoverageData] = useState(null);
    const [isLoadingCoverage, setIsLoadingCoverage] = useState(false);

    // 🚀 NEW: 微網格ID到名稱的映射
    const [microGridNameMap, setMicroGridNameMap] = useState({});
    const [isLoadingMicroGrids, setIsLoadingMicroGrids] = useState(false);

    // 🚀 NEW: 獲取微網格名稱映射
    useEffect(() => {
        // Fetch micro grid names once when component mounts or becomes visible
        if (!isVisible || isLoadingMicroGrids || Object.keys(microGridNameMap).length > 0) return;
        
        const fetchMicroGridNames = async () => {
            setIsLoadingMicroGrids(true);
            try {
                const apiUrl = `${EXTERNAL_SERVER_URL}/micro_grids`;
                console.log(`🌐 Fetching micro grid names from: ${apiUrl}`);
                
                const response = await fetch(apiUrl, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache'
                    },
                    signal: AbortSignal.timeout(5000)
                });

                if (response.ok) {
                    const data = await response.json();
                    console.log('📢 Micro grid data received:', data);
                    
                    // Create a mapping from ID to grid_name
                    const nameMap = {};
                    if (data.features && Array.isArray(data.features)) {
                        data.features.forEach(feature => {
                            if (feature.properties) {
                                const id = feature.properties.id;
                                const name = feature.properties.grid_name || feature.properties.name || `Grid ${id}`;
                                nameMap[id] = name;
                            }
                        });
                        setMicroGridNameMap(nameMap);
                        console.log('📢 Micro grid name map created:', nameMap);
                    }
                } else {
                    console.warn(`⚠️ Micro grid API returned ${response.status}`);
                }
            } catch (error) {
                console.error('❌ Error fetching micro grid names:', error);
            } finally {
                setIsLoadingMicroGrids(false);
            }
        };

        fetchMicroGridNames();
    }, [isVisible, isLoadingMicroGrids, microGridNameMap, EXTERNAL_SERVER_URL]);

    // 🚀 NEW: 投訴數據獲取函數
    const fetchVolData = useCallback(async () => {
        if (!isVisible || !showComplaintChart) return;

        setIsLoadingVol(true);

        try {
            const params = new URLSearchParams();

            if (selectedMicroGrids.length === 0) {
                // 沒有選擇微網格，顯示全港數據
                params.set('mode', 'hongkong');
            } else if (selectedMicroGrids.length === 1) {
                // 選擇一個微網格，顯示該微網格的詳細數據
                params.set('mode', 'microgrid');
                const gridId = selectedMicroGrids[0];
                console.log('📢 Single grid ID extracted:', gridId);
                params.set('grid_id', gridId);
            } else {
                // 選擇多個微網格，按月份聚合投訴數據
                params.set('mode', 'selected');
                const gridIds = selectedMicroGrids.join(',');
                console.log('📢 Multiple grid IDs extracted:', gridIds);
                params.set('grid_ids', gridIds);
            }
            const apiUrl = `${EXTERNAL_SERVER_URL}/api/vol-trend?${params.toString()}`;
            console.log(`🌐 Fetching vol data from: ${apiUrl}`);

            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                },
                signal: AbortSignal.timeout(5000)
            });

            if (response.ok) {
                const data = await response.json();
                console.log('📢 Vol data received:', data);

                if (data.success) {
                    setVolData(data.data);
                } else {
                    console.warn('⚠️ Vol API returned unsuccessful response');
                    setVolData([]);
                }
            } else {
                console.warn(`⚠️ Vol API returned ${response.status}`);
                setVolData([]);
            }
        } catch (error) {
            console.error('❌ Error fetching complaint data:', error);
            setVolData([]);
        } finally {
            setIsLoadingVol(false);
        }
    }, [isVisible, selectedMicroGrids, showComplaintChart]);

    // 🚀 NEW: 投訴數據獲取函數
    const fetchComplaintData = useCallback(async () => {
        if (!isVisible || !showComplaintChart) return;

        setIsLoadingComplaint(true);

        try {
            const params = new URLSearchParams();

            if (selectedMicroGrids.length === 0) {
                // 🚀 FIXED: 全港模式 - 顯示聚合的全港投訴總數（單線圖）
                params.set('mode', 'hongkong');
            } else if (selectedMicroGrids.length === 1) {
                // 🚀 FIXED: 單個微網格 - 顯示該微網格的數據（單線圖）
                params.set('mode', 'microgrid');
                const gridId = selectedMicroGrids[0];
                console.log('📢 Single grid ID extracted:', gridId);
                params.set('grid_id', gridId);
            } else {
                // 🚀 FIXED: 多個微網格 - 使用detail_mode獲取各個微網格的獨立數據（多線圖）
                params.set('mode', 'selected');
                const gridIds = selectedMicroGrids.join(',');
                console.log('📢 Multiple grid IDs extracted:', gridIds);
                params.set('grid_ids', gridIds);
                params.set('detail_mode', 'true'); // Request individual grid data for multi-line chart
            }
            
            // 🚀 NEW: Add data_source parameter
            params.set('data_source', complaintDataSource);
            
            const apiUrl = `${EXTERNAL_SERVER_URL}/api/complaint-trend?${params.toString()}`;
            console.log(`🌐 Fetching complaint data from: ${apiUrl} (data_source: ${complaintDataSource})`);

            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                },
                signal: AbortSignal.timeout(5000)
            });

            if (response.ok) {
                const data = await response.json();
                console.log('📢 Complaint data received:', data);

                if (data.success) {
                    setComplaintData(data.data);
                } else {
                    console.warn('⚠️ Complaint API returned unsuccessful response');
                    setComplaintData([]);
                }
            } else {
                console.warn(`⚠️ Complaint API returned ${response.status}`);
                setComplaintData([]);
            }
        } catch (error) {
            console.error('❌ Error fetching complaint data:', error);
            setComplaintData([]);
        } finally {
            setIsLoadingComplaint(false);
        }
    }, [isVisible, selectedMicroGrids, showComplaintChart, complaintDataSource]);

    // 🚀 NEW: 排名數據獲取函數
    const fetchRankingData = useCallback(async () => {
        if (!isVisible) return;
        
        setIsLoadingRanking(true);
        try {
            const apiUrl = `${EXTERNAL_SERVER_URL}/api/micro_grid_rankings`;
            console.log(`🌐 Fetching ranking data from: ${apiUrl}`);

            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                },
                signal: AbortSignal.timeout(5000)
            });

            if (response.ok) {
                const data = await response.json();
                console.log('📢 Ranking data received:', data);
                if (data.success && data.data && Array.isArray(data.data)) {
                    setRankingData(data.data);
                } else {
                    console.warn('⚠️ Ranking API returned unsuccessful response or invalid data structure');
                    setRankingData([]);
                }
            } else {
                console.warn(`⚠️ Ranking API returned ${response.status}`);
                setRankingData([]);
            }
        } catch (error) {
            console.error('❌ Error fetching ranking data:', error);
            setErrorState({
                type: error.name === 'AbortError' ? 'timeout' : 'network',
                message: error.name === 'AbortError' ? '請求超時，無法獲取排名數據。' : '無法連接到服務器，請檢查網絡。'
            });
            setRankingData([]);
        } finally {
            setIsLoadingRanking(false);
        }
    }, [isVisible, EXTERNAL_SERVER_URL]);

    // 🚀 NEW: 覆蓋率獲取函數
    const fetchCoverageData = useCallback(async () => {
        if (!isVisible) return;
        
        setIsLoadingCoverage(true);
        try {
            const apiUrl = `${EXTERNAL_SERVER_URL}/api/whole_coverage`;
            console.log(`🌐 Fetching coverage data from: ${apiUrl}`);
            
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                },
                signal: AbortSignal.timeout(5000)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('📢 Coverage data received:', result);
                
                if (result.success && result.data) {
                    setCoverageData(result.data);
                } else {
                    console.warn('⚠️ Coverage API returned unsuccessful response');
                    setCoverageData(null);
                }
            } else {
                console.warn(`⚠️ Coverage API returned ${response.status}`);
                setCoverageData(null);
            }
        } catch (error) {
            console.error('❌ Error fetching coverage data:', error);
            setErrorState({
                type: error.name === 'AbortError' ? 'timeout' : 'network',
                message: error.name === 'AbortError' ? '請求超時，無法獲取覆蓋率數據。' : '無法連接到服務器，請檢查網絡。'
            });
            setCoverageData(null);
        } finally {
            setIsLoadingCoverage(false);
        }
    }, [isVisible, EXTERNAL_SERVER_URL]);

    // 🚀 NEW: 輔助函數 - 將微網格ID轉換為名稱
    const getMicroGridName = useCallback((gridId) => {
        return microGridNameMap[gridId] || `Grid ${gridId}`;
    }, [microGridNameMap]);

    // 🚀 NEW: 輔助函數 - 獲取所選微網格的名稱列表
    const getSelectedMicroGridNames = useCallback(() => {
        return selectedMicroGrids.map(id => getMicroGridName(id));
    }, [selectedMicroGrids, getMicroGridName]);

    // 🚀 FIXED: 處理折線圖點擊事件 - 內聯顯示詳情
    const handleDataPointClick = useCallback((dataPoint) => {
        console.log('📢 Data point clicked:', dataPoint);
        setSelectedDataPoint(dataPoint);
    }, []);

    // 🚀 FIXED: 將投訴數據轉換為Recharts LineChart格式
    const transformComplaintDataForChart = useMemo(() => {
        if (!complaintData || complaintData.length === 0) return [];

        console.log('📊 Transforming complaint data:', complaintData);

        // Check aggregation type or detect data structure
        const firstItem = complaintData[0];

        // Hong Kong or single grid mode - data already has month and count/total_count
        if (firstItem.aggregation_type === 'single' || firstItem.total_count !== undefined) {
            console.log('✅ Hong Kong or single grid mode - data format OK');
            return complaintData.map(item => ({
                month: item.month,
                month_raw: item.month_raw,
                全港投訴: item.total_count || item.count // Use "全港投訴" as series name
            }));
        }

        // Multi-grid detail mode - need to group by month
        if (firstItem.aggregation_type === 'multiple_detail' ||
            (firstItem.grid_name && firstItem.count !== undefined && selectedMicroGrids.length > 1)) {
            console.log('✅ Multi-grid detail mode - transforming to chart format');

            const monthMap = new Map();

            complaintData.forEach(item => {
                const month = item.month_raw || item.month;
                if (!monthMap.has(month)) {
                    monthMap.set(month, {
                        month: item.month,
                        month_raw: month,
                        grid_details: []
                    });
                }

                const monthData = monthMap.get(month);
                monthData[item.grid_name] = item.count; // Set grid name as key for Recharts
                monthData.grid_details.push({
                    grid_name: item.grid_name,
                    count: item.count,
                    micro_grid_id: item.micro_grid_id
                });
            });

            const result = Array.from(monthMap.values());
            console.log('📊 Transformed chart data:', result);
            return result;
        }

        // Single grid mode - transform to have grid name as key
        console.log('✅ Single grid mode - transforming');
        return complaintData.map(item => ({
            month: item.month,
            month_raw: item.month_raw,
            [item.grid_name || '微網格']: item.count
        }));
    }, [complaintData, selectedMicroGrids]);

    // 🚀 FIXED: 提取唯一的微網格名稱或系列名稱（用於多線圖）
    const lineSeriesNames = useMemo(() => {
        if (!transformComplaintDataForChart || transformComplaintDataForChart.length === 0) return [];

        const firstDataPoint = transformComplaintDataForChart[0];
        const names = Object.keys(firstDataPoint).filter(key =>
            key !== 'month' && key !== 'month_raw' && key !== 'grid_details'
        );

        console.log('📊 Line series names extracted:', names);
        return names.sort();
    }, [transformComplaintDataForChart]);

    // 🚀 NEW: 冷色調色板（用於堆疊柱狀圖，專業且視覺舒適）
    const chartColorPalette = [
        '#42A5F5', // Bright Blue (亮藍)
        '#26C6DA', // Cyan (青色)
        '#66BB6A', // Soft Green (柔和綠)
        '#AB47BC', // Purple (紫色)
        '#5C6BC0', // Indigo (靛藍)
        '#26A69A', // Teal (藍綠)
        '#29B6F6', // Light Blue (淺藍)
        '#7E57C2', // Deep Purple (深紫)
        '#4DD0E1', // Light Cyan (淺青)
        '#78909C'  // Blue Grey (藍灰)
    ];

    // 🚀 NEW: 處理排名卡片點擊事件 - 實現 drill-down 功能
    const handleRankingCardClick = useCallback((gridItem) => {
        console.log('📢 Ranking card clicked:', gridItem);
        // TODO: This could trigger map zoom or open GridDetailPanel
        // For now, show detailed information in an alert
        const message = `
微網格: ${gridItem.grid_name} ${gridItem.grid_name_eng ? `(${gridItem.grid_name_eng})` : ''}
區域: ${gridItem.district}
競爭狀態: ${gridItem.comp_lead_behind} ${Math.abs(gridItem.comp_lead_behind_percent).toFixed(2)}%

競爭分析:
- 競強我強: ${gridItem.comp_strong_we_strong.toFixed(1)}%
- 競強我弱: ${gridItem.comp_strong_we_weak.toFixed(1)}%
- 競弱我強: ${gridItem.comp_weak_we_strong.toFixed(1)}%
- 競弱我弱: ${gridItem.comp_weak_we_weak.toFixed(1)}%
        `.trim();

        alert(message);

        // Future enhancement: Emit event to parent component (TelecomMap)
        // to zoom to grid location or open detail panel
        // Example: if (onGridSelect) onGridSelect(gridItem);
    }, []);

    // 🚀 NEW: 生命週期管理
    useEffect(() => {
        fetchVolData();
    }, [fetchVolData]);

    // 🚀 NEW: Reset animation state when volData changes or when switching to vol tab
    useEffect(() => {
        if (activeTab === 'vol' && volData.length > 0) {
            setVolChartAnimated(false);
            // Trigger animation after a short delay
            const timer = setTimeout(() => setVolChartAnimated(true), 100);
            return () => clearTimeout(timer);
        }
    }, [volData, activeTab]);

    useEffect(() => {
        fetchComplaintData();
    }, [fetchComplaintData]);

    useEffect(() => {
        fetchRankingData();
    }, [fetchRankingData]);

    useEffect(() => {
        fetchCoverageData();
    }, [fetchCoverageData]);

    // 🚀 沿用原有的錯誤處理組件
    const dismissError = useCallback(() => {
        setErrorState(null);
    }, []);

    // 🚀 NEW: 處理排名數據，篩選領先和落後的前十名
    const { top10Leading, top10Lagging } = useMemo(() => {
        const leadingGrids = [];
        const laggingGrids = [];

        if (rankingData && rankingData.length > 0) {
            rankingData.forEach(item => {
                const parsedPercent = parseFloat(item.comp_lead_behind_percent);
                if (!isNaN(parsedPercent) && item.comp_lead_behind) {
                    const rankingEntry = {
                        grid_name: item.grid_name,
                        grid_name_eng: item.grid_name_eng,
                        district: item.district,
                        comp_lead_behind: item.comp_lead_behind,
                        comp_lead_behind_percent: parsedPercent,
                        comp_weak_we_weak: item.comp_weak_we_weak || 0,
                        comp_weak_we_strong: item.comp_weak_we_strong || 0,
                        comp_strong_we_weak: item.comp_strong_we_weak || 0,
                        comp_strong_we_strong: item.comp_strong_we_strong || 0
                    };

                    if (item.comp_lead_behind === '領先') {
                        leadingGrids.push(rankingEntry);
                    } else if (item.comp_lead_behind === '落後') {
                        laggingGrids.push(rankingEntry);
                    }
                }
            });
        }

        // 領先：按百分比降序排序，取前十名
        leadingGrids.sort((a, b) => b.comp_lead_behind_percent - a.comp_lead_behind_percent);
        const top10Leading = leadingGrids.slice(0, 10);

        // 落後：按百分比升序排序 (負數越小越落後)，取前十名
        laggingGrids.sort((a, b) => a.comp_lead_behind_percent - b.comp_lead_behind_percent);
        const top10Lagging = laggingGrids.slice(0, 10);

        return { top10Leading, top10Lagging };
    }, [rankingData]);

    if (!isVisible) return null;

    return (
        <div className={`permanent-dashboard ${position} ${!isLegendVisible ? 'legend-hidden' : ''}`}>
            <div className="dashboard-tabs">
                <button
                    className={`tab-button ${activeTab === 'coverage' ? 'active' : ''}`}
                    onClick={() => setActiveTab('coverage')}
                >
                    覆蓋率
                </button>
                <button
                    className={`tab-button ${activeTab === 'vol' ? 'active' : ''}`}
                    onClick={() => setActiveTab('vol')}
                >
                    話統數據
                </button>
                <button
                    className={`tab-button ${activeTab === 'complaint' ? 'active' : ''}`}
                    onClick={() => setActiveTab('complaint')}
                >
                    投訴
                </button>
            </div>

            {/* 覆蓋率標籤頁 - 合併了領先和落後內容 */}
            {activeTab === 'coverage' && (
                <div className="tab-content">
                    {/* 全港覆蓋率比較 - 使用新的 Gauge Grid 組件 */}
                    <h4>全港覆蓋率比較</h4>
                    {isLoadingCoverage ? (
                        <div className="loading-state">載入中...</div>
                    ) : coverageData ? (
                        <>
                            <CoverageGaugeGrid data={coverageData} />
                            {/* Coverage Color Legend */}
                            <div className="coverage-legend">
                                <div className="legend-title">覆蓋率色彩說明</div>
                                <div className="legend-items">
                                    <div className="legend-item-inline">
                                        <span className="legend-color-box excellent"></span>
                                        <span className="legend-label">{'優秀 (≥90%)'}</span>
                                    </div>
                                    <div className="legend-item-inline">
                                        <span className="legend-color-box good"></span>
                                        <span className="legend-label">良好 (80-90%)</span>
                                    </div>
                                    <div className="legend-item-inline">
                                        <span className="legend-color-box fair"></span>
                                        <span className="legend-label">一般 (70-80%)</span>
                                    </div>
                                    <div className="legend-item-inline">
                                        <span className="legend-color-box poor"></span>
                                        <span className="legend-label">{'較弱 (<70%)'}</span>
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="no-data-state">暫無覆蓋率數據</div>
                    )}

                    {/* Competition Metrics Legend - Placed before rankings */}
                    <div className="competition-legend" style={{ marginTop: '24px' }}>
                        <div className="legend-title">競爭分析圖表說明</div>
                        <div className="competition-legend-grid">
                            <div className="competition-legend-item">
                                <span className="competition-color-box both-strong"></span>
                                <div className="competition-legend-text">
                                    <span className="competition-legend-label">競強我強</span>
                                    <span className="competition-legend-desc">雙方均強</span>
                                </div>
                            </div>
                            <div className="competition-legend-item">
                                <span className="competition-color-box we-lead"></span>
                                <div className="competition-legend-text">
                                    <span className="competition-legend-label">競弱我強</span>
                                    <span className="competition-legend-desc">我方領先</span>
                                </div>
                            </div>
                            <div className="competition-legend-item">
                                <span className="competition-color-box need-improvement"></span>
                                <div className="competition-legend-text">
                                    <span className="competition-legend-label">競強我弱</span>
                                    <span className="competition-legend-desc">需要改善</span>
                                </div>
                            </div>
                            <div className="competition-legend-item">
                                <span className="competition-color-box both-weak"></span>
                                <div className="competition-legend-text">
                                    <span className="competition-legend-label">競弱我弱</span>
                                    <span className="competition-legend-desc">雙方均弱</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 領先微網格排名 */}
                    <div style={{ marginTop: '24px' }}>
                        {coverageData?.leading_percentage !== null && coverageData?.leading_percentage !== undefined && (
                            <h5 className="hk-leading-rate">
                                全港領先率：{coverageData.leading_percentage.toFixed(2)}%
                            </h5>
                        )}
                        <h4>領先微網格排名 (Top 10)</h4>
                        {isLoadingRanking ? (
                            <div className="loading-state">載入中...</div>
                        ) : top10Leading.length > 0 ? (
                            <div className="ranking-cards-container">
                                {top10Leading.map((item, index) => (
                                    <MicroGridRankingCard
                                        key={item.grid_name || index}
                                        item={item}
                                        rank={index + 1}
                                        isLeading={true}
                                        onClick={handleRankingCardClick}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="no-data-state">暫無領先微網格數據</div>
                        )}
                    </div>

                    {/* 落後微網格排名 */}
                    <div style={{ marginTop: '24px' }}>
                        <h4>落後微網格排名 (Top 10)</h4>
                        {isLoadingRanking ? (
                            <div className="loading-state">載入中...</div>
                        ) : top10Lagging.length > 0 ? (
                            <div className="ranking-cards-container">
                                {top10Lagging.map((item, index) => (
                                    <MicroGridRankingCard
                                        key={item.grid_name || index}
                                        item={item}
                                        rank={index + 1}
                                        isLeading={false}
                                        onClick={handleRankingCardClick}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="no-data-state">暫無落後微網格數據</div>
                        )}
                    </div>
                </div>
            )}

            {/* 話統數據條形圖區域 */}
            {activeTab === 'vol' && showComplaintChart && (
                <div className="complaint-chart">
                    <div className="chart-header">
                        <h3>
                            {selectedMicroGrids.length === 0 ?
                                '全港話統5G分流比(%)趨勢' :
                                selectedMicroGrids.length === 1 ?
                                    `微網格 ${getMicroGridName(selectedMicroGrids[0])} 話統5G分流比(%)趨勢` :
                                    `所選${selectedMicroGrids.length}個微網格話統5G分流比(%)趨勢`
                            }
                        </h3>
                        <div className="chart-info">
                            {selectedMicroGrids.length > 1 && (
                                <span className="grid-count">
                                    {getSelectedMicroGridNames().join(', ')}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="bar-chart-container">
                        {isLoadingVol ? (
                            <div className="loading-state">載入中...</div>
                        ) : volData.length > 0 ? (
                            <svg width="100%" height="130" viewBox="0 0 400 130">
                                <defs>
                                    {/* Light blue gradient for line chart */}
                                    <linearGradient id="volLineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                        <stop offset="0%" stopColor="#64B5F6" stopOpacity="0.3" />
                                        <stop offset="100%" stopColor="#64B5F6" stopOpacity="0.05" />
                                    </linearGradient>
                                </defs>

                                {/* 繪製折線圖 */}
                                {(() => {
                                    const maxValue = Math.max(...volData.map(d => d.nr_lte_ratio));
                                    const minValue = Math.min(...volData.map(d => d.nr_lte_ratio)) - 1;
                                    const spacing = 360 / Math.max(volData.length - 1, 1);
                                    const startX = 20;

                                    // 生成折線路徑和區域填充路徑
                                    let linePath = '';
                                    let areaPath = '';

                                    volData.forEach((item, index) => {
                                        const value = item.nr_lte_ratio;
                                        const normalizedHeight = (value - minValue) / (maxValue - minValue) * 85;
                                        const x = startX + index * spacing;
                                        const y = 95 - normalizedHeight;

                                        if (index === 0) {
                                            linePath = `M ${x} ${y}`;
                                            areaPath = `M ${x} 95 L ${x} ${y}`;
                                        } else {
                                            linePath += ` L ${x} ${y}`;
                                            areaPath += ` L ${x} ${y}`;
                                        }
                                    });

                                    // 完成區域填充路徑
                                    const lastX = startX + (volData.length - 1) * spacing;
                                    areaPath += ` L ${lastX} 95 Z`;

                                    return (
                                        <>
                                            {/* 填充區域 */}
                                            <path
                                                d={areaPath}
                                                fill="url(#volLineGradient)"
                                                stroke="none"
                                                style={{
                                                    opacity: volChartAnimated ? 0.6 : 0,
                                                    transition: 'opacity 1.5s ease-out'
                                                }}
                                            />

                                            {/* 折線 */}
                                            <path
                                                d={linePath}
                                                fill="none"
                                                stroke="#64B5F6"
                                                strokeWidth="2.5"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                style={{
                                                    strokeDasharray: '1000',
                                                    strokeDashoffset: volChartAnimated ? '0' : '1000',
                                                    transition: 'stroke-dashoffset 1.5s ease-out'
                                                }}
                                            />

                                            {/* 數據點和標籤 */}
                                            {volData.map((item, index) => {
                                                const value = item.nr_lte_ratio;
                                                const normalizedHeight = (value - minValue) / (maxValue - minValue) * 85;
                                                const x = startX + index * spacing;
                                                const y = 95 - normalizedHeight;

                                                return (
                                                    <g key={index} style={{
                                                        opacity: volChartAnimated ? 1 : 0,
                                                        transition: `opacity 0.5s ease-out ${0.8 + index * 0.1}s`
                                                    }}>
                                                        {/* 數據點圓圈 */}
                                                        <circle
                                                            cx={x}
                                                            cy={y}
                                                            r="4"
                                                            fill="#64B5F6"
                                                            stroke="white"
                                                            strokeWidth="2"
                                                            style={{ cursor: 'pointer' }}
                                                        />

                                                        {/* 數值標籤 */}
                                                        <text
                                                            x={x}
                                                            y={Math.max(y - 12, 10)}
                                                            textAnchor="middle"
                                                            fontSize="10"
                                                            fontWeight="bold"
                                                            fontFamily="'Microsoft YaHei', 'Arial', sans-serif"
                                                            fill="white"
                                                            stroke="rgba(0,0,0,0.5)"
                                                            strokeWidth="0.8"
                                                            paintOrder="stroke fill"
                                                        >
                                                            {value}
                                                        </text>

                                                        {/* 月份標籤 */}
                                                        <text
                                                            x={x}
                                                            y={118}
                                                            textAnchor="middle"
                                                            fontSize="10"
                                                            fontWeight="bold"
                                                            fontFamily="'Microsoft YaHei', 'Arial', sans-serif"
                                                            fill="white"
                                                            stroke="rgba(0,0,0,0.5)"
                                                            strokeWidth="0.8"
                                                            paintOrder="stroke fill"
                                                            transform={`rotate(-45, ${x}, 118)`}
                                                        >
                                                            {item.month_raw || item.month}
                                                        </text>
                                                    </g>
                                                );
                                            })}
                                        </>
                                    );
                                })()}

                                {/* Y軸 */}
                                <line x1="15" y1="10" x2="15" y2="95" stroke="#ccc" strokeWidth="1" />
                                {/* X軸 */}
                                <line x1="15" y1="95" x2="385" y2="95" stroke="#ccc" strokeWidth="1" />
                            </svg>
                        ) : (
                            <div className="no-data-state">
                                {selectedMicroGrids.length === 0 ?
                                    '暫無話統5G分流比數據' :
                                    '所選微網格暫無話統5G分流比數據'
                                }
                            </div>
                        )}
                    </div>

                    <div className="chart-legend">
                        <span className="legend-item">
                            <span className="legend-color vol-color"></span>
                            {selectedMicroGrids.length === 0 ?
                                '全港話統5G分流比(%)' :
                                selectedMicroGrids.length === 1 ?
                                    '微網格話統5G分流比(%)' :
                                    '所選微網格話統5G分流比(%)'
                            }
                        </span>
                    </div>
                </div>
            )}

            {/* 🚀 FIXED: 投訴數據可視化區域 - 多網格使用線圖，單網格使用條形圖 */}
            {activeTab === 'complaint' && showComplaintChart && (
                <div className="complaint-chart">
                    <div className="chart-header">
                        <div className="chart-title-row">
                            <h3>
                                {selectedMicroGrids.length === 0 ?
                                    '全港投訴數量趨勢' :
                                    selectedMicroGrids.length === 1 ?
                                        `微網格 ${getMicroGridName(selectedMicroGrids[0])} 投訴趨勢` :
                                        `所選${selectedMicroGrids.length}個微網格投訴趨勢`
                                }
                            </h3>
                            <select 
                                value={complaintDataSource} 
                                onChange={(e) => setComplaintDataSource(e.target.value)}
                                className="data-source-selector"
                            >
                                <option value="general">總投訴數據</option>
                                <option value="weak_coverage">弱覆蓋投訴數據</option>
                            </select>
                        </div>
                        <div className="chart-info">
                            {selectedMicroGrids.length > 1 && lineSeriesNames.length > 0 && (
                                <span className="grid-count-multiline">
                                    比較 {lineSeriesNames.length} 個微網格的投訴趨勢
                                </span>
                            )}
                        </div>
                    </div>

                    {/* 🚀 FIXED: 投訴數據使用堆疊柱狀圖（Stacked Bar Chart）展示多個微網格數據 */}
                    <div className="chart-container-modern">
                        {isLoadingComplaint ? (
                            <div className="loading-state">載入中...</div>
                        ) : transformComplaintDataForChart.length > 0 && lineSeriesNames.length > 0 ? (
                            <ResponsiveContainer width="100%" height={360}>
                                <BarChart
                                    data={transformComplaintDataForChart}
                                    margin={{ top: 20, right: 40, left: 20, bottom: 70 }}
                                    barGap={4}
                                    barCategoryGap="20%"
                                >
                                    <defs>
                                        {/* Add gradient definitions for each color */}
                                        {chartColorPalette.map((color, idx) => (
                                            <linearGradient key={`gradient-${idx}`} id={`barGradient${idx}`} x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor={color} stopOpacity={0.95} />
                                                <stop offset="100%" stopColor={color} stopOpacity={0.75} />
                                            </linearGradient>
                                        ))}
                                    </defs>
                                    <CartesianGrid
                                        strokeDasharray="3 3"
                                        stroke="rgba(100,181,246,0.15)"
                                        vertical={false}
                                    />
                                    <XAxis
                                        dataKey="month"
                                        stroke="rgba(100,181,246,0.5)"
                                        angle={-45}
                                        textAnchor="end"
                                        height={80}
                                        tick={{ fill: 'rgba(200,220,240,0.9)', fontSize: 11, fontWeight: 500 }}
                                        tickLine={{ stroke: 'rgba(100,181,246,0.3)' }}
                                    />
                                    <YAxis
                                        stroke="rgba(100,181,246,0.5)"
                                        tick={{ fill: 'rgba(200,220,240,0.9)', fontSize: 11, fontWeight: 500 }}
                                        tickLine={{ stroke: 'rgba(100,181,246,0.3)' }}
                                        label={{
                                            value: '投訴數量',
                                            angle: -90,
                                            position: 'insideLeft',
                                            fill: 'rgba(200,220,240,0.9)',
                                            style: { fontWeight: 600 }
                                        }}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'rgba(15,23,42,0.95)',
                                            border: '1.5px solid rgba(100,181,246,0.4)',
                                            borderRadius: '10px',
                                            color: 'white',
                                            padding: '12px',
                                            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                                            backdropFilter: 'blur(10px)'
                                        }}
                                        cursor={{ fill: 'rgba(100,181,246,0.08)', radius: 4 }}
                                        labelStyle={{ color: '#42A5F5', fontWeight: 600, marginBottom: '8px' }}
                                    />
                                    <Legend
                                        wrapperStyle={{
                                            paddingTop: '24px',
                                            fontSize: '12px'
                                        }}
                                        iconType="circle"
                                        iconSize={10}
                                    />
                                    {lineSeriesNames.map((seriesName, index) => (
                                        <Bar
                                            key={seriesName}
                                            dataKey={seriesName}
                                            name={seriesName}
                                            stackId="complaint"
                                            fill={`url(#barGradient${index % chartColorPalette.length})`}
                                            onClick={(data) => handleDataPointClick(data)}
                                            cursor="pointer"
                                            animationDuration={1200}
                                            animationEasing="ease-out"
                                            isAnimationActive={true}
                                            radius={[
                                                index === lineSeriesNames.length - 1 ? 6 : 0,
                                                index === lineSeriesNames.length - 1 ? 6 : 0,
                                                0,
                                                0
                                            ]}
                                        />
                                    ))}
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="no-data-state">
                                {selectedMicroGrids.length === 0 ?
                                    '暫無投訴數據' :
                                    '所選微網格暫無投訴數據'
                                }
                            </div>
                        )}
                    </div>

                    {/* 🚀 FIXED: 內聯顯示選中數據點的詳情（取代彈窗） */}
                    {selectedDataPoint && (
                        <div className="inline-detail-display">
                            <div className="inline-detail-header">
                                <span className="inline-detail-title">📊 {selectedDataPoint.month || '未知月份'}</span>
                                <button className="inline-detail-close" onClick={() => setSelectedDataPoint(null)}>✕</button>
                            </div>
                            <div className="inline-detail-content">
                                {lineSeriesNames.map(seriesName => {
                                    const value = selectedDataPoint[seriesName];
                                    if (value !== undefined && value !== null) {
                                        return (
                                            <div key={seriesName} className="inline-detail-item">
                                                <span className="inline-detail-label">{seriesName}:</span>
                                                <span className="inline-detail-value">{value} 個投訴</span>
                                            </div>
                                        );
                                    }
                                    return null;
                                })}
                                {selectedDataPoint.grid_details && selectedDataPoint.grid_details.length > 0 && (
                                    <div className="inline-detail-summary">
                                        <span className="inline-detail-summary-label">總數:</span>
                                        <span className="inline-detail-summary-value">
                                            {selectedDataPoint.grid_details.reduce((sum, g) => sum + g.count, 0)} 個投訴
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 🚀 FIXED: 更新圖例說明 */}
                    <div className="chart-legend-modern">
                        <span className="legend-note-modern">
                            點擊柱狀圖查看詳細信息{selectedMicroGrids.length > 1 ? ' • 每個顏色段代表不同微網格的投訴數量' : ''}
                        </span>
                    </div>
                </div>
            )}

            {/* 🚀 沿用原有的錯誤提示風格 */}
            {errorState && (
                <div className="dashboard-error">
                    <span className="error-icon">
                        {errorState.type === 'network' ? '🌐' :
                            errorState.type === 'timeout' ? '⏱️' :
                                errorState.type === 'security' ? '🔒' : '⚠️'}
                    </span>
                    <span className="error-message">{errorState.message}</span>
                    <button className="error-dismiss" onClick={dismissError}>✕</button>
                </div>
            )}

            {/* 區域選擇提示 */}
            {dashboardData.selectedRegion && (
                <div className="region-indicator">
                    <span className="region-icon">📍</span>
                    <span className="region-text">{dashboardData.selectedRegion}</span>
                </div>
            )}
        </div>
    );
};

export default PermanentDashboard;
