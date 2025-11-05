import React, { useState, useEffect, useRef } from 'react';
import './SelectionList.css';
import L from 'leaflet'; // Added to stop event propagation to map
import {
    FaChevronDown,
    FaChevronUp,
    FaExclamationTriangle,
    FaMicrophone
} from 'react-icons/fa';
import { MdWifiTethering } from 'react-icons/md';
import Collapsible from 'react-collapsible';
import TreeView from './TreeView';

// Import external images
import CMHKIcon from './providerIcon/CMHKIcon.png';
import CSLIcon from './providerIcon/CSL_Mobile-Logo.png';
import SmarToneIcon from './providerIcon/SmarTone.jpg';
import HutchisonIcon from './providerIcon/Hutchison.png';

// Colored square component for MR competitive data
const ColoredSquare = ({ color = '#666', className = "option-icon" }) => (
    <div
        className={className}
        style={{
            width: '12px',
            height: '12px',
            border: '1px solid #333',
            backgroundColor: color,
            marginRight: '6px',
            flexShrink: 0
        }}
    />
);

// Color mapping for MR competitive data categories
const competitiveDataColors = {
    'strong_we_strong': '#39ff23', // 競強我強
    'strong': '#ff0000',          // 競強我弱
    'weak_we_strong': '#3729ff',   // 競弱我強
    'weak': '#606060'           // 競弱我弱 
};

// Color mapping for 六維數據 categories
const sixDimensionDataColors = {
    'complaint_': '#d17021',        // 投訴數據
    'simulation_data': '#ed5fe6',   // 仿真數據
    'LTE_Simulation_Data': '#ed5fe6', // 仿真數據 (legacy)
    'microphone_data': '#d1b226',   // 高負荷數據
    'cmhk_test_data': '#880699',    // CMHK 弱覆蓋
    'cmhk': '#880699'               // CMHK 弱覆蓋 (legacy)
};

// Circle component for planning sites
const SiteCircle = ({ className = "option-icon" }) => (
    <div
        className={className}
        style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            border: '1px solid #666',
            backgroundColor: 'transparent',
            marginRight: '6px',
            flexShrink: 0
        }}
    />
);

// Triangle component for live sites with different colors
const SiteTriangle = ({ color = '#666', className = "option-icon" }) => (
    <div
        className={className}
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

// Diamond component for competitive sites
const CompetitiveSiteDiamond = ({ color = '#ff6b35', className = "option-icon" }) => (
    <div
        className={className}
        style={{
            width: '10px',
            height: '10px',
            backgroundColor: color,
            border: '1px solid #333',
            transform: 'rotate(45deg)',
            marginRight: '6px',
            flexShrink: 0
        }}
    />
);

// Hexagon component for H3 sites
const HexagonIcon = ({ color = '#ffffff', className = "option-icon" }) => (
    <div
        className={className}
        style={{
            width: '12px',
            height: '12px',
            backgroundColor: color,
            border: '1px solid #999',  // Light border for alignment and visibility
            clipPath: 'polygon(30% 0%, 70% 0%, 100% 50%, 70% 100%, 30% 100%, 0% 50%)',
            marginRight: '6px',
            marginLeft: '-0.5px',    // Negative margin to shift left
            flexShrink: 0
        }}
    />
);


// Mapping of providers to icons
const providerIcons = {
    // Providers using react-icons
    complaint_: FaExclamationTriangle,
    simulation_data: MdWifiTethering,
    LTE_Simulation_Data: MdWifiTethering,
    microphone_data: FaMicrophone,

    // Providers using external images
    cmhk: CMHKIcon,
    xcsl: CSLIcon,
    xsmt: SmarToneIcon,
    xhut: HutchisonIcon,
};

// Format band names for display
const formatBandName = (band, provider, subCategory = null) => {

    if (provider === 'testing_data') {
        // Handle unified testing data format with operator prefixes
        if (band.startsWith('cmhk_')) {
            const bandNumber = band.replace('cmhk_', '');
            if (subCategory === 'lte') {
                return `CMHK LTE ${bandNumber}`;
            } else if (subCategory === 'nr') {
                return `CMHK NR ${bandNumber}`;
            }
            return `CMHK Band ${bandNumber}`;
        } else if (band.includes('_l')) {
            // Non-CMHK LTE format: xcsl_l900, xsmt_l1800, etc.
            const [providerCode, lteBandNumber] = band.split('_l');
            let providerName = '';
            switch (providerCode) {
                case 'xcsl': providerName = 'CSL'; break;
                case 'xsmt': providerName = 'SmarTone'; break;
                case 'xhut': providerName = 'Hutchison'; break;
                default: providerName = providerCode.toUpperCase();
            }
            return `${providerName} LTE ${lteBandNumber}`;
        } else if (band.includes('_ft_nr')) {
            // Non-CMHK NR format: xcsl_ft_nr3500_rsrp, xsmt_ft_nr2100_rsrp, etc.
            const match = band.match(/nr(\d+)/);
            if (!match) return band.toUpperCase();
            const nrBandNumber = match[1];
            let providerCode = band.split('_')[0];
            let providerName = '';
            switch (providerCode) {
                case 'xcsl': providerName = 'CSL'; break;
                case 'xsmt': providerName = 'SmarTone'; break;
                case 'xhut': providerName = 'Hutchison'; break;
                default: providerName = providerCode.toUpperCase();
            }
            return `${providerName} NR ${nrBandNumber}`;
        }

        // Fallback for unknown formats
        return band.toUpperCase();
    } else if (provider === 'complaint_') {
        if (band === 'data_geojson') {
            return '網絡投訴';
        } else if (band === 'toc_2024') {
            return '2024年ToC投訴';
        } else if (band === 'toc_2025') {
            return '2025年ToC投訴';
        }
    } else if (provider === 'simulation_data' || provider === 'LTE_Simulation_Data') {
        if (band === 'RAW_5G_Layer') {
            return 'NR 仿真原始數據（只能加載全域數據）';
        } else if (band === 'RAW_4G_Layer') {
            return 'LTE 仿真原始數據（只能加載全域數據）';
        }
    } else if (provider === 'Discovery_MR_Data_NR') {
        const bandMapping = {
            'strong_we_strong': '競強我強',
            'strong': '競強我弱',
            'weak_we_strong': '競弱我強',
            'weak': '競弱我弱'
        };
        return bandMapping[band] || band;
    } else if (provider === 'microphone_data' && band === 'grid_highload') {
        return '高負荷數據';
    } else if (provider === 'cmhk_test_data') {
        // Handle CMHK test data band names
        if (band === 'rsrp') {
            return `RSRP (${subCategory === 'lte_competition' ? 'LTE' : 'NR'})`;
        } else if (band === 'sinr') {
            return `SINR (${subCategory === 'lte_competition' ? 'LTE' : 'NR'})`;
        }
        return band;
    } else if (provider === 'site_structure_data') {
        // 規劃站點場景映射
        const planningScenarioMapping = {
            '1_高投訴': '高投訴場景',
            '2_重點場景': '重點場景',
            '3_弱覆蓋': '弱覆蓋場景',
            '4_高負荷': '高負荷場景',
            '5_高端區域': '高端區域',
            '6_tobgn': 'To BGN 場景',
            '729 Planning List': '729清單'
        };

        // 現有站點類型映射 (New 4-option layout in English)
        const liveSiteTypeMapping = {
            'Outdoor Site': 'Outdoor Site',
            'Indoor Site': 'Indoor Site', 
            'Indoor-Pico/Micro Site': 'Indoor-Pico/Micro Site',
            'Indoor + Outdoor Site': 'Indoor + Outdoor Site'
        };

        // 競對站點映射 (updated for indoor/outdoor categorization)
        const competitiveSiteMapping = {
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
            'h3_sites': '2025Q2 競對數據',
        };

        // 檢查是否為規劃站點場景
        if (planningScenarioMapping[band]) {
            return planningScenarioMapping[band];
        }

        // 檢查是否為現有站點類型
        if (liveSiteTypeMapping[band]) {
            return liveSiteTypeMapping[band];
        }

        // 檢查是否為競對站點
        if (competitiveSiteMapping[band]) {
            return competitiveSiteMapping[band];
        }

        return band;
    } else {
        return band
            .replace(/_geojson$/, '')
            .toUpperCase()
            .replace(/_/g, ' ')
            .replace(/B(\d+)/g, 'Band $1');
    }
};

const SelectionList = ({
    options,
    onSelect,
    selectedBands,
    toggleVisibility,
    title,
    renderingMode = 'global',
    selectedDistricts = [],
    newSiteTreeData = [],
    selectedNewSiteKeys = [],
    onNewSiteSelect
}) => {
    const [checkedState, setCheckedState] = useState({});
    const [openProviders, setOpenProviders] = useState({});
    const [openSubCategories, setOpenSubCategories] = useState({});
    const [justOpened, setJustOpened] = useState(true);
    const [forceRenderCounter, setForceRenderCounter] = useState(0);

    // 🚫 Helper function to check if a band is simulation raw data (blocked in region mode)
    const isSimulationRawData = (provider, subCategory, band) => {
        return (
            (provider === 'simulation_data' && subCategory === 'raw_simulation') ||
            (provider === 'simulation_data' && band === 'RAW_5G_Layer') ||
            (provider === 'LTE_Simulation_Data' && band === 'RAW_5G_Layer') ||
            (provider === 'simulation_data' && band === 'RAW_4G_Layer') ||
            (provider === 'LTE_Simulation_Data' && band === 'RAW_4G_Layer')
        );
    };

    // 🚫 Check if a band should be disabled due to rendering mode
    const isBandDisabledInRegionMode = (provider, subCategory, band) => {
        return renderingMode === 'spatial' && isSimulationRawData(provider, subCategory, band);
    };
    const ref = useRef(null);

    // Stop click/double-click/scroll from propagating to Leaflet map
    useEffect(() => {
        if (ref.current) {
            L.DomEvent.disableScrollPropagation(ref.current);
            L.DomEvent.disableClickPropagation(ref.current);
        }
    }, []);

    // 🚀 管理剛開啟狀態，防止立即關閉
    useEffect(() => {
        const timer = setTimeout(() => {
            setJustOpened(false);
        }, 100); // 100ms延遲，給用戶足夠時間完成點擊操作

        return () => clearTimeout(timer);
    }, []);

    // Provider display name
    const mapProviderName = (provider) => {
        switch (provider) {
            case 'testing_data': return '測試數據';
            case 'complaint_': return '1. 投訴數據';
            case 'simulation_data': return '3. 仿真數據';
            case 'LTE_Simulation_Data': return '3. 仿真數據';
            case 'Discovery_MR_Data_NR': return '2. MR競對數據';
            case 'microphone_data': return '4. 高負荷數據';
            case 'site_structure_data': return '5. 站點結構數據';
            case 'cmhk_test_data': return '6. 測試數據';
            default:
                return provider.charAt(0).toUpperCase() + provider.slice(1);
        }
    };

    // Initialize checkedState from selectedBands
    useEffect(() => {
        if (!selectedBands || !options) return;

        const newCheckedState = {};
        Object.keys(options).forEach((provider) => {
            // Some providers have subCategories (testing_data, simulation_data, site_structure_data, cmhk_test_data), some do not
            if (provider === 'simulation_data') {
                // Handle simulation data subcategories
                if (options.simulation_data.lte_simulation) {
                    options.simulation_data.lte_simulation.forEach((band) => {
                        const key = `${provider}_lte_simulation_${band}`;
                        newCheckedState[key] = selectedBands.includes(key);
                    });
                }
                if (options.simulation_data.raw_simulation) {
                    options.simulation_data.raw_simulation.forEach((band) => {
                        const key = `${provider}_raw_simulation_${band}`;
                        newCheckedState[key] = selectedBands.includes(key);
                    });
                }
            } else if (provider === 'testing_data') {
                // Handle testing data subcategories: lte / nr
                if (options.testing_data.lte) {
                    options.testing_data.lte.forEach((band) => {
                        const key = `${provider}_lte_${band}`;
                        newCheckedState[key] = selectedBands.includes(key);
                    });
                }
                if (options.testing_data.nr) {
                    options.testing_data.nr.forEach((band) => {
                        const key = `${provider}_nr_${band}`;
                        newCheckedState[key] = selectedBands.includes(key);
                    });
                }
            } else if (provider === 'site_structure_data') {
                // Handle site structure data subcategories: planning_sites / live_sites
                const ssd = options.site_structure_data || {};
                if (Array.isArray(ssd.planning_sites)) {
                    ssd.planning_sites.forEach((band) => {
                        const key = `${provider}_planning_sites_${band}`;
                        newCheckedState[key] = selectedBands.includes(key);
                    });
                }
                if (Array.isArray(ssd.live_sites)) {
                    ssd.live_sites.forEach((band) => {
                        const key = `${provider}_live_sites_${band}`;
                        newCheckedState[key] = selectedBands.includes(key);
                    });
                }
                if (Array.isArray(ssd.competitive_sites)) {
                    ssd.competitive_sites.forEach((band) => {
                        const key = `${provider}_competitive_sites_${band}`;
                        newCheckedState[key] = selectedBands.includes(key);
                    });
                }
            } else if (provider === 'cmhk_test_data') {
                // Handle CMHK test data subcategories: lte_competition / nr_competition
                const ctd = options.cmhk_test_data || {};
                if (ctd.lte_competition && Array.isArray(ctd.lte_competition)) {
                    ctd.lte_competition.forEach(scenario => {
                        const key = `${provider}_lte_competition_${scenario}`;
                        newCheckedState[key] = selectedBands.includes(key);
                    });
                    // Add RSRP and SINR for LTE competition
                    ['rsrp', 'sinr'].forEach(option => {
                        const key = `${provider}_lte_competition_${option}`;
                        newCheckedState[key] = selectedBands.includes(key);
                    });
                }
                if (ctd.nr_competition && Array.isArray(ctd.nr_competition)) {
                    ctd.nr_competition.forEach(scenario => {
                        const key = `${provider}_nr_competition_${scenario}`;
                        newCheckedState[key] = selectedBands.includes(key);
                    });
                    // Add RSRP and SINR for NR competition
                    ['rsrp', 'sinr'].forEach(option => {
                        const key = `${provider}_nr_competition_${option}`;
                        newCheckedState[key] = selectedBands.includes(key);
                    });
                }
            } else {
                // Normal array
                if (Array.isArray(options[provider])) {
                    options[provider].forEach((band) => {
                        const key = `${provider}_${band}`;
                        newCheckedState[key] = selectedBands.includes(key);
                    });
                }
            }
        });
        setCheckedState(newCheckedState);
    }, [selectedBands, options]);

    // Handle checking/unchecking - 改為完全多選
    const handleSelect = (provider, subCategory, band, isChecked) => {

        const key = subCategory ? `${provider}_${subCategory}_${band}` : `${provider}_${band}`;

        const newState = { ...checkedState, [key]: isChecked };

        setCheckedState(newState);

        // Build updated selectedBands array
        const updatedSelected = Object.keys(newState).filter((k) => newState[k]);
        // Provide the newly up-to-date array, plus the deselected key
        onSelect(updatedSelected, isChecked ? null : key);
    };

    // 🚀 PERFORMANCE FIX: Memoize search functions to prevent recreation on every render
    // REMOVED: handleSearchChange and filterBands functions

    // Toggle provider accordion
    const toggleProvider = (provider) => {
        setOpenProviders((prev) => {
            const newState = { ...prev, [provider]: !prev[provider] };
            return newState;
        });
        // Force re-render to ensure Collapsible updates
        setForceRenderCounter(prev => prev + 1);
    };
    // Toggle subcategory (for testing_data, site_structure_data, cmhk_test_data)
    const toggleSubCategory = (provider, subCategory) => {
        const key = `${provider}_${subCategory}`;
        setOpenSubCategories((prev) => {
            const newState = { ...prev, [key]: !prev[key] };
            return newState;
        });
        // Force re-render to ensure Collapsible updates
        setForceRenderCounter(prev => prev + 1);
    };

    // Return correct icon - using blank squares for 六維數據 providers
    const getIconComponent = (providerCode, subCategory = null, band = null) => {
        // Special handling for site_structure_data
        if (providerCode === 'site_structure_data') {
            if (subCategory === 'planning_sites') {
                // Use circles for planning sites
                return <SiteCircle className="option-icon" />;
            } else if (subCategory === 'live_sites') {
                // Use colored triangles for live sites
                const liveSiteColors = {
                    'Outdoor Site': '#8b0000',        // Dark red
                    'Indoor Site': '#8b0000',         // Dark red 
                    'Indoor-Pico/Micro Site': '#8b0000', // Dark red
                    'Indoor + Outdoor Site': '#8b0000'   // Dark red
                };
                const color = liveSiteColors[band] || '#666';
                return <SiteTriangle color={color} className="option-icon" />;
            } else if (subCategory === 'competitive_sites') {
                if (band === 'h3_sites') {
                    return <HexagonIcon color="#ffffff" className="option-icon" />;
                }
                
                // Use colored diamonds for competitive sites (updated for indoor/outdoor)
                const competitiveSiteColors = {
                    'hkt4g_1800_indoor': '#ff8c42',     // Light orange for 1800MHz indoor
                    'hkt4g_1800_outdoor': '#ff6b35',    // Orange for 1800MHz outdoor
                    'hkt4g_900_indoor': '#5dade2',      // Light blue for 900MHz indoor
                    'hkt4g_900_outdoor': '#3498db',     // Blue for 900MHz outdoor
                    'hkt2025_sites_indoor': '#f1948a',  // Light red for 2025 indoor
                    'hkt2025_sites_outdoor': '#e74c3c', // Red for 2025 outdoor
                    'hut_sites_indoor': '#9b59b6',      // Purple for HUT indoor
                    'hut_sites_outdoor': '#8e44ad',     // Dark purple for HUT outdoor
                    'smt_sites_indoor': '#27ae60',      // Green for SMT indoor
                    'smt_sites_outdoor': '#229954'      // Dark green for SMT outdoor
                };
                const color = competitiveSiteColors[band] || '#ff6b35';
                return <CompetitiveSiteDiamond color={color} className="option-icon" />;
            }
            // Fallback to circle for unknown subcategories
            return <SiteCircle className="option-icon" />;
        }
        
        // Special handling for MR competitive data - use colored squares
        if (providerCode === 'Discovery_MR_Data_NR') {
            const color = competitiveDataColors[band] || '#666';
            return <ColoredSquare color={color} className="option-icon" />;
        }

        
        // Use colored squares for 六維數據 providers
        const sixDimensionProviders = [
            'complaint_',
            'simulation_data', 
            'LTE_Simulation_Data',
            'microphone_data',
            'cmhk_test_data',
            'cmhk'
        ];
        
        // Special case: For CMHK LTE/NR under "其他測試數據", use CMHK image icon instead of purple square
        if (providerCode === 'cmhk' && subCategory !== null) {
            const cmhkImg = providerIcons['cmhk'];
            return <img src={cmhkImg} alt="CMHK" className="option-image-icon" />;
        }

        if(providerCode === 'complaint_') {
            const complaintColors = {
                'data_geojson': '#d17021',
                'toc_2024': '#ff0000ff',
                'toc_2025': '#ff0000ff',
            };
            return <ColoredSquare color={complaintColors[band]} className="option-icon" />;
        }

        if (sixDimensionProviders.includes(providerCode)) {
            let color = sixDimensionDataColors[providerCode] || '#666';
            
            // Special handling for simulation data to match legend colors
            if ((providerCode === 'simulation_data' || providerCode === 'LTE_Simulation_Data') && band === 'RAW_5G_Layer') {
                color = '#a83f39'; // Use the same color as in Legend.js for 仿真原數據
            } else if ((providerCode === 'simulation_data' || providerCode === 'LTE_Simulation_Data') && band === 'RAW_4G_Layer') {
                color = '#8b5a00'; // Brown color for 4G simulation raw data
            }
            
            return <ColoredSquare color={color} className="option-icon" />;
        }
        
        const IconComp = providerIcons[providerCode];
        if (!IconComp) return null;
        // If it's a string, it's a path to an image
        if (typeof IconComp === 'string') {
            return <img src={IconComp} alt={providerCode} className="option-image-icon" />;
        }
        // Otherwise, it's a React icon component
        return <IconComp className="option-icon" />;
    };

    // Render the list
    const renderOptions = () => {
        let hasResults = false;

        const providerElements = Object.keys(options).map((provider) => {
            // If it's simulation_data, testing_data, site_structure_data, or cmhk_test_data, handle subcategories
            if (provider === 'simulation_data') {
                // Handle simulation data subcategories: lte_simulation, raw_simulation
                const subCategories = [];
                if (options.simulation_data.lte_simulation) subCategories.push('lte_simulation');
                if (options.simulation_data.raw_simulation) subCategories.push('raw_simulation');

                let providerHasResults = false;
                const subCategoryElements = subCategories.map((subCategory) => {
                    const bandArray = options[provider][subCategory] || [];
                    const bands = bandArray
                        .map((band) => {
                            const key = `${provider}_${subCategory}_${band}`;
                            const IconComponent = getIconComponent('LTE_Simulation_Data', subCategory, band);

                            hasResults = true;
                            providerHasResults = true;
                            const isChecked = checkedState[key] || false;

                            // 🚫 Check if this band is blocked in region mode
                            const isDisabled = isBandDisabledInRegionMode(provider, subCategory, band);
                            const isSimRawData = isSimulationRawData(provider, subCategory, band);

                            return (
                                <label
                                    key={key}
                                    className={`option-label ${isChecked ? 'is-checked' : ''} ${isDisabled ? 'option-label-disabled' : ''}`}
                                    title={isDisabled ? '區域模式下無法選擇仿真原數據' : ''}
                                >
                                    <input
                                        type="checkbox"
                                        className="option-checkbox"
                                        checked={isChecked}
                                        disabled={isDisabled}
                                        onChange={(e) =>
                                            handleSelect(provider, subCategory, band, e.target.checked)
                                        }
                                    />
                                    {IconComponent}
                                    <span className="option-button">
                                        {formatBandName(band, provider, subCategory)}
                                        {isSimRawData && renderingMode === 'spatial' && (
                                            <span className="disabled-indicator" style={{ marginLeft: '8px' }}>🚫</span>
                                        )}
                                    </span>
                                </label>
                            );
                        });

                    if (bands.length > 0) {
                        return (
                            <React.Fragment key={`${provider}_${subCategory}`}>
                                {bands}
                            </React.Fragment>
                        );
                    } else {
                        return null;
                    }
                });

                if (providerHasResults) {
                    return (
                        <div key={provider} className="provider-section">
                            <div className="provider-title" onClick={() => toggleProvider(provider)}>
                                {mapProviderName(provider)}
                                <span className="accordion-icon">
                                    {openProviders[provider] ? <FaChevronUp /> : <FaChevronDown />}
                                </span>
                            </div>
                            <Collapsible 
                                key={`${provider}-${openProviders[provider] ? 'open' : 'closed'}-${forceRenderCounter}`}
                                open={openProviders[provider]}
                                transitionTime={200}
                                easing='ease-out'
                            >
                                <div className="bands-container">{subCategoryElements}</div>
                            </Collapsible>
                        </div>
                    );
                }
                return null; // no subcats had results
            } else if (provider === 'testing_data') {
                // Handle testing data subcategories: lte / nr
                const subCategories = [];
                if (options.testing_data.lte) subCategories.push('lte');
                if (options.testing_data.nr) subCategories.push('nr');

                let providerHasResults = false;
                const subCategoryElements = subCategories.map((subCategory) => {
                    const bandArray = options[provider][subCategory] || [];
                    const bands = bandArray
                        .map((band) => {
                            const key = `${provider}_${subCategory}_${band}`;
                            // Detect operator from band name for proper icon
                            let operatorCode = 'cmhk'; // default
                            if (band.startsWith('cmhk_')) {
                                operatorCode = 'cmhk';
                            } else if (band.includes('xcsl_')) {
                                operatorCode = 'xcsl';
                            } else if (band.includes('xsmt_')) {
                                operatorCode = 'xsmt';
                            } else if (band.includes('xhut_')) {
                                operatorCode = 'xhut';
                            }
                            // Pass subCategory and band so getIconComponent can distinguish CMHK LTE/NR under other test data
                            const IconComponent = getIconComponent(operatorCode, subCategory, band);

                            hasResults = true;
                            providerHasResults = true;
                            const isChecked = checkedState[key] || false;
                            return (
                                <label key={key} className={`option-label ${isChecked ? 'is-checked' : ''}`}>
                                    <input
                                        type="checkbox"
                                        className="option-checkbox"
                                        checked={isChecked}
                                        onChange={(e) =>
                                            handleSelect(provider, subCategory, band, e.target.checked)
                                        }
                                    />
                                    {IconComponent}
                                    <span className="option-button">
                                        {formatBandName(band, provider, subCategory)}
                                    </span>
                                </label>
                            );
                        });

                    if (bands.length > 0) {
                        return (
                            <React.Fragment key={`${provider}_${subCategory}`}>
                                <div
                                    className="subcategory-title"
                                    onClick={() => toggleSubCategory(provider, subCategory)}
                                >
                                    {subCategory === 'lte' ? 'LTE' : 'NR'}
                                    <span className="accordion-icon">
                                        {openSubCategories[`${provider}_${subCategory}`]
                                            ? <FaChevronUp />
                                            : <FaChevronDown />
                                        }
                                    </span>
                                </div>
                                <Collapsible 
                                    key={`${provider}_${subCategory}-${openSubCategories[`${provider}_${subCategory}`] ? 'open' : 'closed'}-${forceRenderCounter}`}
                                    open={openSubCategories[`${provider}_${subCategory}`]}
                                    transitionTime={200}
                                    easing='ease-out'
                                >
                                    {bands}
                                </Collapsible>
                            </React.Fragment>
                        );
                    } else {
                        return null;
                    }
                });

                if (providerHasResults) {
                    return (
                        <div key={provider} className="provider-section">
                            <div className="provider-title" onClick={() => toggleProvider(provider)}>
                                {mapProviderName(provider)}
                                <span className="accordion-icon">
                                    {openProviders[provider] ? <FaChevronUp /> : <FaChevronDown />}
                                </span>
                            </div>
                            <Collapsible 
                                key={`${provider}-${openProviders[provider] ? 'open' : 'closed'}-${forceRenderCounter}`}
                                open={openProviders[provider]}
                                transitionTime={200}
                                easing='ease-out'
                            >
                                <div className="bands-container">{subCategoryElements}</div>
                            </Collapsible>
                        </div>
                    );
                }
                return null; // no subcats had results
            } else if (provider === 'site_structure_data') {
                // Handle site structure data subcategories: planning_sites / live_sites / competitive_sites
                const subCategories = [];
                if (options.site_structure_data.planning_sites) subCategories.push('planning_sites');
                if (options.site_structure_data.live_sites) subCategories.push('live_sites');
                if (options.site_structure_data.competitive_sites) subCategories.push('competitive_sites');

                let providerHasResults = false;
                const subCategoryElements = subCategories.map((subCategory) => {
                    const bandArray = options[provider][subCategory] || [];
                    
                    // Separate TreeView items from regular checkboxes for planning_sites
                    const treeViewItems = [];
                    const regularBands = [];
                    
                    if (subCategory === 'planning_sites') {
                        bandArray.forEach((band) => {
                            if (band === '126 New Site') {
                                treeViewItems.push(band);
                            } else {
                                regularBands.push(band);
                            }
                        });
                    } else {
                        regularBands.push(...bandArray);
                    }
                    
                    // Create the bands array with clustering item
                    const regularBandElements = regularBands.map((band, index) => {
                        const key = `${provider}_${subCategory}_${band}`;
                        
                        hasResults = true;
                        providerHasResults = true;
                        
                        const IconComponent = getIconComponent('site_structure_data', subCategory, band);
                        
                        return (
                            <label key={key} className={`option-label`}>
                                <input
                                    type="checkbox"
                                    className="option-checkbox"
                                    checked={checkedState[key] || false}
                                    onChange={(e) =>
                                        handleSelect(provider, subCategory, band, e.target.checked)
                                    }
                                />
                                {IconComponent}
                                <span className="option-button">
                                    {formatBandName(band, provider, subCategory)}
                                </span>
                            </label>
                        );
                    });

                    // Add clustering option only when outdoor sites are actually selected
                    let clusteringElement = null;
                    if (subCategory === 'live_sites' && checkedState[`${provider}_${subCategory}_Outdoor Site`]) {
                        const clusteringKey = `${provider}_${subCategory}_live_site_clustering`;
                        const ClusteringIconComponent = <div
                            className="option-icon"
                            style={{
                                width: '12px',
                                height: '12px',
                                backgroundColor: '#ff6b6b',
                                border: '1px solid #333',
                                borderRadius: '3px',
                                marginRight: '6px',
                                flexShrink: 0
                            }}
                        />;
                        
                        clusteringElement = (
                            <label key={clusteringKey} className={`option-label ${checkedState[clusteringKey] ? 'is-checked' : ''}`}>
                                <input
                                    type="checkbox"
                                    className="option-checkbox"
                                    checked={checkedState[clusteringKey] || false}
                                    onChange={(e) =>
                                        handleSelect(provider, subCategory, 'live_site_clustering', e.target.checked)
                                    }
                                />
                                {ClusteringIconComponent}
                                <span className="option-button">
                                    Coverage Density Analysis (DBSCAN)
                                </span>
                            </label>
                        );
                    }
                    
                    const bands = [
                        // Render TreeView items first
                        ...treeViewItems.map((band) => {
                            const key = `${provider}_${subCategory}_${band}`;
                            hasResults = true;
                            providerHasResults = true;
                            
                            return (
                                <div key={key} className="tree-view-container">
                                    {/* TreeView for filtering - show directly */}
                                    {newSiteTreeData.length > 0 && onNewSiteSelect && (
                                        <TreeView
                                            data={newSiteTreeData}
                                            selectedKeys={selectedNewSiteKeys}
                                            onSelectionChange={onNewSiteSelect}
                                            title="126 攻堅站點"
                                        />
                                    )}
                                </div>
                            );
                        }),
                        // Then render regular checkbox items
                        ...regularBandElements,
                        // Add clustering element at the end
                        ...(clusteringElement ? [clusteringElement] : [])
                    ];

                    if (bands.length > 0) {
                        return (
                            <React.Fragment key={`${provider}_${subCategory}`}>
                                <div
                                    className="subcategory-title"
                                    onClick={() => toggleSubCategory(provider, subCategory)}
                                >
                                    {subCategory === 'planning_sites' ? '規劃站點' : 
                                     subCategory === 'live_sites' ? '現有站點' : '競對站點'}
                                    <span className="accordion-icon">
                                        {openSubCategories[`${provider}_${subCategory}`]
                                            ? <FaChevronUp />
                                            : <FaChevronDown />
                                        }
                                    </span>
                                </div>
                                <Collapsible 
                                    key={`${provider}_${subCategory}-${openSubCategories[`${provider}_${subCategory}`] ? 'open' : 'closed'}-${forceRenderCounter}`}
                                    open={openSubCategories[`${provider}_${subCategory}`]}
                                    transitionTime={200}
                                    easing='ease-out'
                                >
                                    {bands}
                                </Collapsible>
                            </React.Fragment>
                        );
                    } else {
                        return null;
                    }
                });

                if (providerHasResults) {
                    return (
                        <div key={provider} className="provider-section">
                            <div className="provider-title" onClick={() => toggleProvider(provider)}>
                                {mapProviderName(provider)}
                                <span className="accordion-icon">
                                    {openProviders[provider] ? <FaChevronUp /> : <FaChevronDown />}
                                </span>
                            </div>
                            <Collapsible 
                                key={`${provider}-${openProviders[provider] ? 'open' : 'closed'}-${forceRenderCounter}`}
                                open={openProviders[provider]}
                                transitionTime={200}
                                easing='ease-out'
                            >
                                <div className="bands-container">{subCategoryElements}</div>
                            </Collapsible>
                        </div>
                    );
                }
                return null; // no subcats had results
            } else if (provider === 'cmhk_test_data') {
                // Handle CMHK test data subcategories: lte_competition / nr_competition
                const subCategories = [];
                if (options.cmhk_test_data.lte_competition) subCategories.push('lte_competition');
                if (options.cmhk_test_data.nr_competition) subCategories.push('nr_competition');

                let providerHasResults = false;
                const subCategoryElements = subCategories.map((subCategory) => {
                    const bandArray = options[provider][subCategory] || [];
                    
                    // Add RSRP and SINR options for each subcategory
                    const additionalOptions = ['rsrp', 'sinr'];
                    const allOptions = [...bandArray, ...additionalOptions];
                    
                    const bands = allOptions
                        .map((band) => {
                            const key = `${provider}_${subCategory}_${band}`;
                            
                            // Define colors for each competition scenario and additional options
                            const scenarioColors = {
                                '競強我強': '#39ff23',
                                '競強我弱': '#ff0000',
                                '競弱我強': '#3729ff',
                                '競弱我弱': '#606060',
                                'rsrp': '#ffffff',     
                                'sinr': '#ffffff'       
                            };
                            
                            const IconComponent = band === 'rsrp' || band === 'sinr' ? null : (
                                <div
                                    className="option-icon"
                                    style={{
                                        width: '12px',
                                        height: '12px',
                                        border: '1px solid #333',
                                        backgroundColor: scenarioColors[band] || '#666',
                                        marginRight: '6px',
                                        flexShrink: 0
                                    }}
                                />
                            );

                            hasResults = true;
                            providerHasResults = true;
                            const isChecked = checkedState[key] || false;
                            return (
                                <label key={key} className={`option-label ${isChecked ? 'is-checked' : ''}`}>
                                    <input
                                        type="checkbox"
                                        className="option-checkbox"
                                        checked={isChecked}
                                        onChange={(e) =>
                                            handleSelect(provider, subCategory, band, e.target.checked)
                                        }
                                    />
                                    {IconComponent}
                                    <span className="option-button">
                                        {formatBandName(band, provider, subCategory)}
                                    </span>
                                </label>
                            );
                        });

                    if (bands.length > 0) {
                        return (
                            <React.Fragment key={`${provider}_${subCategory}`}>
                                <div
                                    className="subcategory-title"
                                    onClick={() => toggleSubCategory(provider, subCategory)}
                                >
                                    {subCategory === 'lte_competition' ? 'LTE 競對場景' : 'NR 競對場景'}
                                    <span className="accordion-icon">
                                        {openSubCategories[`${provider}_${subCategory}`]
                                            ? <FaChevronUp />
                                            : <FaChevronDown />
                                        }
                                    </span>
                                </div>
                                <Collapsible 
                                    key={`${provider}_${subCategory}-${openSubCategories[`${provider}_${subCategory}`] ? 'open' : 'closed'}-${forceRenderCounter}`}
                                    open={openSubCategories[`${provider}_${subCategory}`]}
                                    transitionTime={200}
                                    easing='ease-out'
                                >
                                    {bands}
                                </Collapsible>
                            </React.Fragment>
                        );
                    } else {
                        return null;
                    }
                });

                if (providerHasResults) {
                    return (
                        <div key={provider} className="provider-section">
                            <div className="provider-title" onClick={() => toggleProvider(provider)}>
                                {mapProviderName(provider)}
                                <span className="accordion-icon">
                                    {openProviders[provider] ? <FaChevronUp /> : <FaChevronDown />}
                                </span>
                            </div>
                            <Collapsible 
                                key={`${provider}-${openProviders[provider] ? 'open' : 'closed'}-${forceRenderCounter}`}
                                open={openProviders[provider]}
                                transitionTime={200}
                                easing='ease-out'
                            >
                                <div className="bands-container">{subCategoryElements}</div>
                            </Collapsible>
                        </div>
                    );
                }
                return null; // no options available
            } else {
                // No subcategories, just an array
                const bandList = options[provider] || [];
                let providerHasResults = false;

                const filteredBands = bandList
                    .map((band) => {
                        const key = `${provider}_${band}`;
                        const IconComponent = getIconComponent(provider, null, band);

                        hasResults = true;
                        providerHasResults = true;
                        const isChecked = checkedState[key] || false;
                        return (
                            <label key={key} className={`option-label ${isChecked ? 'is-checked' : ''}`}>
                                <input
                                    type="checkbox"
                                    className="option-checkbox"
                                    checked={isChecked}
                                    onChange={(e) => handleSelect(provider, null, band, e.target.checked)}
                                />
                                {IconComponent}
                                <span className="option-button">
                                    {formatBandName(band, provider, null)}
                                </span>
                            </label>
                        );
                    });

                if (providerHasResults) {
                    return (
                        <div key={provider} className="provider-section">
                            <div className="provider-title" onClick={() => {
                                toggleProvider(provider);
                            }}>
                                {mapProviderName(provider)}
                                <span className="accordion-icon">
                                    {openProviders[provider] ? <FaChevronUp /> : <FaChevronDown />}
                                </span>
                            </div>
                            <Collapsible 
                                key={`${provider}-${openProviders[provider] ? 'open' : 'closed'}-${forceRenderCounter}`}
                                open={openProviders[provider]}
                                transitionTime={200}
                                easing='ease-out'
                            >
                                <div className="bands-container">{filteredBands}</div>
                            </Collapsible>
                        </div>
                    );
                }
                return null; // no bands matched search
            }
        });

        if (!hasResults) {
            return (
                <div className="no-results-message">
                    沒有可用的數據。
                </div>
            );
        }
        return providerElements;
    };

    // 🚀 改進的外部點擊檢測，避免意外關閉
    useEffect(() => {
        const handleClickOutside = (event) => {
            // 如果剛開啟，不處理外部點擊
            if (justOpened) return;

            // 檢查點擊是否在選單容器內
            if (ref.current && !ref.current.contains(event.target)) {
                // 檢查點擊的元素是否是導航欄按鈕或其子元素
                const clickedElement = event.target;
                const navbarButton = clickedElement.closest('.navbar-button');

                // 如果點擊的是導航欄按鈕，不關閉選單（讓按鈕本身處理）
                if (navbarButton) return;

                // 檢查是否點擊在其他已知的UI元素上
                const isUIElement = clickedElement.closest('.loading-overlay-container') ||
                    clickedElement.closest('.info-panel') ||
                    clickedElement.closest('.leaflet-control');

                // 如果不是UI元素，才關閉選單
                if (!isUIElement) {
                    toggleVisibility();
                }
            }
        };

        // 使用較小的延遲來設置事件監聽器，確保組件完全渲染後再監聽
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 50);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [toggleVisibility, justOpened]);

    return (
        <div ref={ref} className="options-container">
            <div className="general-title">{title}</div>
            <div className="info-text">
                {selectedDistricts.length > 0
                    ? `已選擇 ${selectedDistricts.length} 個行政區域`
                    : '可直接選擇數據（部分數據無需行政區）'}
            </div>
            {renderOptions()}
        </div>
    );
};

export default SelectionList;
