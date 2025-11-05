// DistrictMicroGridSelection.js
// Micro grid selection component with client-side district grouping - displays micro grids grouped by district
import React, { useState, useRef, useEffect } from 'react';
import { FaChevronDown, FaChevronUp, FaLayerGroup } from 'react-icons/fa';
import './SelectionList.css';
import './DistrictMicroGridSelection.css';
import L from 'leaflet';

const EXTERNAL_SERVER_URL = 'http://10.250.52.75:3050';

const DistrictMicroGridSelection = ({
    selectedMicroGrids = [],
    setSelectedMicroGrids,
    onClose,
}) => {
    const [microGrids, setMicroGrids] = useState([]);
    const [openDistricts, setOpenDistricts] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [justOpened, setJustOpened] = useState(true);
    const containerRef = useRef(null);

    // Stop map interaction when hovering over this component
    useEffect(() => {
        if (containerRef.current) {
            L.DomEvent.disableScrollPropagation(containerRef.current);
            L.DomEvent.disableClickPropagation(containerRef.current);
        }
    }, []);

    // Fetch micro grids on component mount
    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);

                // Fetch district-microgrid mapping (which now contains all micro grids grouped by district)
                const mappingRes = await fetch(`${EXTERNAL_SERVER_URL}/districts_with_microgrids`);
                if (!mappingRes.ok) throw new Error('Failed to fetch district-microgrid mapping');
                const mappingData = await mappingRes.json();

                // Flatten all micro grids from all districts into a single array
                const allMicroGrids = [];
                mappingData.districts.forEach(district => {
                    district.microgrids.forEach(microGrid => {
                        allMicroGrids.push({
                            ...microGrid,
                            district: district.district_name // Add district info for display
                        });
                    });
                });

                setMicroGrids(allMicroGrids);
                setLoading(false);
            } catch (err) {
                console.error('Error fetching micro grid data:', err);
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    // Manage just opened state to prevent immediate closing
    useEffect(() => {
        const timer = setTimeout(() => {
            setJustOpened(false);
        }, 100);
        return () => clearTimeout(timer);
    }, []);

    // Handle outside click to close
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (justOpened) return;
            
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                const clickedElement = e.target;
                const navbarButton = clickedElement.closest('.navbar-button');
                
                if (navbarButton) return;
                
                onClose();
            }
        };

        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 50);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose, justOpened]);




    // Handle micro grid selection
    const handleMicroGridSelect = (microGridId, isChecked) => {
        let updatedMicroGrids;
        if (isChecked) {
            updatedMicroGrids = [...selectedMicroGrids, microGridId];
        } else {
            updatedMicroGrids = selectedMicroGrids.filter(id => id !== microGridId);
        }
        setSelectedMicroGrids(updatedMicroGrids);
    };

    // Handle district-level select all
    const handleDistrictSelectAll = (districtMicroGridIds, isChecked) => {
        let updatedMicroGrids;
        if (isChecked) {
            // Add all micro grids from this district
            const newIds = districtMicroGridIds.filter(id => !selectedMicroGrids.includes(id));
            updatedMicroGrids = [...selectedMicroGrids, ...newIds];
        } else {
            // Remove all micro grids from this district
            updatedMicroGrids = selectedMicroGrids.filter(id => !districtMicroGridIds.includes(id));
        }
        setSelectedMicroGrids(updatedMicroGrids);
    };

    // Toggle district expansion
    const toggleDistrictExpansion = (districtName) => {
        setOpenDistricts(prev => {
            const newSet = new Set(prev);
            if (newSet.has(districtName)) {
                newSet.delete(districtName);
            } else {
                newSet.add(districtName);
            }
            return newSet;
        });
    };

    // Client-side grouping: Group micro grids by district
    const getGroupedMicroGrids = () => {
        const grouped = {};
        microGrids.forEach(microGrid => {
            const district = microGrid.district || 'Unknown District';
            if (!grouped[district]) {
                grouped[district] = [];
            }
            grouped[district].push(microGrid);
        });
        
        // Sort districts alphabetically and sort micro grids within each district
        const sortedDistricts = Object.keys(grouped).sort();
        const result = {};
        sortedDistricts.forEach(district => {
            result[district] = grouped[district].sort((a, b) => 
                (a.grid_name || '').localeCompare(b.grid_name || '')
            );
        });
        
        return result;
    };


    // Get summary text for selected micro grids
    const getSummaryText = () => {
        const microGridCount = selectedMicroGrids.length;
        const totalMicroGrids = microGrids.length;
        const groupedData = getGroupedMicroGrids();
        const totalDistricts = Object.keys(groupedData).length;
        
        if (microGridCount === 0) {
            return `請選擇微網格 (${totalDistricts}個區域，共 ${totalMicroGrids} 個微網格)`;
        }
        
        return `已選擇 ${microGridCount} / ${totalMicroGrids} 個微網格`;
    };

    if (loading) {
        return (
            <div ref={containerRef} className="options-container">
                <div className="general-title">微網格</div>
                <div className="info-text">載入中...</div>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="options-container">
            {/* General title matching SelectionList style */}
            <div className="general-title">微網格</div>

            <div className="info-text">
                {getSummaryText()}
            </div>

            {/* Districts and micro grids list */}
            {Object.entries(getGroupedMicroGrids()).map(([districtName, districtMicroGrids]) => {
                const districtMicroGridIds = districtMicroGrids.map(mg => mg.id);
                const isDistrictExpanded = openDistricts.has(districtName);
                const selectedMicroGridsInDistrict = districtMicroGridIds.filter(id => selectedMicroGrids.includes(id)).length;
                const allDistrictGridsSelected = selectedMicroGridsInDistrict === districtMicroGrids.length && districtMicroGrids.length > 0;
                const someDistrictGridsSelected = selectedMicroGridsInDistrict > 0 && selectedMicroGridsInDistrict < districtMicroGrids.length;

                return (
                    <div key={districtName} className="district-card">
                        <div className="district-header">
                            <input
                                type="checkbox"
                                className="district-checkbox"
                                checked={allDistrictGridsSelected}
                                ref={(el) => {
                                    if (el) {
                                        el.indeterminate = someDistrictGridsSelected;
                                    }
                                }}
                                onChange={(e) => {
                                    e.stopPropagation();
                                    handleDistrictSelectAll(districtMicroGridIds, e.target.checked);
                                }}
                                onClick={(e) => e.stopPropagation()}
                            />
                            <div 
                                className="district-info"
                                onClick={() => toggleDistrictExpansion(districtName)}
                            >
                                <div className="district-name">{districtName}</div>
                                <div className="district-meta">
                                    {selectedMicroGridsInDistrict}/{districtMicroGrids.length} 個微網格已選擇
                                </div>
                            </div>
                            <div 
                                className="expand-indicator"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggleDistrictExpansion(districtName);
                                }}
                            >
                                {isDistrictExpanded ? <FaChevronUp /> : <FaChevronDown />}
                            </div>
                        </div>

                        {/* Micro grids for this district */}
                        {isDistrictExpanded && (
                            <div className="micro-grids-container">
                                {districtMicroGrids.map((microGrid) => {
                                    const isMicroGridSelected = selectedMicroGrids.includes(microGrid.id);
                                    return (
                                        <label key={microGrid.id} className="micro-grid-item">
                                            <input
                                                type="checkbox"
                                                className="micro-grid-checkbox"
                                                checked={isMicroGridSelected}
                                                onChange={(e) => handleMicroGridSelect(microGrid.id, e.target.checked)}
                                            />
                                            <FaLayerGroup className="micro-grid-icon" />
                                            <span className="micro-grid-name">{microGrid.grid_name}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default DistrictMicroGridSelection;
