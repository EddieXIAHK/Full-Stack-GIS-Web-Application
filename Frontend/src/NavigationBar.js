// NavigationBar.js
import React, { useState, useRef, useEffect } from 'react';
import './NavigationBar.css';
import { FaMapMarkedAlt, FaLayerGroup, FaTrash, FaSatelliteDish, FaMap, FaGlobe, FaBullseye, FaChartBar, FaDatabase, FaCaretDown } from 'react-icons/fa';
import CMHKIcon from './providerIcon/CMHKIcon.png';

// 🚀 PERFORMANCE FIX: Memoize component to prevent unnecessary re-renders
const NavigationBar = React.memo(({
    removeAllLayers,
    toggleVisibility,
    toggleDistrictVisibility,
    toggleOtherVisibility,
    toggleBasemap,
    toggleRenderingMode,
    toggleComplaintChart,
    currentBasemap = 'osm',
    renderingMode = 'global',
    isOtherDataDisabled = false,
    isSixDimensionDataDisabled = false,
    complaintChartVisible = false,
    isDashboardVisible = false,
}) => {
    // Dropdown state management
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsDropdownOpen(false);
            }
        };

        if (isDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isDropdownOpen]);

    // Toggle dropdown
    const handleDropdownToggle = () => {
        setIsDropdownOpen(!isDropdownOpen);
    };

    // Handle dropdown item click
    const handleDropdownItemClick = (callback) => {
        callback();
        setIsDropdownOpen(false);
    };

    return (
        <>
            <nav className="navbar">
                {/* Left section */}
                <div className="navbar-left">
                    <button
                        className="navbar-button"
                        onClick={toggleDistrictVisibility}
                        title="選擇行政區域進行數據篩選"
                    >
                        <FaMapMarkedAlt className="navbar-icon" />
                        微網格選擇
                    </button>

                    {/* Dropdown menu for data selection */}
                    <div className="navbar-dropdown" ref={dropdownRef}>
                        <button
                            className="navbar-button"
                            onClick={handleDropdownToggle}
                            title="選擇數據類型"
                        >
                            <FaDatabase className="navbar-icon" />
                            選擇數據
                            <FaCaretDown className={`navbar-dropdown-arrow ${isDropdownOpen ? 'open' : ''}`} />
                        </button>

                        {isDropdownOpen && (
                            <div className="navbar-dropdown-menu">
                                <button
                                    className={`navbar-dropdown-item ${isSixDimensionDataDisabled ? 'navbar-dropdown-item-disabled' : ''}`}
                                    onClick={() => handleDropdownItemClick(toggleVisibility)}
                                    disabled={isSixDimensionDataDisabled}
                                    title={isSixDimensionDataDisabled ? '已選擇測試數據，無法選擇六維數據' : '六維網格數據分析（1.投訴、2.MR競對、3.仿真、4.話筒、5.站點結構、6.測試數據）'}
                                >
                                    <FaLayerGroup className="navbar-dropdown-icon" />
                                    <span>六維數據</span>
                                    {isSixDimensionDataDisabled && <span className="disabled-indicator">🚫</span>}
                                </button>
                                <button
                                    className={`navbar-dropdown-item ${isOtherDataDisabled ? 'navbar-dropdown-item-disabled' : ''}`}
                                    onClick={() => handleDropdownItemClick(toggleOtherVisibility)}
                                    disabled={isOtherDataDisabled}
                                    title={isOtherDataDisabled ? '已選擇六維數據，無法選擇其他測試數據' : '其他營運商測試數據'}
                                >
                                    <FaSatelliteDish className="navbar-dropdown-icon" />
                                    <span>其他測試數據</span>
                                    {isOtherDataDisabled && <span className="disabled-indicator">🚫</span>}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Center section - PROMINENT RAISED BRANDING */}
                <div className="navbar-center-raised">
                    <div className="navbar-brand">
                        <img src={CMHKIcon} alt="CMHK Logo" className="navbar-logo" />
                        <span className="navbar-brand-text">无线中心微网格优化管理</span>
                    </div>
                </div>

                {/* Right section */}
                <div className="navbar-right">
                    <button
                        className={`navbar-button ${renderingMode === 'spatial' ? 'navbar-button-active' : ''}`}
                        onClick={toggleRenderingMode}
                        title={renderingMode === 'global' ? '切換到區域渲染模式 - 僅渲染選定行政區和微網格內的六維數據' : '切換到全局渲染模式 - 全域渲染六維數據'}
                    >
                        {renderingMode === 'global' ? <FaGlobe className="navbar-icon" /> : <FaBullseye className="navbar-icon" />}
                        {renderingMode === 'global' ? '全域模式' : '區域模式'}
                    </button>

                    <button
                        className={`navbar-button ${complaintChartVisible && isDashboardVisible ? 'navbar-button-active' : ''}`}
                        onClick={toggleComplaintChart}
                        title={isDashboardVisible ? '隱藏投訴數據儀表板' : '顯示投訴數據儀表板'}
                    >
                        <FaChartBar className="navbar-icon" />
                        微網格分析
                    </button>

                    <button
                        className="navbar-button"
                        onClick={toggleBasemap}
                        title={`切換地圖 (當前: ${currentBasemap === 'osm' ? 'OpenStreetMap' : currentBasemap === 'carto' ? 'Carto' : '本地香港地圖'})`}
                    >
                        <FaMap className="navbar-icon" />
                        連接地圖
                    </button>

                    <button
                        className="navbar-button danger"
                        onClick={removeAllLayers}
                        title="清除所有圖層和選擇"
                    >
                        <FaTrash className="navbar-icon" />
                        清除
                    </button>
                </div>
            </nav>
        </>
    );
});

// Add display name for debugging
NavigationBar.displayName = 'NavigationBar';

export default NavigationBar;
