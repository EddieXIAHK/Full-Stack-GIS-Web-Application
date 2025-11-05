// TelecomMap.js
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './MapStyles.css';
import './BoundaryStyles.css';
import SelectionList from './SelectionList';
import NavigationBar from './NavigationBar';

import PermanentDashboard from './PermanentDashboard';
import './PermanentDashboard.css';

import DistrictMicroGridSelection from './DistrictMicroGridSelection';
import Legend, {
    COMPLAINT_DATA_COLOR_MAP,
    SIMULATION_DATA_COLOR_MAP,
    MICROPHONE_DATA_COLOR_MAP,
    LTE_COMPETITION_COLOR_MAP,
    NR_COMPETITION_COLOR_MAP,
    RSRP_COLOR_MAP,
    SINR_COLOR_MAP,
    COMPETITIVE_SITE_COLOR_MAP
} from './Legend';
import SiteDetailWindow from './SiteDetailWindow';
import GridDetailPanel from './GridDetailPanel';

import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import { simplify } from '@turf/turf';
import 'leaflet.vectorgrid';

// 🚀 CONFIGURATION: External server configuration for all API calls
const EXTERNAL_SERVER_URL = 'http://10.250.52.75:3050';

// ---------------------------------------------------------------------------
// This polyfill prevents runtime errors when handling click events on vector tiles.
if (L && L.DomEvent && !L.DomEvent.fakeStop) {
    // eslint-disable-next-line no-underscore-dangle
    L.DomEvent.fakeStop = function (e) {
        try {
            if (!e) return this;
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
            e._leaflet_stop = true;
        } catch (err) { /* no-op */ }
        return this;
    };
}

// ============================================================================
// Basemap Configuration
// 🗺️ LOCAL TILES: Use local Hong Kong base tiles for isolated environment
// Set USE_LOCAL_TILES to true to use self-hosted tiles instead of external providers
const USE_LOCAL_TILES = false; // Set to false to use external OSM/CartoDB tiles (default for better performance)

const LOCAL_TILE_URL = `${EXTERNAL_SERVER_URL}/base-tiles/{z}/{x}/{y}.pbf`;
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const CARTO_TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

// ============================================================================
// 🚀 API請求管理器 - 限流和去抖機制
class APIRequestManager {
    constructor(maxConcurrent = 4, debounceMs = 300) {
        this.maxConcurrent = maxConcurrent;
        this.debounceMs = debounceMs;
        this.activeRequests = new Set();
        this.requestQueue = [];
        this.debounceTimers = new Map();
        this.abortControllers = new Set();
        this.processQueueTimeouts = new Set();
        this.isDestroyed = false;
    }

    // 去抖執行請求
    debounceRequest(key, requestFn) {

        // 清除舊的定時器
        if (this.debounceTimers.has(key)) {
            clearTimeout(this.debounceTimers.get(key));
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.debounceTimers.delete(key);
                this.enqueueRequest(requestFn).then(resolve).catch(reject);
            }, this.debounceMs);

            this.debounceTimers.set(key, timer);
        });
    }

    // 將請求加入隊列
    async enqueueRequest(requestFn) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ requestFn, resolve, reject });
            this.processQueue();
        });
    }

    // 處理請求隊列
    async processQueue() {
        // 🚀 PERFORMANCE FIX: Check if destroyed to prevent memory leaks
        if (this.isDestroyed || this.activeRequests.size >= this.maxConcurrent || this.requestQueue.length === 0) {
            return;
        }

        const { requestFn, resolve, reject } = this.requestQueue.shift();
        const requestId = performance.now() + Math.random();

        this.activeRequests.add(requestId);

        try {
            const result = await requestFn();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.activeRequests.delete(requestId);
            // 🚀 PERFORMANCE FIX: Use trackable timeout to prevent memory leaks
            if (!this.isDestroyed) {
                const timeoutId = setTimeout(() => {
                    this.processQueueTimeouts.delete(timeoutId);
                    if (!this.isDestroyed) {
                        this.processQueue();
                    }
                }, 10);
                this.processQueueTimeouts.add(timeoutId);
            }
        }
    }

    // 🚀 PERFORMANCE FIX: Enhanced cleanup with timeout management
    cancelAll() {
        this.isDestroyed = true;

        // 清除所有去抖定時器
        this.debounceTimers.forEach(timer => clearTimeout(timer));
        this.debounceTimers.clear();

        // 🚀 NEW: 清除所有processQueue timeout
        this.processQueueTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        this.processQueueTimeouts.clear();

        // 取消所有活躍的AbortController
        this.abortControllers.forEach(controller => {
            try {
                controller.abort();
            } catch (e) {
                console.warn('Error aborting request:', e);
            }
        });
        this.abortControllers.clear();

        // 清空請求隊列
        this.requestQueue.forEach(({ reject }) => {
            const error = new Error('Request cancelled');
            error.cancelled = true;  // Mark as cancelled for silent handling
            reject(error);
        });
        this.requestQueue = [];
        this.activeRequests.clear();
    }

    // 創建帶AbortController的fetch
    createAbortableFetch(url, options = {}) {
        const controller = new AbortController();
        this.abortControllers.add(controller);

        const fetchPromise = fetch(url, {
            ...options,
            signal: controller.signal
        }).finally(() => {
            this.abortControllers.delete(controller);
        });

        return { fetchPromise, controller };
    }

    // 🚀 帶重試機制的請求
    async fetchWithRetry(url, options = {}, maxRetries = 2) {
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const { fetchPromise } = this.createAbortableFetch(url, options);
                const response = await fetchPromise;

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                return response;
            } catch (error) {
                lastError = error;

                // 如果是AbortError，不重試
                if (error.name === 'AbortError') {
                    throw error;
                }

                // 如果不是最後一次嘗試，等待後重試
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // 指數退避，最多5秒
                    await new Promise(resolve => setTimeout(resolve, delay));
                    console.warn(`Request failed, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries + 1})`);
                }
            }
        }

        throw lastError;
    }
}

// ============================================================================
// 1. FETCH OPTIONS
const fetchOptions = async () => {
    return {
        field_test_data: {
            road_test: [
                // CMHK LTE bands removed per project requirement
                'xcsl_l900', 'xcsl_l1800', 'xcsl_l2600',
                'xsmt_l900', 'xsmt_l1800', 'xsmt_l2600',
                'xhut_l700', 'xhut_l900', 'xhut_l1800', 'xhut_l2300', 'xhut_l2600'
            ],
            nr_band: [
                // Other operators NR test data remain
                'xcsl_ft_nr2100_rsrp', 'xcsl_ft_nr3500_rsrp', 'xcsl_ft_nr4900_rsrp',
                'xhut_ft_nr2100_rsrp', 'xhut_ft_nr3500_rsrp',
                'xsmt_ft_nr2100_rsrp', 'xsmt_ft_nr3500_rsrp', 'xsmt_ft_nr4900_rsrp'
            ]
        },
        cmhk: {
            lte_band: ['700', '900', '1800', '2300', '2600'],
            nr_band: ['2100', '3500', '4900']
        },
        simulation_data: {
            raw_simulation: ['RAW_5G_Layer', 'RAW_4G_Layer']
        },
        complaint_: ['data_geojson', 'toc_2024', 'toc_2025'],
        Discovery_MR_Data_NR: [
            'strong_we_strong',// 競強我強
            'strong',
            'weak_we_strong',   // 競弱我強
            'weak'
        ],
        microphone_data: ['grid_highload'],
        site_structure_data: {
            planning_sites: [
                '1_高投訴', '2_重點場景', '3_弱覆蓋',
                '4_高負荷', '5_高端區域', '6_tobgn', '126 New Site', '729 Planning List'
            ],
            live_sites: [
                'Outdoor Site', 'Indoor Site', 'Indoor-Pico/Micro Site', 'Indoor + Outdoor Site'
            ]
        },
    };
};

// ============================================================================
// 2. GRID CATEGORY MAPPING & COLOR FUNCTIONS
// Here we define a mapping for the four grid cell categories.
// Each category is assigned a color and a label (for legend clarity).
const gridCategories = {
    "競強我強": { color: "#39ff23", label: "競強我強" },
    "競強我弱": { color: "#ff0000", label: "競強我弱" },
    "競弱我強": { color: "#3729ff", label: "競弱我強" },
    "競弱我弱": { color: "#606060", label: "競弱我弱" }
};

// ============================================================================
// 2.1 SITE STRUCTURE COLOR & LABEL MAPS (shared by layers and legend)
export const PLANNING_SCENARIO_COLOR_MAP = {
    '1_高投訴': '#e41a1c',
    '2_重點場景': '#377eb8',
    '3_弱覆蓋': '#4daf4a',
    '4_高負荷': '#984ea3',
    '5_高端區域': '#ff7f00',
    '6_tobgn': '#ffff33',
    '729_planning': '#8B4789',   // 729 Planning List - Purple
};

export const PLANNING_SCENARIO_LABEL_MAP = {
    '1_高投訴': '高投訴',
    '2_重點場景': '重點場景',
    '3_弱覆蓋': '弱覆蓋',
    '4_高負荷': '高負荷',
    '5_高端區域': '高端區域',
    '6_tobgn': 'To BGN',
    '729_planning': '729清單',
};

// Shape mapping for different planning scenarios
export const PLANNING_SCENARIO_SHAPE_MAP = {
    '1_高投訴': 'circle',        // High complaints - Circle (traditional)
    '2_重點場景': 'triangle',     // Important scenarios - Triangle (warning-like)
    '3_弱覆蓋': 'square',         // Weak coverage - Square
    '4_高負荷': 'diamond',        // High load - Diamond
    '5_高端區域': 'star',         // High-end area - Star
    '6_tobgn': 'hexagon',         // To BGN - Hexagon
    '729_planning': 'circle',    // 729 Planning List - Circle (default)
};

// Helper function to create different marker shapes for planning sites
const createPlanningMarker = (latlng, scenario, color, feature) => {
    const shape = PLANNING_SCENARIO_SHAPE_MAP[scenario] || 'circle';
    const baseOptions = {
        fillColor: color,
        color: '#FFFFFF',
        weight: 2,
        fillOpacity: 0.9,
    };

    // Check if this site satisfies multiple scenarios
    const satisfiedScenarios = feature.properties.satisfied_scenarios || [];
    const isMultiScenario = satisfiedScenarios.length > 1;

    // Add special styling for multi-scenario sites
    if (isMultiScenario) {
        baseOptions.weight = 3;
        baseOptions.color = '#000000'; // Black border for multi-scenario sites
    }

    switch (shape) {
        case 'triangle':
            const trianglePoints = [
                [latlng.lat + 0.0003, latlng.lng],           // top
                [latlng.lat - 0.0002, latlng.lng - 0.0002], // bottom left
                [latlng.lat - 0.0002, latlng.lng + 0.0002]  // bottom right
            ];
            return L.polygon(trianglePoints, baseOptions);

        case 'square':
            const squarePoints = [
                [latlng.lat + 0.0002, latlng.lng - 0.0002], // top left
                [latlng.lat + 0.0002, latlng.lng + 0.0002], // top right
                [latlng.lat - 0.0002, latlng.lng + 0.0002], // bottom right
                [latlng.lat - 0.0002, latlng.lng - 0.0002]  // bottom left
            ];
            return L.polygon(squarePoints, baseOptions);

        case 'diamond':
            const diamondPoints = [
                [latlng.lat + 0.0003, latlng.lng],          // top
                [latlng.lat, latlng.lng + 0.0003],          // right
                [latlng.lat - 0.0003, latlng.lng],          // bottom
                [latlng.lat, latlng.lng - 0.0003]           // left
            ];
            return L.polygon(diamondPoints, baseOptions);

        case 'star':
            const starPoints = [];
            const outerRadius = 0.0003;
            const innerRadius = 0.00015;
            for (let i = 0; i < 10; i++) {
                const angle = (i * Math.PI) / 5;
                const radius = i % 2 === 0 ? outerRadius : innerRadius;
                const lat = latlng.lat + Math.sin(angle) * radius;
                const lng = latlng.lng + Math.cos(angle) * radius;
                starPoints.push([lat, lng]);
            }
            return L.polygon(starPoints, baseOptions);

        case 'hexagon':
            const hexPoints = [];
            for (let i = 0; i < 6; i++) {
                const angle = (i * Math.PI) / 3;
                const lat = latlng.lat + Math.sin(angle) * 0.0002;
                const lng = latlng.lng + Math.cos(angle) * 0.0002;
                hexPoints.push([lat, lng]);
            }
            return L.polygon(hexPoints, baseOptions);

        case 'circle':
        default:
            return L.circleMarker(latlng, {
                ...baseOptions,
                radius: isMultiScenario ? 10 : 8, // Slightly larger for multi-scenario
            });
    }
};

// Helper function to create different marker shapes with custom options
// Now supports zoom-dependent sizing for better visibility across zoom levels
const createShapedMarker = (latlng, shape, options, currentZoom = 13) => {
    const baseOptions = {
        fillColor: '#ff0000',
        color: '#FFFFFF',
        weight: 1,
        fillOpacity: 0.6,
        ...options
    };

    // Calculate zoom-dependent size multiplier
    // INVERTED LOGIC: Larger markers when zoomed out for better visibility
    // At zoom 11-12: largest markers (2.0x) - easy to notice from far
    // At zoom 13-14: large markers (1.5x)
    // At zoom 15-16: medium markers (1.0x)
    // At zoom 17+: smallest markers (0.7x) - detailed view
    let sizeMultiplier;
    if (currentZoom >= 17) {
        sizeMultiplier = 0.7;
    } else if (currentZoom >= 15) {
        sizeMultiplier = 1.0;
    } else if (currentZoom >= 13) {
        sizeMultiplier = 1.5;
    } else if (currentZoom >= 11) {
        sizeMultiplier = 2.0;
    } else {
        sizeMultiplier = 2.5;
    }

    switch (shape) {
        case 'triangle':
            const baseTriangleTop = 0.0003 * sizeMultiplier;
            const baseTriangleBottom = 0.0002 * sizeMultiplier;
            const trianglePoints = [
                [latlng.lat + baseTriangleTop, latlng.lng],           // top
                [latlng.lat - baseTriangleBottom, latlng.lng - baseTriangleBottom], // bottom left
                [latlng.lat - baseTriangleBottom, latlng.lng + baseTriangleBottom]  // bottom right
            ];
            return L.polygon(trianglePoints, baseOptions);

        case 'square':
            const baseSquareSize = 0.0002 * sizeMultiplier;
            const squarePoints = [
                [latlng.lat + baseSquareSize, latlng.lng - baseSquareSize], // top left
                [latlng.lat + baseSquareSize, latlng.lng + baseSquareSize], // top right
                [latlng.lat - baseSquareSize, latlng.lng + baseSquareSize], // bottom right
                [latlng.lat - baseSquareSize, latlng.lng - baseSquareSize]  // bottom left
            ];
            return L.polygon(squarePoints, baseOptions);

        case 'diamond':
            const baseDiamondSize = 0.0003 * sizeMultiplier;
            const diamondPoints = [
                [latlng.lat + baseDiamondSize, latlng.lng],          // top
                [latlng.lat, latlng.lng + baseDiamondSize],          // right
                [latlng.lat - baseDiamondSize, latlng.lng],          // bottom
                [latlng.lat, latlng.lng - baseDiamondSize]           // left
            ];
            return L.polygon(diamondPoints, baseOptions);

        case 'hexagon':
            const baseHexSize = 0.00025 * sizeMultiplier;
            const hexPoints = [
                [latlng.lat + baseHexSize, latlng.lng],                    // top
                [latlng.lat + baseHexSize * 0.5, latlng.lng + baseHexSize * 0.866], // top right
                [latlng.lat - baseHexSize * 0.5, latlng.lng + baseHexSize * 0.866], // bottom right
                [latlng.lat - baseHexSize, latlng.lng],                    // bottom
                [latlng.lat - baseHexSize * 0.5, latlng.lng - baseHexSize * 0.866], // bottom left
                [latlng.lat + baseHexSize * 0.5, latlng.lng - baseHexSize * 0.866]  // top left
            ];
            return L.polygon(hexPoints, baseOptions);

        case 'circle':
        default:
            // Zoom-dependent radius for circle markers
            const baseRadius = Math.max(3, Math.min(10, currentZoom - 7));
            return L.circleMarker(latlng, {
                ...baseOptions,
                radius: baseRadius,
            });
    }
};

export const LIVE_SITE_TYPE_COLOR_MAP = {
    // Frontend keys - all set to dark red
    'Outdoor Site': '#8b0000',              // Dark red
    'Indoor Site': '#8b0000',               // Dark red 
    'Indoor-Pico/Micro Site': '#8b0000',    // Dark red
    'Indoor + Outdoor Site': '#8b0000',     // Dark red

    // Database keys for backward compatibility (if needed elsewhere)
    'Indoor': '#8b0000',
    'Indoor-Micro': '#8b0000',
    'Indoor + Outdoor': '#8b0000',
    'Indoor-Pico': '#8b0000',
    'Outdoor': '#8b0000',
};

// When given a category value (string), return its color.
const getDiscoveryMRColor = (value) => {
    return gridCategories[value] ? gridCategories[value].color : '#FFFFFF';
};

// (Keep your existing functions for RSRP and complaint data)
const getRSRPColor = (rsrp) => {
    if (rsrp >= -70) return '#006837';
    else if (rsrp >= -80) return '#1a9850';
    else if (rsrp >= -90) return '#66bd63';
    else if (rsrp >= -100) return '#d9ef8b';
    else if (rsrp >= -110) return '#fdae61';
    else if (rsrp >= -120) return '#d73027';
    else return '#a50026';
};

// SINR color
const getSINRColor = (sinr) => {
    if (sinr > 0) return '#91cebf';
    else if (sinr >= -3) return '#e4d49a';
    else return '#9a641f';
};

// Single color for complaint grids
const getComplaintColor = () => '#d17021';

// Single color for 高負荷數據 (microphone data / high load data)
const getHighLoadColor = (util) => '#d1b226';

// Single color for simulation data
const getSimulationColor = () => '#690562';

// ============================================================================
// 🚀 NEW: Create tree data structure for 126 New Site filtering
const createNewSiteTreeData = (activatedCount = 0) => {
    return [
        {
            key: 'SAF',
            label: 'SAF',
            children: [
                { key: 'SAF-室內', label: '室內' },  // Changed from SAF_室内
                { key: 'SAF-室外', label: '室外' }   // Changed from SAF_室外
            ]
        },
        {
            key: '新站',
            label: '新站',
            children: [
                { key: '新站-室內', label: '室內' },  // Changed from 新站_室内
                { key: '新站-室外', label: '室外' }   // Changed from 新站_室外
            ]
        },
        {
            key: 'NCR',
            label: 'NCR',
            children: [
                { key: 'NCR-室內', label: '室內' },   // Changed from NCR_室内
                { key: 'NCR-室外', label: '室外' }    // Changed from NCR_室外
            ]
        },
        {
            key: '已開通站點',
            label: '已開通站點',
            count: activatedCount,  // Add count to display next to the label
            children: []  // No sub-children - this shows all activated sites from SAF, 新站, and NCR
        }
    ];
};

// ============================================================================
// 3. STYLING FUNCTION
// This function chooses a fill color based on properties.
// For Discovery MR data, it uses the category (pre-computed or provided by the backend).
const style = (feature) => {
    const props = feature.properties;
    let fillColor = '#FFFFFF';

    // —— 先前已有逻辑 ——  
    if ('highcomplaint' in props) {
        fillColor = getComplaintColor();
    } else if ('rsrp_value' in props) {
        fillColor = getRSRPColor(props.rsrp_value);
    } else if ('lte_rsrp' in props) {
        fillColor = getRSRPColor(props.lte_rsrp);
    } else if (props.category) {
        fillColor = getDiscoveryMRColor(props.category);
    }
    // —— 新增：高负荷场景 ——  
    else if (props.s_dl_prb_util !== undefined) {
        fillColor = getHighLoadColor();
    }

    return {
        fillColor,
        weight: 2,
        opacity: 1,
        color: 'white',
        fillOpacity: 0.7
    };
};

// ============================================================================
// 4. LEGEND CONTROL - REMOVED (unused function)

// ============================================================================
// 5. HELPER: SUBDIVIDE BOUNDS
function subdivideBounds(bounds, divisions = 2) {
    const west = bounds.getWest();
    const east = bounds.getEast();
    const north = bounds.getNorth();
    const south = bounds.getSouth();

    const latStep = (north - south) / divisions;
    const lngStep = (east - west) / divisions;

    const boxes = [];
    for (let i = 0; i < divisions; i++) {
        for (let j = 0; j < divisions; j++) {
            const boxNorth = north - latStep * i;
            const boxSouth = north - latStep * (i + 1);
            const boxWest = west + lngStep * j;
            const boxEast = west + lngStep * (j + 1);
            boxes.push({ west: boxWest, east: boxEast, north: boxNorth, south: boxSouth });
        }
    }
    return boxes;
}

// ============================================================================
// 定義香港邊界常量（組件外部）
const HONG_KONG_BOUNDS = [[22.137, 113.835], [22.58, 114.43]];

// ============================================================================
// 6. MAIN COMPONENT: TelecomMap
const TelecomMap = () => {
    // State for planning site layer (removed unused planningLayer)
    const mapRef = useRef(null);
    const fetchCacheRef = useRef(new Map());
    const requestManagerRef = useRef(new APIRequestManager(4, 300)); // 最多4個並發請求，300ms去抖
    // 🚀 PERFORMANCE FIX: Add synchronization for state updates
    const layerUpdateLockRef = useRef(false);
    const pendingLayerUpdatesRef = useRef([]);
    // 🚀 NEW: Zoom performance optimization refs
    const zoomProcessingRef = useRef(false);
    const lastZoomTimeRef = useRef(0);
    const zoomTimeoutRef = useRef(null);
    const zoomRefreshTimeoutRef = useRef(null); // For debouncing zoom-based marker refresh
    // 🚀 MEMORY LEAK FIX: Refs to track all setTimeout IDs for proper cleanup
    const zoomEndTimeoutRef = useRef(null); // Line 839 - zoomend performance mode cleanup
    const moveEndTimeoutRef = useRef(null); // Line 880 - moveend performance mode cleanup
    const layerLockTimeoutRef = useRef(null); // Line 2923 - layer update lock cleanup
    const clusteringProgressTimeoutRef = useRef(null); // Line 4787 - clustering progress cleanup
    const isMountedRef = useRef(true); // Track mount status to prevent setState on unmounted component
    const selectedBandsRef = useRef([]); // Track current selected bands for zoom refresh
    const h3ZoomListenerRef = useRef(null); // Track H3 base station zoom event listener
    const [options, setOptions] = useState({});
    // removed bounds state
    const [selectedBands, setSelectedBands] = useState([]);
    const [layers, setLayers] = useState({});
    const [highlightedLayer, setHighlightedLayer] = useState(null);
    const [isOptionsVisible, setIsOptionsVisible] = useState(false);
    const [otherOptions, setOtherOptions] = useState({});
    const [isOtherOptionsVisible, setIsOtherOptionsVisible] = useState(false);


    // 🚀 錯誤處理狀態
    const [errorState, setErrorState] = useState(null);
    const [retryAttempts, setRetryAttempts] = useState(0);
    // Region and micro grid related states (using hardcoded data, no fetching needed)
    const [selectedMicroGrids, setSelectedMicroGrids] = useState([]);
    const [microGridLayerGroup, setMicroGridLayerGroup] = useState(null);
    // NEW: Keep track of individual micro grid layers to avoid full refresh
    const microGridLayersRef = useRef({});

    // 🚀 NEW: Basemap switching state
    const [currentBasemap, setCurrentBasemap] = useState('osm'); // 'osm' or 'carto'
    const baseLayerRef = useRef(null);

    // 🚀 NEW: Rendering mode state ('global' or 'spatial')
    const [renderingMode, setRenderingMode] = useState('global');

    // 🚀 NEW: Site detail window states
    const [showSiteDetail, setShowSiteDetail] = useState(false);
    const [selectedSiteData, setSelectedSiteData] = useState(null);
    const lastVectorClickRef = useRef({ id: null, ts: 0 });

    // 🚀 NEW: Grid detail panel states
    const [showGridDetail, setShowGridDetail] = useState(false);

    // 🚀 NEW: Complaint chart visibility state
    const [complaintChartVisible, setComplaintChartVisible] = useState(true);

    // 🚀 NEW: Site clustering analysis states
    // 🚀 Clustering state and configuration - optimized for HK telecom analysis
    const clusteringConfig = {
        epsilon: 600,       // 800m radius - realistic for macro cell overlap in dense urban HK
        minPoints: 5,       // minimum 4 sites to identify truly high-density areas
        distanceUnit: 'meter'
    };
    const [clusteringData, setClusteringData] = useState(null);
    const [isClusteringActive, setIsClusteringActive] = useState(false);
    const [isClusteringLoading, setIsClusteringLoading] = useState(false);
    const [clusteringProgress, setClusteringProgress] = useState(0);
    const clusterLayerGroupRef = useRef(null);
    const noiseLayerGroupRef = useRef(null);
    const [selectedGridData, setSelectedGridData] = useState(null);
    const [isDashboardVisible, setIsDashboardVisible] = useState(false);
    const [dashboardPosition, setDashboardPosition] = useState('top-right');

    // 🚀 NEW: Planning site selection states
    const [selectedNewSiteKeys, setSelectedNewSiteKeys] = useState([]);

    // 🚀 NEW: Activated sites count state
    const [activatedSitesCount, setActivatedSitesCount] = useState(0);

    // --------------------------------------------------------------------------
    // 🚀 PERFORMANCE OPTIMIZATION: Memoized computed values to prevent redundant calculations
    // These useMemo hooks eliminate repeated array transformations on every render

    // #1: Memoize microGridIds (HIGH PRIORITY - eliminates 3x redundant computation)
    // Used in: buildMVTUrl, buildApiUrl, buildGridDetailsUrl
    const microGridIds = useMemo(() =>
        selectedMicroGrids.map(grid =>
            typeof grid === 'object' ? grid.id : grid
        ),
        [selectedMicroGrids]
    );

    // #2: Memoize simulationBands filter
    // Used in: renderingMode toggle logic
    const simulationBands = useMemo(() =>
        selectedBands.filter(band =>
            band.startsWith('simulation_data_raw_simulation_') ||
            band.includes('RAW_5G_Layer') ||
            band.includes('RAW_4G_Layer') ||
            band.includes('raw_simulation')
        ),
        [selectedBands]
    );

    // #3: Memoize sixDimensionLayers filter
    // Used in: renderingMode change cleanup
    const sixDimensionLayers = useMemo(() =>
        Object.keys(layers).filter(key =>
            key.startsWith('simulation_data_') ||
            key.startsWith('complaint_') ||
            key.startsWith('Discovery_MR_Data_NR') ||
            key.startsWith('microphone_data') ||
            key.startsWith('site_structure_data_') ||
            key.startsWith('cmhk_test_data_')
        ),
        [layers]
    );

    // #4: Memoize cmhkTestBands filter
    // Used in: data fetching logic
    const cmhkTestBands = useMemo(() =>
        selectedBands.filter(band =>
            band.startsWith('testing_data_lte_cmhk_') ||
            band.startsWith('testing_data_nr_cmhk_')
        ),
        [selectedBands]
    );

    // #5: Memoize sixDimensionBands filter
    // Used in: data fetching and layer management
    const sixDimensionBands = useMemo(() =>
        selectedBands.filter(band =>
            band.startsWith('simulation_data_') ||
            band.startsWith('complaint_') ||
            band.startsWith('Discovery_MR_Data_NR') ||
            band.startsWith('microphone_data') ||
            band.startsWith('cmhk_test_data_')
        ),
        [selectedBands]
    );

    // #6: Memoize otherTestBands filter
    // Used in: data fetching logic
    const otherTestBands = useMemo(() =>
        selectedBands.filter(band =>
            band.startsWith('testing_data_') && !band.includes('cmhk_')
        ),
        [selectedBands]
    );

    // #7: Memoize siteBands filter
    // Used in: site data loading
    const siteBands = useMemo(() =>
        selectedBands.filter(band =>
            band.startsWith('site_structure_data_') ||
            band.startsWith('complaint__toc_')
        ),
        [selectedBands]
    );

    // #8: Memoize normalSixDimensionBands filter (depends on #5)
    // Used in: data fetching logic
    const normalSixDimensionBands = useMemo(() =>
        sixDimensionBands.filter(band =>
            !band.startsWith('site_structure_data_')
        ),
        [sixDimensionBands]
    );

    // --------------------------------------------------------------------------
    // Initialize map & add legend control
    useEffect(() => {
        // 🚀 INITIALIZATION CLEANUP: Remove any leftover performance classes
        document.body.classList.remove('zooming-performance-mode', 'moving-performance-mode');

        // 1. Create a new map instance on the 'map' div.
        const map = L.map('map', {
            center: [22.3964, 114.1095],
            zoom: 11,
            maxBounds: HONG_KONG_BOUNDS,
            maxBoundsViscosity: 1.0,
            zoomControl: false,
            attributionControl: false,
            preferCanvas: true,
            maxZoom: 18,
            minZoom: 10,
        });

        // 2. Store the new instance in the ref.
        mapRef.current = map;

        // 3. Add the initial base tile layer.
        let initialBaseLayer;

        if (USE_LOCAL_TILES) {
            // Use local vector tiles for isolated environment
            initialBaseLayer = L.vectorGrid.protobuf(LOCAL_TILE_URL, {
                attribution: '© Local Hong Kong Base Map',
                maxZoom: 18,
                minZoom: 10,
                vectorTileLayerStyles: {
                    // Simple default styling for all layers in the vector tiles
                    'water': {
                        fill: true,
                        fillColor: '#a8d4f2',
                        fillOpacity: 1,
                        stroke: false
                    },
                    'transportation': {
                        color: '#fff',
                        weight: 1
                    },
                    'building': {
                        fill: true,
                        fillColor: '#d9d0c9',
                        fillOpacity: 0.4,
                        stroke: true,
                        color: '#c9c0b9',
                        weight: 0.5
                    },
                    'landuse': {
                        fill: true,
                        fillColor: '#e8eddb',
                        fillOpacity: 0.3,
                        stroke: false
                    },
                    'park': {
                        fill: true,
                        fillColor: '#c8df9f',
                        fillOpacity: 0.5,
                        stroke: false
                    },
                    'boundary': {
                        color: '#9e9cab',
                        weight: 1,
                        dashArray: '5, 5'
                    },
                    'aeroway': {
                        fill: true,
                        fillColor: '#dadbdf',
                        fillOpacity: 0.5,
                        stroke: true,
                        color: '#c0c0c8',
                        weight: 1
                    },
                    'transportation_name': {},
                    'place': {},
                    'poi': {},
                    // Default style for any other layers
                    '__default__': {
                        fill: true,
                        fillColor: '#f2efe9',
                        fillOpacity: 0.3,
                        stroke: true,
                        color: '#c9c0b9',
                        weight: 0.5
                    }
                },
                interactive: false, // Base map doesn't need to be interactive
                getFeatureId: function (f) {
                    return f.properties.id || f.properties.osm_id;
                }
            });
        } else {
            // Use external raster tiles (original behavior)
            initialBaseLayer = L.tileLayer(OSM_TILE_URL, {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19,
                minZoom: 10,
                noWrap: true,
                crossOrigin: true
            });
        }

        initialBaseLayer.addTo(map);
        baseLayerRef.current = initialBaseLayer;

        // 4. Create all necessary map panes for layer ordering.
        // 基于用户需求的理想分层方案：
        const panes = [
            'baseFrameworkPane',    // 基础地理框架层（最底层）：微网格边界等基础参考框架
            'gridDataPane',         // 网格业务数据层（中间层）：投诉数据、MR数据、高负荷数据、仿真数据等 (六维数据)
            'planningSitesPane',    // 站点数据层-规划站点
            'complaintsPane',        // 站点数据层-实际运行站点  
            'liveSitesPane',        // 站点数据层-实际运行站点  
            'competitiveSitesPane', // 站点数据层-竞对站点
            'newSitesPane',         // 站点数据层-126新站点
            'highlightPane'         // 高亮元素层（最顶层）：用户交互时临时置顶的元素
        ];
        let zIndex = 350;
        panes.forEach(paneName => {
            if (!map.getPane(paneName)) {
                map.createPane(paneName);
                const pane = map.getPane(paneName);
                if (pane) {
                    pane.style.zIndex = zIndex;
                    zIndex += 25;
                }
            }
        });

        // 🚀 ZOOM PERFORMANCE: Add zoom event handlers for smooth interaction
        let zoomStartTime = 0;

        map.on('zoomstart', () => {
            zoomStartTime = performance.now();
            // Temporarily reduce visual complexity during zoom
            if (!document.body.classList.contains('zooming-performance-mode')) {
                document.body.classList.add('zooming-performance-mode');
            }
        });

        map.on('zoomend', () => {
            const zoomDuration = performance.now() - zoomStartTime;

            // 🚀 MEMORY LEAK FIX: Clear any pending timeout before creating new one
            if (zoomEndTimeoutRef.current) {
                clearTimeout(zoomEndTimeoutRef.current);
            }

            // Restore visual complexity after zoom with longer delay for better stability
            zoomEndTimeoutRef.current = setTimeout(() => {
                document.body.classList.remove('zooming-performance-mode');
                // Reset zoom processing flag after performance mode is disabled
                zoomProcessingRef.current = false;
                zoomEndTimeoutRef.current = null; // Clear ref after execution
            }, 200); // Increased from 100ms to 200ms for smoother transition

            // 🚀 Reload live sites and competitive sites to update marker sizes based on new zoom level
            // Use a debounced approach to avoid excessive reloading during rapid zoom changes
            if (zoomRefreshTimeoutRef.current) {
                clearTimeout(zoomRefreshTimeoutRef.current);
            }
            zoomRefreshTimeoutRef.current = setTimeout(() => {
                // Extract current site selections from selectedBands
                const currentSelectedBands = selectedBandsRef.current || [];

                const liveSites = currentSelectedBands
                    .filter(band => band.startsWith('site_structure_data_live_sites_'))
                    .map(band => band.replace('site_structure_data_live_sites_', ''));

                const competitiveSites = currentSelectedBands
                    .filter(band => band.startsWith('site_structure_data_competitive_sites_'))
                    .map(band => band.replace('site_structure_data_competitive_sites_', ''));

                // Reload layers only if they are currently selected
                if (liveSites.length > 0) {
                    loadLiveSites(liveSites).catch(err => console.error('Error reloading live sites on zoom:', err));
                }
                if (competitiveSites.length > 0) {
                    loadCompetitiveSites(competitiveSites).catch(err => console.error('Error reloading competitive sites on zoom:', err));
                }
            }, 300); // Wait 300ms after zoom ends to reload
        });

        // Additional performance event handlers
        map.on('movestart', () => {
            if (!document.body.classList.contains('moving-performance-mode')) {
                document.body.classList.add('moving-performance-mode');
            }
        });

        map.on('moveend', () => {
            // 🚀 MEMORY LEAK FIX: Clear any pending timeout before creating new one
            if (moveEndTimeoutRef.current) {
                clearTimeout(moveEndTimeoutRef.current);
            }

            moveEndTimeoutRef.current = setTimeout(() => {
                document.body.classList.remove('moving-performance-mode');
                moveEndTimeoutRef.current = null; // Clear ref after execution
            }, 100); // Increased from 50ms to 100ms for better stability
        });

        // 🚀 FAILSAFE: Ensure performance classes are removed on any interaction
        map.on('click', () => {
            document.body.classList.remove('zooming-performance-mode', 'moving-performance-mode');
        });

        // 5. Set initial view when the map is ready.
        map.whenReady(() => {
            if (mapRef.current) { // Check ref in case of rapid unmount
                mapRef.current.fitBounds(HONG_KONG_BOUNDS);
            }
        });

        // 6. Define the cleanup function. This will run when the component unmounts.
        return () => {
            // 🚀 MEMORY LEAK FIX: Mark component as unmounted FIRST to prevent setState
            isMountedRef.current = false;

            // 🚀 MEMORY LEAK FIX: Clear all pending timeouts to prevent callbacks on unmounted component
            if (zoomEndTimeoutRef.current) {
                clearTimeout(zoomEndTimeoutRef.current);
                zoomEndTimeoutRef.current = null;
            }
            if (moveEndTimeoutRef.current) {
                clearTimeout(moveEndTimeoutRef.current);
                moveEndTimeoutRef.current = null;
            }
            if (layerLockTimeoutRef.current) {
                clearTimeout(layerLockTimeoutRef.current);
                layerLockTimeoutRef.current = null;
            }
            if (clusteringProgressTimeoutRef.current) {
                clearTimeout(clusteringProgressTimeoutRef.current);
                clusteringProgressTimeoutRef.current = null;
            }
            if (zoomTimeoutRef.current) {
                clearTimeout(zoomTimeoutRef.current);
                zoomTimeoutRef.current = null;
            }
            if (zoomRefreshTimeoutRef.current) {
                clearTimeout(zoomRefreshTimeoutRef.current);
                zoomRefreshTimeoutRef.current = null;
            }

            if (mapRef.current) {
                try {
                    // Remove all event listeners from the map instance
                    mapRef.current.off();

                    // Remove all non-basemap layers
                    mapRef.current.eachLayer((layer) => {
                        if (!(layer instanceof L.TileLayer)) {
                            try {
                                mapRef.current.removeLayer(layer);
                            } catch (e) {
                                console.warn('Error removing layer during cleanup:', e);
                            }
                        }
                    });

                    // Completely remove the map instance
                    mapRef.current.remove();
                } catch (e) {
                    console.warn('Error during map cleanup:', e);
                } finally {
                    mapRef.current = null;
                }
            }

            // Also clean up any other global resources or timers
            const currentRequestManager = requestManagerRef.current;
            if (currentRequestManager) {
                currentRequestManager.cancelAll();
            }

            // 🚀 CLEANUP: Remove performance classes on unmount
            document.body.classList.remove('zooming-performance-mode', 'moving-performance-mode');
        };
    }, []); // The empty dependency array ensures this runs only on mount and unmount.


    // --------------------------------------------------------------------------
    // Fetch band options
    useEffect(() => {
        (async () => {
            const res = await fetchOptions();

            // Split non-CMHK for LTE and NR (CMHK data now part of Six-Dimension data as separate provider)
            const nonCmhkRoad = (res.field_test_data.road_test || []).filter(b => !b.startsWith('cmhk'));
            const nonCmhkNr = (res.field_test_data.nr_band || []).filter(b => !b.startsWith('cmhk'));

            // 六維數據：六維数据（現在包含6個類別）
            const mainOptions = {
                complaint_: res.complaint_ || [],          // 1. 投訴數據
                Discovery_MR_Data_NR: res.Discovery_MR_Data_NR || [], // 2. MR 競對數據
                simulation_data: res.simulation_data || {},           // 3. 仿真數據
                microphone_data: res.microphone_data || [],           // 4. 高負荷數據
                site_structure_data: {                                // 5. 站點結構數據
                    ...(res.site_structure_data || {}),
                    competitive_sites: [
                        'hkt4g_1800_indoor', 'hkt4g_1800_outdoor',
                        'hkt4g_900_indoor', 'hkt4g_900_outdoor',
                        'hkt2025_sites_indoor', 'hkt2025_sites_outdoor',
                        'hut_sites_indoor', 'hut_sites_outdoor',
                        'smt_sites_indoor', 'smt_sites_outdoor',
                        'h3_sites'
                    ] // 5.3 競對站點
                },
                cmhk_test_data: {                                     // 6. 測試數據
                    lte_competition: ['競強我強', '競強我弱', '競弱我強', '競弱我弱'],     // 6.1 LTE 競對場景
                    nr_competition: ['競強我強', '競強我弱', '競弱我強', '競弱我弱']       // 6.2 NR 競對場景
                }
            };
            setOptions(mainOptions);


            // 其他測試數據：合併CMHK和非CMHK測試數據，按LTE/NR分組
            const cmhkLteBands = (res.cmhk?.lte_band || ['700', '900', '1800', '2300', '2600']).map(band => `cmhk_${band}`);
            const cmhkNrBands = (res.cmhk?.nr_band || ['2100', '3500', '4900']).map(band => `cmhk_${band}`);

            const other = {
                testing_data: {
                    lte: [...cmhkLteBands, ...nonCmhkRoad],           // 合併CMHK LTE + 非CMHK LTE
                    nr: [...cmhkNrBands, ...nonCmhkNr]                // 合併CMHK NR + 非CMHK NR
                }
            };
            setOtherOptions(other);
        })();
    }, []);

    // 🚀 NEW: Fetch activated sites count on component mount
    useEffect(() => {
        const fetchActivatedSitesCount = async () => {
            try {
                const response = await fetch(`${EXTERNAL_SERVER_URL}/126_activated_sites`);
                if (response.ok) {
                    const data = await response.json();
                    const count = (data.features || []).length;
                    setActivatedSitesCount(count);
                } else {
                    console.warn('Failed to fetch activated sites count');
                }
            } catch (error) {
                console.error('Error fetching activated sites count:', error);
            }
        };

        fetchActivatedSitesCount();
    }, []);

    // 🚀 REMOVED: Backend fetching for static data - now using hardcoded data
    // Data is now provided by DistrictMicroGridData.js with instant access

    // --------------------------------------------------------------------------
    // 🚀 UNIFIED: Map interaction control for all scenarios (grid detail panel, loading states, etc.)
    const handleMapInteractionChange = useCallback((enabled) => {
        if (!mapRef.current) return;

        if (enabled) {
            // Enable all map interactions
            mapRef.current.dragging.enable();
            mapRef.current.touchZoom.enable();
            mapRef.current.doubleClickZoom.enable();
            mapRef.current.scrollWheelZoom.enable();
            mapRef.current.boxZoom.enable();
            mapRef.current.keyboard.enable();

            // Remove loading cursor style if present
            mapRef.current.getContainer().style.cursor = '';
        } else {
            // Disable all map interactions
            mapRef.current.dragging.disable();
            mapRef.current.touchZoom.disable();
            mapRef.current.doubleClickZoom.disable();
            mapRef.current.scrollWheelZoom.disable();
            mapRef.current.boxZoom.disable();
            mapRef.current.keyboard.disable();

            // Add loading cursor style
            mapRef.current.getContainer().style.cursor = 'wait';
        }
    }, []);

    // --------------------------------------------------------------------------
    // 🚀 REUSABLE: Click deduplication utility function
    const isClickDuplicate = useCallback((grid_id, debounceMs = 600) => {

        if (!grid_id) {
            return true; // Invalid grid_id is considered duplicate
        }

        const now = Date.now();

        if (lastVectorClickRef.current &&
            lastVectorClickRef.current.id === grid_id &&
            (now - lastVectorClickRef.current.ts) < debounceMs) {
            return true; // This is a duplicate click
        }

        // Update the last click record
        lastVectorClickRef.current = { id: grid_id, ts: now };
        return false; // This is not a duplicate click
    }, []);

    // --------------------------------------------------------------------------
    // 🚀 API HELPER FUNCTIONS: Integrate all fetch calls with APIRequestManager

    // Standard API fetch with retry and rate limiting
    const apiRequest = useCallback(async (url, options = {}) => {
        return await requestManagerRef.current.fetchWithRetry(url, options);
    }, []);

    // Debounced API fetch for rapid requests (like grid details)
    const debouncedApiRequest = useCallback(async (key, url, options = {}) => {
        return await requestManagerRef.current.debounceRequest(key, () =>
            requestManagerRef.current.fetchWithRetry(url, options)
        );
    }, []);

    // Simple queued fetch for non-critical requests
    const queuedApiRequest = useCallback(async (url, options = {}) => {
        return await requestManagerRef.current.enqueueRequest(() =>
            requestManagerRef.current.fetchWithRetry(url, options)
        );
    }, []);


    // --------------------------------------------------------------------------
    // 🚀 NEW: Basemap switching function - Cycles through OSM → Carto → Local HK MBTiles
    const toggleBasemap = useCallback(() => {
        if (!mapRef.current || !baseLayerRef.current) return;

        // Remove current base layer
        mapRef.current.removeLayer(baseLayerRef.current);

        // Create new base layer - cycle through osm → carto → local → osm
        let newBasemap, newBaseLayer;

        if (currentBasemap === 'osm') {
            newBasemap = 'carto';
            newBaseLayer = L.tileLayer(CARTO_TILE_URL, {
                attribution: '© CARTO © OpenStreetMap contributors',
                maxZoom: 19,
                minZoom: 10,
                noWrap: true,
                crossOrigin: true
            });
        } else if (currentBasemap === 'carto') {
            newBasemap = 'local';
            newBaseLayer = L.vectorGrid.protobuf(LOCAL_TILE_URL, {
                rendererFactory: L.canvas.tile,
                maxNativeZoom: 14,
                vectorTileLayerStyles: {
                    'water': {
                        fill: true,
                        fillColor: '#a0c8f0',
                        fillOpacity: 0.7,
                        weight: 0
                    },
                    'waterway': {
                        color: '#a0c8f0',
                        weight: 1,
                        opacity: 0.7
                    },
                    'building': {
                        fill: true,
                        fillColor: '#d9d0c9',
                        fillOpacity: 0.6,
                        color: '#bbb',
                        weight: 0.5
                    },
                    'road': {
                        color: '#fff',
                        weight: 1,
                        opacity: 0.8
                    },
                    'transportation': {
                        color: '#fff',
                        weight: 1,
                        opacity: 0.8
                    },
                    'landuse': {
                        fill: true,
                        fillColor: '#e8eddb',
                        fillOpacity: 0.3,
                        weight: 0
                    },
                    'park': {
                        fill: true,
                        fillColor: '#c8e6c9',
                        fillOpacity: 0.5,
                        weight: 0
                    },
                    'boundary': {
                        color: '#9e9cab',
                        weight: 1,
                        opacity: 0.5,
                        dashArray: '5, 5'
                    },
                    'place': {
                        fill: false,
                        weight: 0
                    }
                }
            });
        } else {
            // local → osm
            newBasemap = 'osm';
            newBaseLayer = L.tileLayer(OSM_TILE_URL, {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19,
                minZoom: 10,
                noWrap: true,
                crossOrigin: true
            });
        }

        // Add new base layer and update references
        newBaseLayer.addTo(mapRef.current);
        baseLayerRef.current = newBaseLayer;
        setCurrentBasemap(newBasemap);

        // Ensure the base layer stays behind other layers
        if (newBaseLayer.bringToBack) {
            newBaseLayer.bringToBack();
        }

        console.log(`Switched basemap to: ${newBasemap}`);
    }, [currentBasemap]);

    // --------------------------------------------------------------------------  
    // 🚀 NEW: Complaint chart visibility toggle function
    const toggleComplaintChart = useCallback(() => {
        // Simply toggle the entire dashboard
        // The complaint chart is always visible when dashboard is shown
        setIsDashboardVisible(!isDashboardVisible);
        // Keep complaint chart always visible when dashboard is shown
        if (!isDashboardVisible) {
            setComplaintChartVisible(true);
        }
    }, [isDashboardVisible]);

    // --------------------------------------------------------------------------  
    // 🚀 NEW: Rendering mode toggle function
    const toggleRenderingMode = useCallback(() => {
        const newMode = renderingMode === 'global' ? 'spatial' : 'global';
        console.log(`🔄 [Rendering Mode] Switching: ${renderingMode} → ${newMode}`);
        console.log(`🔄 [Rendering Mode] Currently selected microgrids:`, selectedMicroGrids.length > 0 ? selectedMicroGrids.map(g => g.id || g).join(', ') : 'None');
        setRenderingMode(newMode);

        // 🚫 AUTO-BLOCK: When switching to spatial (region) mode, automatically remove simulation raw data
        if (newMode === 'spatial') {
            // 🚀 PERFORMANCE: Use memoized simulationBands instead of inline computation
            if (simulationBands.length > 0) {
                console.log(`🚫 [Auto-Block] Removing simulation raw data in region mode:`, simulationBands);
                // Remove simulation bands from selection
                const nonSimulationBands = selectedBands.filter(band => !simulationBands.includes(band));
                setSelectedBands(nonSimulationBands);

                // Show user-friendly notification
                alert('區域模式下無法渲染仿真原數據 (5G/4G)。\n仿真原數據已自動取消選擇。\n如需查看仿真原數據，請切換回全域模式。');
            }
        }

        // 🔄 COMPLETE RESET: When switching back to global mode, reset everything to initial state
        if (newMode === 'global') {
            console.log(`🔄 [Reset] Switching to global mode - resetting all state to initial values`);

            // Clear all selected microgrids
            setSelectedMicroGrids([]);

            // Clear all selected data bands
            setSelectedBands([]);

            // Remove micro grid layer group from map
            if (microGridLayerGroup && mapRef.current) {
                try {
                    mapRef.current.removeLayer(microGridLayerGroup);
                } catch (e) {
                    console.warn('Error removing micro grid layer group:', e);
                }
            }
            setMicroGridLayerGroup(null);

            // Clear micro grid layers ref
            if (microGridLayersRef.current) {
                microGridLayersRef.current = {};
            }

            // Close ALL selection panels (region, six-dimension data, other test data)
            setIsRegionVisible(false);
            setIsOptionsVisible(false);
            setIsOtherOptionsVisible(false);

            // Close grid detail window
            setShowGridDetail(false);
            setSelectedGridData(null);

            // Clear clustering data
            setClusteringData(null);
            setIsClusteringActive(false);
            setIsClusteringLoading(false);
            setClusteringProgress(0);

            // Close site detail window
            setShowSiteDetail(false);
            setSelectedSiteData(null);

            // Clear dashboard visibility
            setIsDashboardVisible(false);

            // Clear activated sites count
            setActivatedSitesCount(0);
            setSelectedNewSiteKeys([]);

            // Clear error state
            setErrorState(null);
            setRetryAttempts(0);

            console.log(`✅ [Reset] All state reset to initial values`);
        }

        // Clear ALL six-dimension data layers when switching modes
        // This ensures no layers persist between mode switches
        // 🚀 PERFORMANCE: Use memoized sixDimensionLayers instead of inline computation

        // Remove all six-dimension layers from map
        sixDimensionLayers.forEach(layerKey => {
            const layer = layers[layerKey];
            if (layer && mapRef.current && mapRef.current.hasLayer(layer)) {
                mapRef.current.removeLayer(layer);
            }
        });

        // Update layers state to remove six-dimension layers
        setLayers(prevLayers => {
            const newLayers = { ...prevLayers };
            sixDimensionLayers.forEach(key => {
                delete newLayers[key];
            });
            return newLayers;
        });


        // If we have selected bands, they will be reloaded with new mode by existing useEffect
    }, [renderingMode, layers, selectedBands, selectedMicroGrids, microGridLayerGroup, simulationBands, sixDimensionLayers]);

    // --------------------------------------------------------------------------  
    // 🚀 NEW: Utility function to build spatial-aware MVT URLs
    const buildMVTUrl = useCallback((baseUrl, includeSpatialFilter = true) => {
        // Build query parameters - always include renderingMode for backend validation
        const params = new URLSearchParams();
        params.set('renderingMode', renderingMode);

        if (!includeSpatialFilter || renderingMode !== 'spatial') {
            const finalUrl = `${baseUrl}?${params.toString()}`;
            return finalUrl;
        }

        // Apply spatial filtering based on selected micro grids only
        if (selectedMicroGrids.length > 0) {
            // 🚀 PERFORMANCE: Use memoized microGridIds instead of inline computation
            params.set('microGrids', microGridIds.join(','));
        }
        // Note: No micro grids selected - use global rendering in spatial mode

        const finalUrl = `${baseUrl}?${params.toString()}`;
        return finalUrl;
    }, [renderingMode, selectedMicroGrids, microGridIds]);

    // --------------------------------------------------------------------------
    // 🚀 NEW: Utility function to build spatial-aware API URLs (non-MVT)
    const buildApiUrl = useCallback((baseUrl, includeSpatialFilter = true) => {
        const url = new URL(baseUrl);

        // Always include renderingMode for backend validation
        url.searchParams.set('renderingMode', renderingMode);

        if (!includeSpatialFilter || renderingMode !== 'spatial') {
            console.log(`📡 [API Request] ${baseUrl.split('/').pop()} - Mode: ${renderingMode} (no spatial filter)`);
            return url.toString();
        }

        // Apply spatial filtering based on selected micro grids only
        if (selectedMicroGrids.length > 0) {
            // 🚀 PERFORMANCE: Use memoized microGridIds instead of inline computation
            url.searchParams.set('microGrids', microGridIds.join(','));
            console.log(`📡 [API Request] ${baseUrl.split('/').pop()} - Mode: ${renderingMode}, Filtering by microgrids: [${microGridIds.join(', ')}]`);
        } else {
            console.log(`📡 [API Request] ${baseUrl.split('/').pop()} - Mode: ${renderingMode}, No microgrids selected (showing nothing)`);
        }

        return url.toString();
    }, [renderingMode, selectedMicroGrids, microGridIds]);

    // --------------------------------------------------------------------------
    // 🚀 NEW: Helper function to build grid-details URL with renderingMode
    const buildGridDetailsUrl = useCallback((grid_id, categories) => {
        const params = new URLSearchParams();
        if (categories) {
            params.set('categories', categories);
        }
        params.set('renderingMode', renderingMode);

        // 🚀 Add microGrids parameter for spatial mode to fix 403 error
        if (renderingMode === 'spatial' && selectedMicroGrids.length > 0) {
            // 🚀 PERFORMANCE: Use memoized microGridIds instead of inline computation
            params.set('microGrids', microGridIds.join(','));
        }

        return `${EXTERNAL_SERVER_URL}/api/grid-details/${grid_id}?${params.toString()}`;
    }, [renderingMode, selectedMicroGrids, microGridIds]);

    // --------------------------------------------------------------------------


    // --------------------------------------------------------------------------
    // Visualize selected micro grids on the map (incremental add/remove)
    useEffect(() => {
        if (!mapRef.current) return;

        // Helper to clear all layers and reset refs
        const clearAllMicroGridLayers = () => {
            if (microGridLayerGroup) {
                Object.values(microGridLayersRef.current).forEach((layer) => {
                    try { microGridLayerGroup.removeLayer(layer); } catch (e) { }
                });
            }
            microGridLayersRef.current = {};
        };

        // If no micro grids are selected, clean up and exit
        if (selectedMicroGrids.length === 0) {
            clearAllMicroGridLayers();
            if (microGridLayerGroup) {
                mapRef.current.removeLayer(microGridLayerGroup);
                setMicroGridLayerGroup(null);
            }
            return;
        }

        // Lazily create a dedicated layer group for micro grid outlines
        let group = microGridLayerGroup;
        if (!group) {
            group = L.layerGroup().addTo(mapRef.current);
            setMicroGridLayerGroup(group);
        }

        // Remove layers for deselected grids WITHOUT touching remaining ones
        Object.keys(microGridLayersRef.current).forEach((idStr) => {
            const id = parseInt(idStr, 10);
            if (!selectedMicroGrids.includes(id)) {
                const layer = microGridLayersRef.current[idStr];
                if (layer) {
                    try {
                        // Clean up event listeners
                        layer.off('mouseover');
                        layer.off('mouseout');
                        layer.off('click');

                        // Close any open tooltips/popups
                        if (layer.closeTooltip) layer.closeTooltip();
                        if (layer.closePopup) layer.closePopup();

                        // Remove from layer group
                        if (group.hasLayer(layer)) {
                            group.removeLayer(layer);
                        }

                        // Also remove directly from map as fallback
                        if (mapRef.current && mapRef.current.hasLayer(layer)) {
                            mapRef.current.removeLayer(layer);
                        }
                    } catch (e) {
                        console.warn('Error during micro grid layer cleanup:', e);
                    }
                }
                delete microGridLayersRef.current[idStr];
            }
        });

        // Determine which micro grids are newly added
        const idsToAdd = selectedMicroGrids.filter((id) => !(String(id) in microGridLayersRef.current));
        if (idsToAdd.length === 0) return; // Nothing new to add

        (async () => {
            try {
                const res = await queuedApiRequest(`${EXTERNAL_SERVER_URL}/micro_grids`);
                if (!res.ok) throw new Error('Failed to fetch micro grid geometry');
                const data = await res.json();

                const featuresToAdd = data.features.filter((f) => idsToAdd.includes(f.properties.id));

                featuresToAdd.forEach((feature) => {
                    const outline = L.geoJSON(feature, {
                        style: {
                            color: '#0052cc',
                            weight: 2,
                            dashArray: '4,2',
                            fillOpacity: 0, // Completely transparent fill
                            fillColor: 'transparent',
                            opacity: 1,
                        },
                        className: 'micro-grid-boundary',
                        pane: 'baseFrameworkPane',
                    });

                    // Hover effects
                    outline.on('mouseover', async function (e) {
                        // 🐛 DEBUG: Log hover event start

                        // Use feature from forEach loop scope instead of e.target.feature

                        e.target.setStyle({
                            weight: 4,
                            color: '#003d99',
                            fillOpacity: 0, // Keep transparent on hover
                        });

                        if (feature && feature.properties) {
                            const gridName = feature.properties.grid_name || feature.properties.name;

                            // 🐛 DEBUG: Check for edge cases
                            if (!gridName || gridName.trim() === '') {
                                console.warn(`[DEBUG] WARNING: Empty or undefined grid_name detected`);
                                console.warn(`[DEBUG] Feature properties:`, feature.properties);
                                return; // Skip processing if no valid grid name
                            }

                            // Show loading tooltip first
                            const loadingTooltip = `微網格: ${gridName}<br/>正在加載MR數據...`;
                            e.target
                                .bindTooltip(loadingTooltip, {
                                    permanent: false,
                                    direction: 'center',
                                    className: 'micro-grid-tooltip',
                                })
                                .openTooltip();

                            // Fetch MR data
                            try {
                                const apiUrl = `${EXTERNAL_SERVER_URL}/micro_grid_mr/${encodeURIComponent(gridName)}`;

                                const response = await apiRequest(apiUrl);

                                if (response.ok) {
                                    const mrData = await response.json();

                                    // Format MR data for tooltip
                                    const tooltipContent = `
                                        <div style="font-size: 12px; line-height: 1.4;">
                                            <strong>微網格: ${gridName}</strong><br/>
                                            <hr style="margin: 4px 0; border: none; border-top: 1px solid #ccc;"/>
                                            <strong>覆蓋率數據:</strong><br/>
                                            NR覆蓋率: ${mrData.mr_nr_coverage ? mrData.mr_nr_coverage.toFixed(2) + '%' : '0'}<br/>
                                            C-Band覆蓋率: ${mrData.mr_cband_coverage ? mrData.mr_cband_coverage.toFixed(2) + '%' : '0'}<br/>
                                            LTE覆蓋率: ${mrData.mr_lte_coverage ? mrData.mr_lte_coverage.toFixed(2) + '%' : '0'}<br/>
                                            <strong>競爭分析:</strong><br/>
                                            競強我強: ${mrData.comp_strong_we_strong ? mrData.comp_strong_we_strong.toFixed(2) + '%' : '0'}<br/>
                                            競強我弱: ${mrData.comp_strong_we_weak ? mrData.comp_strong_we_weak.toFixed(2) + '%' : '0'}<br/>
                                            競弱我強: ${mrData.comp_weak_we_strong ? mrData.comp_weak_we_strong.toFixed(2) + '%' : '0'}<br/>
                                            競弱我弱: ${mrData.comp_weak_we_weak ? mrData.comp_weak_we_weak.toFixed(2) + '%' : '0'}
                                        </div>
                                    `;

                                    // Update tooltip with MR data
                                    e.target
                                        .bindTooltip(tooltipContent, {
                                            permanent: false,
                                            direction: 'center',
                                            className: 'micro-grid-tooltip',
                                        })
                                        .openTooltip();
                                } else {
                                    // No MR data found, show basic info
                                    const basicTooltip = `微網格: ${gridName}<br/><small style="color: #666;">未找到MR數據</small>`;
                                    e.target
                                        .bindTooltip(basicTooltip, {
                                            permanent: false,
                                            direction: 'center',
                                            className: 'micro-grid-tooltip',
                                        })
                                        .openTooltip();
                                }
                            } catch (error) {
                                // 🐛 DEBUG: Log detailed error information
                                console.error(`[DEBUG] Error fetching MR data for grid: ${gridName}`);
                                console.error(`[DEBUG] Error type:`, error.name);
                                console.error(`[DEBUG] Error message:`, error.message);
                                console.error(`[DEBUG] Error stack:`, error.stack);

                                // Show error tooltip
                                const errorTooltip = `微網格: ${gridName}<br/><small style="color: #f44336;">載入MR數據失敗</small>`;
                                e.target
                                    .bindTooltip(errorTooltip, {
                                        permanent: false,
                                        direction: 'center',
                                        className: 'micro-grid-tooltip',
                                    })
                                    .openTooltip();
                            }
                        }
                    });

                    outline.on('mouseout', function (e) {
                        e.target.setStyle({
                            weight: 2,
                            color: '#0052cc',
                            fillOpacity: 0, // Keep transparent on mouse leave
                        });
                        e.target.closeTooltip();
                    });

                    outline.addTo(group);
                    microGridLayersRef.current[feature.properties.id] = outline;
                });
            } catch (err) {
                // Don't log errors for cancelled requests
                if (!err.cancelled && err.name !== 'AbortError') {
                    console.error('Error fetching micro grid geometry:', err);
                }
            }
        })();
    }, [selectedMicroGrids, microGridLayerGroup]);


    // --------------------------------------------------------------------------
    // 🚀 NEW: Optimized data processing with zoom throttling
    const processDataAsyncBatch = async (filteredData, currentZoom, geometryType, style, band) => {
        return new Promise((resolve) => {
            // Use requestIdleCallback for non-blocking processing
            const processInChunks = () => {
                const startTime = performance.now();
                const timeLimit = 16; // 16ms per frame (60fps)

                try {
                    // Aggressive viewport-based culling - only render what's visible
                    const mapBounds = mapRef.current.getBounds();
                    const viewportFeatures = filteredData.features.filter(feature => {
                        if (!feature.geometry || !feature.geometry.coordinates) return false;

                        try {
                            // Quick bounds check for polygons
                            if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') {
                                const coords = geometryType === 'Polygon' ?
                                    feature.geometry.coordinates[0] :
                                    feature.geometry.coordinates[0][0];

                                if (!coords || coords.length === 0) return false;

                                // Calculate rough bounds (optimized)
                                let minLng = coords[0][0], maxLng = coords[0][0];
                                let minLat = coords[0][1], maxLat = coords[0][1];

                                // Even more aggressive sampling for performance during zoom
                                for (let i = 1; i < Math.min(coords.length, 3); i++) { // Further reduced from 5 to 3
                                    minLng = Math.min(minLng, coords[i][0]);
                                    maxLng = Math.max(maxLng, coords[i][0]);
                                    minLat = Math.min(minLat, coords[i][1]);
                                    maxLat = Math.max(maxLat, coords[i][1]);
                                }

                                // Check if feature intersects viewport
                                return !(maxLng < mapBounds.getWest() || minLng > mapBounds.getEast() ||
                                    maxLat < mapBounds.getSouth() || minLat > mapBounds.getNorth());
                            }
                            return true;
                        } catch (e) {
                            return false;
                        }
                    });

                    // Optimized feature limits for smoother zoom performance
                    let MAX_FEATURES;
                    if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') {
                        // More conservative limits to prevent zoom lag
                        MAX_FEATURES = currentZoom > 16 ? 300 : currentZoom > 14 ? 150 : currentZoom > 12 ? 75 : 40;
                    } else {
                        // Point features are lighter, allow more
                        MAX_FEATURES = currentZoom > 15 ? 800 : currentZoom > 12 ? 400 : 200;
                    }

                    // Intelligent sampling - prioritize important features
                    let sampledFeatures = viewportFeatures;
                    if (viewportFeatures.length > MAX_FEATURES) {
                        const step = Math.ceil(viewportFeatures.length / MAX_FEATURES);
                        sampledFeatures = viewportFeatures.filter((_, index) => index % step === 0);
                    }

                    let finalData = { ...filteredData, features: sampledFeatures };

                    // Only apply simplification if we have time budget left
                    if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') {
                        const elapsed = performance.now() - startTime;
                        if (elapsed < timeLimit) {
                            // 🚀 PERFORMANCE OPTIMIZED: More aggressive simplification for zoom performance
                            let tolerance;
                            if (currentZoom > 16) {
                                tolerance = 0.002; // Slightly reduced detail for better performance
                            } else if (currentZoom > 14) {
                                tolerance = 0.008;  // Reduced detail
                            } else if (currentZoom > 12) {
                                tolerance = 0.02;   // Lower detail
                            } else {
                                tolerance = 0.06;   // Much lower detail for smooth zooming
                            }

                            try {
                                finalData = simplify(finalData, {
                                    tolerance,
                                    highQuality: false, // Always use fast simplification during zoom
                                    mutate: false
                                });
                            } catch (e) {
                                console.warn('Simplification failed:', e);
                            }
                        }
                    }

                    resolve(finalData);
                } catch (e) {
                    console.error('Error in async data processing:', e);
                    resolve(filteredData); // Fallback to original data
                }
            };

            // Use requestIdleCallback if available, otherwise setTimeout
            if (window.requestIdleCallback) {
                requestIdleCallback(processInChunks, { timeout: 100 });
            } else {
                setTimeout(processInChunks, 0);
            }
        });
    };

    // --------------------------------------------------------------------------  
    // 🚀 PERFORMANCE OPTIMIZED: Primary fetch method with zoom throttling
    const fetchBandData = async (bands, latLngBounds) => {
        if (!mapRef.current) return;

        const currentTime = performance.now();
        const currentZoom = mapRef.current.getZoom();

        // 🚀 ENHANCED ZOOM THROTTLING: More aggressive throttling during rapid zoom changes
        if (zoomProcessingRef.current) {
            return;
        }

        // More aggressive debounce for rapid zoom changes (increased from 150ms to 300ms)
        if (currentTime - lastZoomTimeRef.current < 300) {
            if (zoomTimeoutRef.current) {
                clearTimeout(zoomTimeoutRef.current);
            }

            zoomTimeoutRef.current = setTimeout(() => {
                fetchBandData(bands, latLngBounds);
            }, 300);
            return;
        }

        lastZoomTimeRef.current = currentTime;
        zoomProcessingRef.current = true;

        // 🚀 REGIONAL MODE OPTIMIZATION: Eliminate subdivision when using spatial filtering
        // In spatial mode with micro grids selected, backend filtering is sufficient
        const useRegionalOptimization = renderingMode === 'spatial' && selectedMicroGrids.length > 0;

        let subBoxes;
        if (useRegionalOptimization) {
            // 🚀 NO SUBDIVISION: Single request when spatial filtering is active
            subBoxes = [latLngBounds];
        } else {
            // Traditional subdivision for non-regional mode
            const isComplaint = bands.length === 1 && bands[0].startsWith('complaint_');
            const divisions = isComplaint ? 1 : (currentZoom >= 16 ? 2 : currentZoom >= 14 ? 2 : 3);
            subBoxes = subdivideBounds(latLngBounds, divisions);
        }
        // 🚀 PERFORMANCE OPTIMIZATION: 智能图层管理
        // 检查是否真正需要移除图层，避免不必要的DOM操作
        const layersToRemove = bands.filter(b => layers[b] &&
            // 只有当数据确实需要更新时才移除图层
            !fetchCacheRef.current.has(`${b}-${Math.round(latLngBounds.getWest() * 100) / 100}-${Math.round(latLngBounds.getSouth() * 100) / 100}-${Math.round(latLngBounds.getEast() * 100) / 100}-${Math.round(latLngBounds.getNorth() * 100) / 100}`)
        );

        layersToRemove.forEach((b) => {
            mapRef.current.removeLayer(layers[b]);
        });

        // 🚀 FIX: Clean up existing MVT layers for the bands being processed
        const cleanupExistingMVTLayers = (bandToClean) => {
            if (!mapRef.current) return;

            mapRef.current.eachLayer((layer) => {
                // Check if this is an MVT layer that should be removed
                if (layer.options && layer.options.rendererFactory === L.canvas.tile) {
                    // This is likely an MVT layer, check if it matches our band
                    const layerUrl = layer._url || '';
                    const shouldRemove = (
                        (bandToClean.startsWith('testing_data_lte_') && !bandToClean.includes('cmhk_') && layerUrl.includes('/other_lte_weak/mvt/')) ||
                        (bandToClean.startsWith('testing_data_lte_cmhk_') && layerUrl.includes('/cmhk_weak_coverage/mvt/')) ||
                        (bandToClean.startsWith('testing_data_nr_cmhk_') && layerUrl.includes('/cmhk_weak_coverage/mvt/')) ||
                        ((bandToClean.startsWith('cmhk_test_data_lte_competition_') || bandToClean.startsWith('cmhk_test_data_nr_competition_')) && layerUrl.includes('/competition_scenario_test/')) ||
                        (bandToClean.startsWith('cmhk_test_data_lte_competition_rsrp') && layerUrl.includes('/cmhk_rsrp_data/lte/mvt/')) ||
                        (bandToClean.startsWith('cmhk_test_data_nr_competition_rsrp') && layerUrl.includes('/cmhk_rsrp_data/nr/mvt/')) ||
                        (bandToClean.startsWith('cmhk_test_data_lte_competition_sinr') && layerUrl.includes('/cmhk_sinr_data/lte/mvt/')) ||
                        (bandToClean.startsWith('cmhk_test_data_nr_competition_sinr') && layerUrl.includes('/cmhk_sinr_data/nr/mvt/')) ||
                        (bandToClean.startsWith('testing_data_nr_') && !bandToClean.includes('cmhk_') && layerUrl.includes('/other_nr_weak/mvt/')) ||
                        (bandToClean.startsWith('complaint_') && layerUrl.includes('/complaint_data/mvt/')) ||
                        (bandToClean.startsWith('simulation_data_raw_simulation')) ||
                        (bandToClean.startsWith('Discovery_MR_Data_NR') && layerUrl.includes('/discovery_mr/')) ||
                        (bandToClean.startsWith('microphone_data') && layerUrl.includes('/cmhk_grid_highload/mvt/'))
                    );

                    if (shouldRemove) {
                        try {
                            mapRef.current.removeLayer(layer);
                        } catch (e) {
                            console.warn('Error removing MVT layer:', e);
                        }
                    }
                }
            });
        };

        const bandLayerGroups = {};
        try {
            const fetchPromises = [];

            // Debug: Check for six-dimension data bands
            const sixDimBands = bands.filter(band =>
                band.startsWith('complaint_') ||
                band.startsWith('Discovery_MR_Data_NR') ||
                band.startsWith('simulation_data_raw_simulation') ||
                band.startsWith('microphone_data') ||
                band.startsWith('cmhk_test_data_')
            );
            console.log(bands)
            for (const band of bands) {

                // Special handling: Other operators LTE via MVT (weak coverage only)
                if (band.startsWith('testing_data_lte_') && !band.includes('cmhk_')) {
                    const otherLteTable = band.replace('testing_data_lte_', ''); // e.g., xcsl_l900

                    // 🚀 FIX: Clean up existing MVT layers for this band
                    cleanupExistingMVTLayers(band);
                    if (layers[band]) {
                        try { mapRef.current.removeLayer(layers[band]); } catch (e) { }
                    }

                    const baseUrl = `${EXTERNAL_SERVER_URL}/other_lte_weak/mvt/${otherLteTable}/{z}/{x}/{y}`;
                    const url = buildMVTUrl(baseUrl);
                    const mvtLayer = L.vectorGrid.protobuf(url, {
                        minZoom: 8,
                        maxZoom: 18,
                        // Use gridsPane for applying blur filter uniformly
                        pane: 'gridDataPane',
                        rendererFactory: L.canvas.tile,
                        updateWhileInteracting: true,
                        updateWhileAnimating: true,
                        interactive: true,  // 🚀 FIX: Enable interaction for click events
                        bubblingMouseEvents: false,  // 🚀 FIX: Prevent event bubbling to fix map dragging issue
                        vectorTileLayerStyles: {
                            grid: (properties) => {
                                const v = properties && properties.rsrp_value;
                                const fillColor = (v !== null && v !== undefined && !isNaN(v)) ? getRSRPColor(v) : '#808080';
                                return {
                                    fill: true,
                                    fillColor,
                                    fillOpacity: 0.6,
                                    stroke: true,
                                    color: '#ffffff',
                                    weight: 0.5
                                };
                            }
                        }
                    });
                    // 🚀 FIX: Add click event handler to prevent map dragging issue
                    mvtLayer.on('click', async (e) => {
                        try {
                            // Prevent event propagation to fix cursor sticking issue
                            if (e.originalEvent) {
                                e.originalEvent.stopPropagation();
                                e.originalEvent.preventDefault();
                            }
                        } catch (error) {
                            console.error('Error handling other LTE MVT click:', error);
                        }
                    });
                    mvtLayer.addTo(mapRef.current);
                    bandLayerGroups[band] = mvtLayer;
                    return; // Skip normal GeoJSON fetching flow
                }
                // Special handling: Complaint data via MVT
                if (band === 'complaint__data_geojson') {

                    // 🚀 FIX: Clean up existing MVT layers for this band
                    cleanupExistingMVTLayers(band);
                    if (layers[band]) {
                        try { mapRef.current.removeLayer(layers[band]); } catch (e) { }
                    }
                    let baseUrl = `${EXTERNAL_SERVER_URL}/complaint_data/mvt/{z}/{x}/{y}`;
                    const url = buildMVTUrl(baseUrl);
                    const mvtLayer = L.vectorGrid.protobuf(url, {
                        minZoom: 8,
                        maxZoom: 18,
                        pane: 'gridDataPane',
                        rendererFactory: L.canvas.tile,
                        updateWhileInteracting: true,
                        updateWhileAnimating: true,
                        interactive: true,  // 🚀 FIX: Enable interaction for click events
                        bubblingMouseEvents: false,  // 🚀 FIX: Prevent event bubbling to fix map dragging issue
                        vectorTileLayerStyles: {
                            grid: () => ({
                                fill: true,
                                fillColor: getComplaintColor(),
                                fillOpacity: 0.6,
                                stroke: true,
                                color: '#ffffff',
                                weight: 0.5
                            })
                        }
                    });
                    // Add click handler for complaint grid details
                    mvtLayer.on('click', async (e) => {
                        try {

                            // Prevent event propagation to fix cursor sticking issue
                            if (e.originalEvent) {
                                e.originalEvent.stopPropagation();
                                e.originalEvent.preventDefault();
                            }

                            // Try multiple property extraction methods
                            const props1 = e && e.layer && e.layer.properties ? e.layer.properties : {};
                            const props2 = e && e.properties ? e.properties : {};
                            const props3 = e && e.target && e.target.properties ? e.target.properties : {};


                            const props = props1.id ? props1 : (props2.id ? props2 : props3);

                            const grid_id = Number(props.id) || props.id;

                            // Check duplicate click logic
                            const isDuplicate = isClickDuplicate(grid_id);
                            if (isDuplicate) {
                                return;
                            }

                            // Fetch complaint grid details
                            const fullUrl = buildGridDetailsUrl(grid_id, 'complaint_data,discovery_mr,high_load_data,simulation_data');
                            const response = await debouncedApiRequest(`grid-details-${grid_id}`, fullUrl);
                            if (response.ok) {
                                const gridData = await response.json();
                                if (gridData.available_categories.length > 0) {
                                    // Create feature object for GridDetailPanel
                                    const featureData = {
                                        type: 'Feature',
                                        properties: {
                                            id: grid_id,
                                            grid_id: grid_id,
                                            ...gridData.categories,
                                            coordinates: gridData.coordinates
                                        },
                                        geometry: null
                                    };

                                    setSelectedGridData(featureData);
                                    setShowGridDetail(true);
                                }
                            }
                        } catch (err) {
                            console.error('Error fetching complaint grid details:', err);
                        }
                    });
                    mvtLayer.addTo(mapRef.current);
                    bandLayerGroups[band] = mvtLayer;
                    return; // Skip normal GeoJSON fetching flow
                }

                // Special handling: CMHK RSRP data (LTE/NR)
                if (band.startsWith('cmhk_test_data_lte_competition_rsrp') || band.startsWith('cmhk_test_data_nr_competition_rsrp')) {
                    const technology = band.includes('lte_competition') ? 'lte' : 'nr';

                    // Clean up existing MVT layers for this band
                    cleanupExistingMVTLayers(band);
                    if (layers[band]) {
                        try { mapRef.current.removeLayer(layers[band]); } catch (e) { }
                    }

                    const baseUrl = `${EXTERNAL_SERVER_URL}/cmhk_rsrp_data/${technology}/mvt/{z}/{x}/{y}`;
                    const url = buildMVTUrl(baseUrl);
                    const mvtLayer = L.vectorGrid.protobuf(url, {
                        minZoom: 8,
                        maxZoom: 18,
                        rendererFactory: L.canvas.tile,
                        maxNativeZoom: 15,
                        interactive: true,
                        pane: 'gridDataPane',
                        updateWhileInteracting: true,
                        updateWhileAnimating: true,
                        bubblingMouseEvents: false,
                        vectorTileLayerStyles: {
                            'grid': (properties) => {
                                const v = properties && properties.rsrp_value;
                                const fillColor = (v !== null && v !== undefined && !isNaN(v)) ? getRSRPColor(v) : '#808080';
                                return {
                                    fill: true,
                                    fillColor,
                                    fillOpacity: 0.7,
                                    stroke: true,
                                    color: '#ffffff',
                                    weight: 1,
                                    opacity: 0.8
                                };
                            }
                        }
                    });

                    // Add click event handler
                    mvtLayer.on('click', async (e) => {
                        try {
                            // Use Leaflet's DomEvent.stop to completely halt event propagation and default behavior
                            if (e.originalEvent) {
                                L.DomEvent.stop(e.originalEvent);
                            }

                            const props = e && e.layer && e.layer.properties ? e.layer.properties : {};
                            const grid_id = Number(props.id) || props.id;

                            const isDuplicate = isClickDuplicate(grid_id);
                            if (isDuplicate) return;

                            const fullUrl = buildGridDetailsUrl(grid_id, 'cmhk_test_data');
                            const response = await debouncedApiRequest(`grid-details-${grid_id}`, fullUrl);
                            if (response.ok) {
                                const gridData = await response.json();
                                if (gridData.available_categories.length > 0) {
                                    const featureData = {
                                        type: 'Feature',
                                        properties: {
                                            id: grid_id,
                                            grid_id: grid_id,
                                            rsrp_value: props.rsrp_value,
                                            ...gridData.categories,
                                            coordinates: gridData.coordinates
                                        },
                                        geometry: null
                                    };

                                    setSelectedGridData(featureData);
                                    setShowGridDetail(true);
                                }
                            }
                        } catch (err) {
                            console.error('Error fetching RSRP grid details:', err);
                        }
                    });

                    mvtLayer.addTo(mapRef.current);
                    bandLayerGroups[band] = mvtLayer;
                    return;
                }

                // Special handling: CMHK SINR data (LTE/NR)
                if (band.startsWith('cmhk_test_data_lte_competition_sinr') || band.startsWith('cmhk_test_data_nr_competition_sinr')) {
                    const technology = band.includes('lte_competition') ? 'lte' : 'nr';

                    // Clean up existing MVT layers for this band
                    cleanupExistingMVTLayers(band);
                    if (layers[band]) {
                        try { mapRef.current.removeLayer(layers[band]); } catch (e) { }
                    }

                    const baseUrl = `${EXTERNAL_SERVER_URL}/cmhk_sinr_data/${technology}/mvt/{z}/{x}/{y}`;
                    const url = buildMVTUrl(baseUrl);
                    const mvtLayer = L.vectorGrid.protobuf(url, {
                        minZoom: 8,
                        maxZoom: 18,
                        rendererFactory: L.canvas.tile,
                        maxNativeZoom: 15,
                        interactive: true,
                        pane: 'gridDataPane',
                        updateWhileInteracting: true,
                        updateWhileAnimating: true,
                        bubblingMouseEvents: false,
                        vectorTileLayerStyles: {
                            'grid': (properties) => {
                                const v = properties && properties.sinr_value;
                                const fillColor = (v !== null && v !== undefined && !isNaN(v)) ? getSINRColor(v) : '#808080';
                                return {
                                    fill: true,
                                    fillColor,
                                    fillOpacity: 0.7,
                                    stroke: true,
                                    color: '#ffffff',
                                    weight: 1,
                                    opacity: 0.8
                                };
                            }
                        }
                    });

                    // Add click event handler
                    mvtLayer.on('click', async (e) => {
                        try {
                            // Use Leaflet's DomEvent.stop to completely halt event propagation and default behavior
                            if (e.originalEvent) {
                                L.DomEvent.stop(e.originalEvent);
                            }

                            const props = e && e.layer && e.layer.properties ? e.layer.properties : {};
                            const grid_id = Number(props.id) || props.id;

                            const isDuplicate = isClickDuplicate(grid_id);
                            if (isDuplicate) return;

                            const fullUrl = buildGridDetailsUrl(grid_id, 'cmhk_test_data');
                            const response = await debouncedApiRequest(`grid-details-${grid_id}`, fullUrl);
                            if (response.ok) {
                                const gridData = await response.json();
                                if (gridData.available_categories.length > 0) {
                                    const featureData = {
                                        type: 'Feature',
                                        properties: {
                                            id: grid_id,
                                            grid_id: grid_id,
                                            sinr_value: props.sinr_value,
                                            ...gridData.categories,
                                            coordinates: gridData.coordinates
                                        },
                                        geometry: null
                                    };

                                    setSelectedGridData(featureData);
                                    setShowGridDetail(true);
                                }
                            }
                        } catch (err) {
                            console.error('Error fetching SINR grid details:', err);
                        }
                    });

                    mvtLayer.addTo(mapRef.current);
                    bandLayerGroups[band] = mvtLayer;
                    return;
                }

                // Special handling: CMHK test data structure
                if (band.startsWith('testing_data_lte_cmhk_') || band.startsWith('testing_data_nr_cmhk_')) {
                    // Extract type and band number from unified structure
                    // Expected format: testing_data_lte_cmhk_700 or testing_data_nr_cmhk_2100
                    const parts = band.split('_');
                    if (parts.length >= 5) {
                        const type = parts[2]; // lte or nr (parts[0]=testing, parts[1]=data, parts[2]=lte/nr)  
                        const bandNumber = parts[4]; // 700, 900, etc. (parts[3]=cmhk, parts[4]=band)


                        // Remove existing layer if it exists
                        if (bandLayerGroups[band]) {
                            try { mapRef.current.removeLayer(bandLayerGroups[band]); } catch (e) { }
                        }

                        const baseUrl = `${EXTERNAL_SERVER_URL}/cmhk_weak_coverage/mvt/${type}/${bandNumber}/{z}/{x}/{y}`;
                        const url = buildMVTUrl(baseUrl);
                        const mvtLayer = L.vectorGrid.protobuf(url, {
                            minZoom: 8,
                            maxZoom: 18,
                            rendererFactory: L.canvas.tile,
                            maxNativeZoom: 15,
                            interactive: true,  // 🚀 FIX: Enable interaction for click events
                            pane: 'gridDataPane',
                            updateWhileInteracting: true,
                            updateWhileAnimating: true,
                            bubblingMouseEvents: false,  // 🚀 FIX: Prevent event bubbling to fix map dragging issue
                            vectorTileLayerStyles: {
                                'grid': (properties) => {
                                    const v = properties && properties.rsrp_value;
                                    const fillColor = (v !== null && v !== undefined && !isNaN(v)) ? getRSRPColor(v) : '#808080';
                                    return {
                                        fill: true,
                                        fillColor,
                                        fillOpacity: 0.7,
                                        stroke: true,
                                        color: '#ffffff',
                                        weight: 1,
                                        opacity: 0.8
                                    };
                                }
                            }
                        });

                        // 🚀 FIX: Add click event handler to prevent map dragging issue
                        mvtLayer.on('click', async (e) => {
                            try {
                                // Prevent event propagation to fix cursor sticking issue
                                if (e.originalEvent) {
                                    e.originalEvent.stopPropagation();
                                    e.originalEvent.preventDefault();
                                }

                                const props = e && e.layer && e.layer.properties ? e.layer.properties : {};
                                const grid_id = Number(props.id) || props.id;

                                if (!grid_id) {
                                    console.warn('No grid_id found in CMHK test data click');
                                    return;
                                }

                                // Fetch grid details for test data
                                const fullUrl = buildGridDetailsUrl(grid_id, 'cmhk_test_data');
                                const response = await debouncedApiRequest(`cmhk-test-grid-details-${grid_id}`, fullUrl);

                                if (response.ok) {
                                    const gridData = await response.json();
                                    if (gridData.available_categories.length > 0) {
                                        // Create feature object for GridDetailPanel
                                        const featureData = {
                                            type: 'Feature',
                                            properties: {
                                                id: grid_id,
                                                grid_id: grid_id,
                                                rsrp_value: props.rsrp_value,
                                                ...gridData.categories,
                                                coordinates: gridData.coordinates
                                            },
                                            geometry: null
                                        };
                                        setSelectedGridData(featureData);
                                        setShowGridDetail(true);
                                    }
                                } else {
                                    console.error(`Failed to fetch CMHK test data for grid ${grid_id}`);
                                }
                            } catch (error) {
                                console.error('Error handling CMHK test data MVT click:', error);
                            }
                        });

                        mvtLayer.addTo(mapRef.current);
                        bandLayerGroups[band] = mvtLayer;
                        return; // Skip normal GeoJSON fetching flow
                    } else {
                        console.error(`❌ Invalid CMHK band format: ${band}, parts length: ${parts.length}, parts: [${parts.join(', ')}]`);
                    }
                }


                // Special handling: Other operators NR via MVT (weak coverage only)
                if (band.startsWith('testing_data_nr_') && !band.includes('cmhk_')) {
                    const nrTable = `fieldtest_grid_${band.replace('testing_data_nr_', '')}`; // e.g., fieldtest_grid_xcsl_ft_nr3500_rsrp

                    // 🚀 FIX: Clean up existing MVT layers for this band
                    cleanupExistingMVTLayers(band);
                    if (layers[band]) {
                        try { mapRef.current.removeLayer(layers[band]); } catch (e) { }
                    }

                    const baseUrl = `${EXTERNAL_SERVER_URL}/other_nr_weak/mvt/${nrTable}/{z}/{x}/{y}`;
                    const url = buildMVTUrl(baseUrl);
                    const mvtLayer = L.vectorGrid.protobuf(url, {
                        minZoom: 8,
                        maxZoom: 18,
                        pane: 'gridDataPane',
                        rendererFactory: L.canvas.tile,
                        updateWhileInteracting: true,
                        updateWhileAnimating: true,
                        interactive: true,  // 🚀 FIX: Enable interaction for click events
                        bubblingMouseEvents: false,  // 🚀 FIX: Prevent event bubbling to fix map dragging issue
                        vectorTileLayerStyles: {
                            grid: (properties) => {
                                const v = properties && properties.rsrp_value;
                                const fillColor = (v !== null && v !== undefined && !isNaN(v)) ? getRSRPColor(v) : '#808080';
                                return {
                                    fill: true,
                                    fillColor,
                                    fillOpacity: 0.6,
                                    stroke: true,
                                    color: '#ffffff',
                                    weight: 0.5
                                };
                            }
                        }
                    });
                    mvtLayer.on('click', async (e) => {
                        try {
                            // Prevent event propagation to fix cursor sticking issue
                            if (e.originalEvent) {
                                e.originalEvent.stopPropagation();
                                e.originalEvent.preventDefault();
                            }

                            const props = e && e.layer && e.layer.properties ? e.layer.properties : {};
                            const grid_id = Number(props.id) || props.id;

                            // Prevent duplicate clicks using reusable function
                            if (isClickDuplicate(grid_id)) return;
                        } catch (err) {
                            console.error('Other NR detail fetch failed', err);
                        }
                    });
                    mvtLayer.addTo(mapRef.current);
                    bandLayerGroups[band] = mvtLayer;
                    return; // Skip normal GeoJSON fetching flow
                }

                // 🚀 NEW: Special handling for Raw Simulation Data (MVT tiles)
                if (band.startsWith('simulation_data_raw_simulation')) {

                    // Clean up existing MVT layers for this band
                    cleanupExistingMVTLayers(band);
                    if (layers[band]) {
                        try {
                            mapRef.current.removeLayer(layers[band]);
                        } catch (e) {
                            console.warn('Error removing existing simulation layer:', e);
                        }
                    }

                    // Determine if this is 4G or 5G simulation data
                    const is4G = band.includes('RAW_4G_Layer');
                    const is5G = band.includes('RAW_5G_Layer');

                    // MVT tile URL for simulation raw data - use different endpoints for 4G and 5G
                    const apiEndpoint = is4G ? '/api/simulation-4g-pbf/{z}/{x}/{y}' : '/api/simulation-pbf/{z}/{x}/{y}';
                    const baseUrl = `${EXTERNAL_SERVER_URL}${apiEndpoint}`;
                    const url = buildMVTUrl(baseUrl);

                    // Choose color based on simulation type
                    const fillColor = is4G ? '#cd8500' : '#ff3333'; // Orange-brown for 4G, Bright red for 5G
                    const layerLabel = is4G ? '4G仿真原數據' : '5G仿真原數據';

                    try {

                        const mvtLayer = L.vectorGrid.protobuf(url, {
                            minZoom: 8,
                            maxZoom: 18,
                            pane: 'gridDataPane',
                            rendererFactory: L.canvas.tile,
                            updateWhileInteracting: true,
                            updateWhileAnimating: true,
                            interactive: true,  // 🚀 FIX: Enable interaction for click events
                            bubblingMouseEvents: false,  // 🚀 FIX: Prevent event bubbling to fix map dragging issue
                            vectorTileLayerStyles: {
                                grid: (properties) => {
                                    // Render with different colors for 4G vs 5G simulation raw data
                                    return {
                                        fill: true,
                                        fillColor: fillColor,
                                        fillOpacity: 0.8, // Higher opacity for better visibility
                                        stroke: true,
                                        color: '#ffffff', // White border
                                        weight: 1 // Thicker border for better visibility
                                    };
                                }
                            }
                        });

                        // Add click event for feature inspection
                        mvtLayer.on('click', async (e) => {
                            try {
                                // Prevent event propagation
                                if (e.originalEvent) {
                                    e.originalEvent.stopPropagation();
                                    e.originalEvent.preventDefault();
                                }

                                const props = e && e.layer && e.layer.properties ? e.layer.properties : {};
                                const grid_id = Number(props.id) || props.id;

                                if (!grid_id) {
                                    // Show basic properties if no grid_id
                                    const popupContent = `
                                        <div style="font-family: Arial, sans-serif;">
                                            <h4 style="margin:0 0 10px 0; color:#d63031;">${layerLabel} (Raw Simulation)</h4>
                                            <div><strong>信號強度 (DN):</strong> ${props.dn || 'N/A'} dBm</div>
                                            <div><strong>ID:</strong> ${props.id || 'N/A'}</div>
                                        </div>
                                    `;
                                    L.popup()
                                        .setLatLng(e.latlng)
                                        .setContent(popupContent)
                                        .openOn(mapRef.current);
                                    return;
                                }


                                // Fetch grid details for simulation data
                                const fullUrl = buildGridDetailsUrl(grid_id, 'simulation_data');
                                const response = await debouncedApiRequest(`sim-grid-details-${grid_id}`, fullUrl);
                                if (response.ok) {
                                    const gridData = await response.json();
                                    if (gridData.available_categories.length > 0) {
                                        // Create feature object for GridDetailPanel
                                        const featureData = {
                                            type: 'Feature',
                                            properties: {
                                                id: grid_id,
                                                grid_id: grid_id,
                                                dn: props.dn, // Include DN from MVT properties
                                                ...gridData.categories,
                                                coordinates: gridData.coordinates
                                            },
                                            geometry: null
                                        };
                                        setSelectedGridData(featureData);
                                        setShowGridDetail(true);
                                    }
                                } else {
                                    console.error(`Failed to fetch simulation data for grid ${grid_id}`);
                                }
                            } catch (error) {
                                console.error('Error handling simulation MVT click:', error);
                            }
                        });

                        mvtLayer.addTo(mapRef.current);
                        layers[band] = mvtLayer;
                        bandLayerGroups[band] = mvtLayer;

                    } catch (error) {
                        console.error(`❌ Failed to create MVT layer for ${band}:`, error);
                        alert(`無法加載仿真原數據 MVT 圖層。\n\n錯誤: ${error.message}\n\n請檢查服務器配置。`);
                    }

                    return; // Skip normal GeoJSON fetching flow
                }

                // Special handling: Discovery MR Data (MVT) — create only one layer per band
                if (band.startsWith('Discovery_MR_Data_NR')) {
                    // 🚀 FIX: Clean up existing MVT layers for this band
                    cleanupExistingMVTLayers(band);
                    if (layers[band]) {
                        try { mapRef.current.removeLayer(layers[band]); } catch (e) { }
                    }

                    // Extract scenario from band name properly
                    let scenario;
                    if (band.includes('_strong_we_strong')) {
                        scenario = 'strong_we_strong';
                    } else if (band.includes('_weak_we_strong')) {
                        scenario = 'weak_we_strong';
                    } else if (band.includes('_strong')) {
                        scenario = 'strong';
                    } else if (band.includes('_weak')) {
                        scenario = 'weak';
                    } else {
                        console.warn(`Unknown Discovery MR scenario in band: ${band}`);
                        return;
                    }

                    // Check if scenario is supported by backend
                    const supportedScenarios = ['strong', 'weak', 'strong_we_strong', 'weak_we_strong'];
                    if (!supportedScenarios.includes(scenario)) {
                        const scenarioName = scenario === 'strong_we_strong' ? '競強我強' : '競弱我強';
                        console.warn(`Scenario '${scenario}' is not yet supported. Backend data not ready for ${scenarioName}.`);
                        return;
                    }

                    const baseUrl = `${EXTERNAL_SERVER_URL}/discovery_mr/${scenario}/mvt/{z}/{x}/{y}`;
                    const url = buildMVTUrl(baseUrl);
                    const mvtLayer = L.vectorGrid.protobuf(url, {
                        minZoom: 8,
                        maxZoom: 18,
                        pane: 'gridDataPane',
                        rendererFactory: L.canvas.tile,
                        updateWhileInteracting: true,
                        updateWhileAnimating: true,
                        interactive: true,  // 🚀 FIX: Enable interaction for click events
                        bubblingMouseEvents: false,  // 🚀 FIX: Prevent event bubbling to fix map dragging issue
                        vectorTileLayerStyles: {
                            grid: (properties) => {
                                const cat = properties && (properties.category || properties.drive_test_four_quadrants);
                                let fillColor = gridCategories['競弱我弱'].color; // Default color

                                if (cat === '競強我弱') {
                                    fillColor = gridCategories['競強我弱'].color;
                                } else if (cat === '競弱我弱') {
                                    fillColor = gridCategories['競弱我弱'].color;
                                } else if (cat === '競強我強') {
                                    fillColor = gridCategories['競強我強'].color;
                                } else if (cat === '競弱我強') {
                                    fillColor = gridCategories['競弱我強'].color;
                                }

                                return { fill: true, fillColor, fillOpacity: 0.6, stroke: true, color: '#ffffff', weight: 1.5 };
                            }
                        }
                    });
                    mvtLayer.on('click', async (e) => {
                        try {
                            // Prevent event propagation to fix cursor sticking issue
                            if (e.originalEvent) {
                                e.originalEvent.stopPropagation();
                                e.originalEvent.preventDefault();
                            }

                            const props = e && e.layer && e.layer.properties ? e.layer.properties : {};
                            const grid_id = Number(props.id) || props.id;

                            // Prevent duplicate clicks using reusable function
                            if (isClickDuplicate(grid_id)) return;

                            // Fetch grid details using new unified API
                            try {
                                const fullUrl = buildGridDetailsUrl(grid_id, 'complaint_data,discovery_mr,high_load_data,simulation_data');
                                const response = await debouncedApiRequest(`grid-details-${grid_id}`, fullUrl);
                                if (response.ok) {
                                    const gridData = await response.json();
                                    if (gridData.available_categories.length > 0) {
                                        // Create feature object for GridDetailPanel
                                        const featureData = {
                                            type: 'Feature',
                                            properties: {
                                                id: grid_id,
                                                grid_id: grid_id,
                                                ...gridData.categories,
                                                coordinates: gridData.coordinates
                                            },
                                            geometry: null // Will be filled if needed
                                        };
                                        setSelectedGridData(featureData);
                                        setShowGridDetail(true);
                                    }
                                } else {
                                    console.error(`Failed to fetch grid details: ${response.status}`);
                                }
                            } catch (fetchErr) {
                                console.error('Error fetching Discovery MR grid details:', fetchErr);
                            }
                        } catch (err) {
                            console.error('Discovery MR detail fetch failed', err);
                        }
                    });
                    mvtLayer.addTo(mapRef.current);
                    bandLayerGroups[band] = mvtLayer;
                    return; // Skip normal GeoJSON fetching flow
                }

                // Special handling: Microphone high-load data (MVT) — create only one layer per band
                if (band.startsWith('microphone_data')) {
                    // 🚀 FIX: Clean up existing MVT layers for this band
                    cleanupExistingMVTLayers(band);
                    if (layers[band]) {
                        try { mapRef.current.removeLayer(layers[band]); } catch (e) { }
                    }
                    const baseUrl = `${EXTERNAL_SERVER_URL}/cmhk_grid_highload/mvt/{z}/{x}/{y}`;
                    const url = buildMVTUrl(baseUrl);
                    const mvtLayer = L.vectorGrid.protobuf(url, {
                        minZoom: 8,
                        maxZoom: 18,
                        pane: 'gridDataPane',
                        rendererFactory: L.canvas.tile,
                        updateWhileInteracting: true,
                        updateWhileAnimating: true,
                        interactive: true,  // 🚀 FIX: Enable interaction for click events
                        bubblingMouseEvents: false,  // 🚀 FIX: Prevent event bubbling to fix map dragging issue
                        vectorTileLayerStyles: {
                            grid: (properties) => {
                                const fillColor = getHighLoadColor();
                                return { fill: true, fillColor, fillOpacity: 0.6, stroke: true, color: '#ffffff', weight: 0.5 };
                            }
                        }
                    });
                    // Enable click to show grid detail in InfoPanel
                    mvtLayer.on('click', async (e) => {
                        try {
                            // Prevent event propagation to fix cursor sticking issue
                            if (e.originalEvent) {
                                e.originalEvent.stopPropagation();
                                e.originalEvent.preventDefault();
                            }

                            const props = e && e.layer && e.layer.properties ? e.layer.properties : {};
                            const grid_id = Number(props.id) || props.id;
                            if (!grid_id) return;

                            // Prevent duplicate clicks using reusable function
                            if (isClickDuplicate(grid_id)) return;

                            // Fetch grid details using new unified API
                            try {

                                const fullUrl = buildGridDetailsUrl(grid_id, 'complaint_data,discovery_mr,high_load_data,simulation_data');

                                const startTime = performance.now();
                                const response = await debouncedApiRequest(`grid-details-${grid_id}`, fullUrl);
                                const endTime = performance.now();


                                if (response.ok) {
                                    const gridData = await response.json();

                                    if (gridData.available_categories.length > 0) {
                                        // Create feature object for GridDetailPanel
                                        const featureData = {
                                            type: 'Feature',
                                            properties: {
                                                id: grid_id,
                                                grid_id: grid_id,
                                                ...gridData.categories,
                                                coordinates: gridData.coordinates
                                            },
                                            geometry: null // Will be filled if needed
                                        };
                                        setSelectedGridData(featureData);
                                        setShowGridDetail(true);
                                    }
                                } else {
                                    console.error(`🌐 FRONTEND: ❌ Failed to fetch grid details: ${response.status}`);
                                    const errorText = await response.text();
                                    console.error(`🌐 FRONTEND: Error response body:`, errorText);
                                }
                            } catch (fetchErr) {
                                console.error('🌐 FRONTEND: ❌ Error fetching high load grid details:', fetchErr);
                                console.error('🌐 FRONTEND: Error stack:', fetchErr.stack);
                            }
                        } catch (err) {
                            console.error('High-load detail fetch failed', err);
                            alert('無法讀取話筒數據詳情');
                        }
                    });
                    mvtLayer.addTo(mapRef.current);
                    bandLayerGroups[band] = mvtLayer;
                    return; // Skip normal GeoJSON fetching flow
                }

                // Special handling: CMHK Test Data competition scenarios (MVT) — create one layer per LTE/NR scenario
                if (band.startsWith('cmhk_test_data_lte_competition_') || band.startsWith('cmhk_test_data_nr_competition_')) {
                    // 🚀 FIX: Clean up existing MVT layers for this band
                    cleanupExistingMVTLayers(band);
                    if (layers[band]) {
                        try { mapRef.current.removeLayer(layers[band]); } catch (e) { }
                    }

                    // Extract technology and scenario from band name
                    // Band format: cmhk_test_data_lte_competition_競弱我強 or cmhk_test_data_nr_competition_競弱我強
                    let technology, scenario;
                    if (band.startsWith('cmhk_test_data_lte_competition_')) {
                        technology = 'lte';
                        scenario = band.replace('cmhk_test_data_lte_competition_', '');
                    } else if (band.startsWith('cmhk_test_data_nr_competition_')) {
                        technology = 'nr';
                        scenario = band.replace('cmhk_test_data_nr_competition_', '');
                    }

                    // Build URL with spatial filtering using buildMVTUrl helper
                    const baseUrl = `${EXTERNAL_SERVER_URL}/competition_scenario_test/${technology}/${scenario}/mvt/{z}/{x}/{y}`;
                    const url = buildMVTUrl(baseUrl);

                    const mvtLayer = L.vectorGrid.protobuf(url, {
                        minZoom: 8,
                        maxZoom: 18,
                        pane: 'gridDataPane',
                        rendererFactory: L.canvas.tile,
                        updateWhileInteracting: true,
                        updateWhileAnimating: true,
                        interactive: true,
                        bubblingMouseEvents: false,  // 🚀 FIX: Prevent event bubbling to fix map dragging issue
                        vectorTileLayerStyles: {
                            grid: (properties) => {
                                let fillColor; // Default fallback color
                                if (scenario) {
                                    if (technology === 'lte' && LTE_COMPETITION_COLOR_MAP[scenario]) {
                                        fillColor = LTE_COMPETITION_COLOR_MAP[scenario];
                                    } else if (technology === 'nr' && NR_COMPETITION_COLOR_MAP[scenario]) {
                                        fillColor = NR_COMPETITION_COLOR_MAP[scenario];
                                    }
                                }

                                if (!fillColor) {
                                    return null;
                                }

                                return {
                                    fill: true,
                                    fillColor,
                                    fillOpacity: 0.7,
                                    stroke: true,
                                    color: '#ffffff',
                                    weight: 0.5
                                };
                            }
                        }
                    });
                    // Enable click to show grid detail in InfoPanel
                    mvtLayer.on('click', async (e) => {
                        try {
                            // Prevent event propagation to fix cursor sticking issue
                            if (e.originalEvent) {
                                e.originalEvent.stopPropagation();
                                e.originalEvent.preventDefault();
                            }

                            const props = e && e.layer && e.layer.properties ? e.layer.properties : {};
                            const grid_id = Number(props.id) || props.id;
                            if (!grid_id) return;

                            // Prevent duplicate clicks using reusable function
                            if (isClickDuplicate(grid_id)) return;

                            // Fetch grid details using new unified API
                            try {
                                const fullUrl = buildGridDetailsUrl(grid_id, 'cmhk_test_data,complaint_data,discovery_mr,high_load_data,simulation_data');

                                const startTime = performance.now();
                                const response = await debouncedApiRequest(`grid-details-${grid_id}`, fullUrl);
                                const endTime = performance.now();


                                if (response.ok) {
                                    const gridData = await response.json();

                                    if (gridData.available_categories.length > 0) {
                                        // Create feature object for GridDetailPanel
                                        const featureData = {
                                            type: 'Feature',
                                            properties: {
                                                id: grid_id,
                                                grid_id: grid_id,
                                                ...gridData.categories,
                                                coordinates: gridData.coordinates
                                            },
                                            geometry: null // Will be filled if needed
                                        };
                                        setSelectedGridData(featureData);
                                        setShowGridDetail(true);
                                    }
                                } else {
                                    console.error(`🌐 FRONTEND: ❌ Failed to fetch grid details: ${response.status}`);
                                    const errorText = await response.text();
                                    console.error(`🌐 FRONTEND: Error response body:`, errorText);
                                }
                            } catch (fetchErr) {
                                console.error('🌐 FRONTEND: ❌ Error fetching CMHK test data grid details:', fetchErr);
                                console.error('🌐 FRONTEND: Error stack:', fetchErr.stack);
                            }
                        } catch (err) {
                            console.error('CMHK test data detail fetch failed', err);
                            alert('無法讀取測試數據詳情');
                        }
                    });
                    mvtLayer.addTo(mapRef.current);
                    bandLayerGroups[band] = mvtLayer;
                    return; // Skip normal GeoJSON fetching flow
                }
                // Process each subbox with Promise wrapper
                const subboxPromises = subBoxes.map(async (box) => {
                    const { west, south, east, north } = box;
                    // 🚀 SMART CACHING: 使用网格化缓存键提高缓存命中率
                    // 将坐标舍入到0.01精度，增加缓存复用性
                    const roundedWest = Math.round(west * 100) / 100;
                    const roundedSouth = Math.round(south * 100) / 100;
                    const roundedEast = Math.round(east * 100) / 100;
                    const roundedNorth = Math.round(north * 100) / 100;
                    const cacheKey = `${band}-${roundedWest}-${roundedSouth}-${roundedEast}-${roundedNorth}`;

                    if (fetchCacheRef.current.has(cacheKey)) {
                        const cached = fetchCacheRef.current.get(cacheKey);
                        let filteredData = cached;
                        if (filteredData.features && filteredData.features.length) {
                            // 🚀 USE NEW ASYNC PROCESSING: Non-blocking data processing
                            const geometryType = filteredData.features[0].geometry.type;

                            // Process data asynchronously to prevent UI blocking
                            const finalData = await processDataAsyncBatch(filteredData, currentZoom, geometryType, style, band);
                            // 🚀 OPTIMIZED LAYER CREATION: Canvas rendering for polygons
                            let subLayer;
                            if (geometryType === 'Point' || geometryType === 'MultiPoint') {
                                // Use clustering for points to improve performance
                                const markers = L.markerClusterGroup({
                                    maxClusterRadius: currentZoom > 14 ? 30 : 50,
                                    disableClusteringAtZoom: 17,
                                    spiderfyOnMaxZoom: false,
                                    chunkedLoading: true
                                });

                                const geoJsonLayer = L.geoJSON(finalData, {
                                    pointToLayer: (feature, latlng) => {
                                        const scenarioValue = feature.properties.category;
                                        return L.circleMarker(latlng, {
                                            radius: Math.max(4, Math.min(8, currentZoom - 8)),
                                            fillColor: getDiscoveryMRColor(scenarioValue),
                                            color: 'white',
                                            weight: currentZoom > 15 ? 1 : 0.5,
                                            opacity: 1,
                                            fillOpacity: 0.7
                                        });
                                    },
                                    onEachFeature: createOnFeatureClick(band, band)
                                });
                                markers.addLayer(geoJsonLayer);
                                subLayer = markers;
                            } else {
                                // 🚀 OPTIMIZED CANVAS RENDERER: Adaptive settings for better performance
                                const canvasRenderer = L.canvas({
                                    padding: currentZoom > 15 ? 0.2 : 0.1, // Reduced padding at lower zoom
                                    tolerance: currentZoom > 15 ? 2 : currentZoom > 12 ? 4 : 6, // More aggressive tolerance
                                    pane: 'gridDataPane'
                                });

                                subLayer = L.geoJSON(finalData, {
                                    renderer: canvasRenderer,
                                    style: (feature) => {
                                        const baseStyle = typeof style === 'function' ? style(feature) : style;
                                        return {
                                            ...baseStyle,
                                            // More aggressive visual simplification for performance
                                            weight: currentZoom > 15 ? Math.min(baseStyle.weight || 1, 2) :
                                                currentZoom > 12 ? Math.min((baseStyle.weight || 1) * 0.6, 1.5) : 0.5,
                                            opacity: currentZoom > 12 ? (baseStyle.opacity || 0.8) : 0.5,
                                            fillOpacity: currentZoom > 12 ? (baseStyle.fillOpacity || 0.6) : 0.3
                                        };
                                    },
                                    onEachFeature: createOnFeatureClick(band, band)
                                });
                            }
                            if (subLayer) {
                                if (!bandLayerGroups[band]) {
                                    // Create optimized layer group with proper pane
                                    bandLayerGroups[band] = L.layerGroup();

                                    // Use dedicated pane for better z-index control
                                    if (mapRef.current.getPane('gridDataPane')) {
                                        bandLayerGroups[band].options.pane = 'gridDataPane';
                                    }
                                }

                                // Add with performance monitoring
                                const startTime = performance.now();
                                subLayer.addTo(bandLayerGroups[band]);
                                const renderTime = performance.now() - startTime;

                                if (renderTime > 100) {
                                    console.warn(`⚠️ Slow rendering detected for ${band}: ${Math.round(renderTime)}ms, ${finalData.features.length} features`);
                                }
                            }
                        }
                        return; // skip network fetch
                    }
                });

                // Add subbox promises to fetchPromises
                fetchPromises.push(...subboxPromises);
            } // This closes the for (const band of bands) loop

            await Promise.all(fetchPromises);

            // 🚀 PERFORMANCE FIX: Synchronized layer updates to prevent race conditions
            const updateLayers = () => {
                // Add new layers to the map
                Object.keys(bandLayerGroups).forEach((band) => {
                    if (mapRef.current && bandLayerGroups[band]) {
                        bandLayerGroups[band].addTo(mapRef.current);
                    }
                });

                // Batch state update
                setLayers((prevLayers) => {
                    const newLayers = { ...prevLayers };
                    bands.forEach((b) => delete newLayers[b]);
                    Object.keys(bandLayerGroups).forEach((b) => {
                        if (bandLayerGroups[b]) {
                            newLayers[b] = bandLayerGroups[b];
                        }
                    });
                    return newLayers;
                });
            };

            // Execute layer update with lock to prevent race conditions
            if (layerUpdateLockRef.current) {
                // Queue the update if another update is in progress
                pendingLayerUpdatesRef.current.push(updateLayers);
            } else {
                layerUpdateLockRef.current = true;
                updateLayers();

                // 🚀 MEMORY LEAK FIX: Clear any pending timeout before creating new one
                if (layerLockTimeoutRef.current) {
                    clearTimeout(layerLockTimeoutRef.current);
                }

                // Process any pending updates
                layerLockTimeoutRef.current = setTimeout(() => {
                    layerUpdateLockRef.current = false;
                    const pendingUpdates = pendingLayerUpdatesRef.current.splice(0);
                    if (pendingUpdates.length > 0) {
                        // Execute the last pending update to avoid duplicate work
                        const lastUpdate = pendingUpdates[pendingUpdates.length - 1];
                        lastUpdate();
                    }
                    layerLockTimeoutRef.current = null; // Clear ref after execution
                }, 0);
            }

            // 🚀 PERFORMANCE FIX: Debounced success message to prevent rapid state changes
        } catch (error) {
            console.error('Error in fetchBandData:', error);
            setErrorState({
                message: '數據加載過程中發生錯誤',
                type: 'general',
                timestamp: Date.now()
            });
        } finally {
            // 🚀 ZOOM PERFORMANCE: Reset processing flag
            zoomProcessingRef.current = false;
            if (zoomTimeoutRef.current) {
                clearTimeout(zoomTimeoutRef.current);
                zoomTimeoutRef.current = null;
            }
        }
    };

    // --------------------------------------------------------------------------
    // 🚀 OTHER TEST DATA: 基於行政區一次性加載其他測試數據
    const fetchOtherTestData = async (bands, latLngBounds) => {
        if (!mapRef.current || bands.length === 0) return;

        try {
            // 調用fetchBandData載入數據
            await fetchBandData(bands, latLngBounds);
        } catch (error) {
            console.error('❌ Error in fetchOtherTestData:', error);
        }
    };

    // --------------------------------------------------------------------------
    // 單次完整加載：當用戶同時選擇了行政區和數據後，基於行政區範圍一次性加載
    useEffect(() => {
        // Update selectedBandsRef to track current selections for zoom refresh
        selectedBandsRef.current = selectedBands;

        const loadAllForSelection = async () => {
            if (!mapRef.current) return;
            if (selectedBands.length === 0) return;

            // 🚀 PERFORMANCE: Use memoized band filters instead of inline computations
            // cmhkTestBands, sixDimensionBands, otherTestBands, siteBands, and normalSixDimensionBands
            // are all computed once via useMemo and reused here

            let boundsForSixDimension = mapRef.current.getBounds();

            try {
                if (cmhkTestBands.length > 0) {
                    // 🚀 SECURITY: Block 六維數據 (CMHK test data) access in 區域模式 - micro grids only
                    if (renderingMode === 'spatial' && selectedMicroGrids.length === 0) {
                        console.warn('🚫 CMHK測試數據已被阻止：請先選擇微網格');
                        alert('請先選擇微網格後才能存取六維數據。');
                        return;
                    }
                    // CMHK test data can use current map bounds - no district restriction
                    const boundsForCMHK = mapRef.current.getBounds();
                    await fetchBandData(cmhkTestBands, boundsForCMHK);
                }
                if (normalSixDimensionBands.length > 0) {

                    // 🚀 SECURITY: Block 六維數據 access in 區域模式 - micro grids only
                    if (renderingMode === 'spatial' && selectedMicroGrids.length === 0) {
                        console.warn('🚫 六維數據已被阻止：請先選擇微網格');
                        alert('請先選擇微網格後才能存取六維數據。');
                        return;
                    }
                    await fetchBandData(normalSixDimensionBands, boundsForSixDimension);
                }
                if (otherTestBands.length > 0) {
                    const boundsForOther = mapRef.current.getBounds();
                    await fetchOtherTestData(otherTestBands, boundsForOther);
                }

                // Handle site data separately - not affected by district filtering
                if (siteBands.length > 0) {
                    // 🚀 SECURITY: Block 六維數據 (site structure data) access in 區域模式 - micro grids only
                    if (renderingMode === 'spatial' && selectedMicroGrids.length === 0) {
                        console.warn('🚫 站點結構數據已被阻止：請先選擇微網格');
                        alert('請先選擇微網格後才能存取六維數據。');
                        return;
                    }
                    await handleSiteDataSelection(siteBands);
                }
            } finally {
            }
        };
        loadAllForSelection();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBands, selectedMicroGrids, renderingMode, cmhkTestBands, sixDimensionBands, otherTestBands, siteBands, normalSixDimensionBands]);

    // 🚀 PERFORMANCE OPTIMIZATION: Debounced micro grid selection handling
    // This prevents rapid API calls when users quickly select/deselect multiple micro grids
    const [debouncedMicroGrids, setDebouncedMicroGrids] = useState(selectedMicroGrids);

    useEffect(() => {
        // Only debounce micro grid changes, not initial selection
        if (selectedMicroGrids.length === 0) {
            setDebouncedMicroGrids([]);
            return;
        }

        const timer = setTimeout(() => {
            setDebouncedMicroGrids(selectedMicroGrids);
        }, 300); // 300ms debounce delay

        return () => clearTimeout(timer);
    }, [selectedMicroGrids]);

    // 🚀 PERFORMANCE OPTIMIZATION: Separate effect for debounced micro grid changes
    // This triggers data reload only after user has finished selecting micro grids
    useEffect(() => {
        // Only trigger reload if we have selected bands and this is a micro grid change (not initial load)
        if (selectedBands.length > 0 && debouncedMicroGrids !== selectedMicroGrids) {

            // Trigger data reload with debounced micro grids
            const loadDebouncedData = async () => {
                if (!mapRef.current) return;

                try {
                    const bounds = mapRef.current.getBounds();
                    await fetchBandData(selectedBands, bounds);
                } catch (error) {
                    console.error('Error loading debounced data:', error);
                }
            };

            loadDebouncedData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedMicroGrids]);

    // 🚀 NEW: Reload 126 new sites when selectedNewSiteKeys changes
    useEffect(() => {
        if (!mapRef.current) return;

        // Use a longer timeout to prevent multiple rapid API calls from TreeView changes
        const timeoutId = setTimeout(() => {
            const hasActivatedSites = selectedNewSiteKeys.includes('已開通站點');
            const hasOtherSelections = selectedNewSiteKeys.some(key => key !== '已開通站點');

            if (hasOtherSelections || hasActivatedSites) {
                // Load data when there are TreeView selections
                loadPlanningSites(['126 New Site']);
            } else {
                // Remove layers when no TreeView selections
                removeCustomLayer('site_structure_data_planning_sites_126 New Site');
                removeCustomLayer('site_structure_data_planning_sites_126 Activated Site');
            }
        }, 300);

        return () => clearTimeout(timeoutId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedNewSiteKeys]);

    // Site data selection is now handled in the main data loading function to prevent duplicate calls

    // 🚀 Handle site structure data selection - independent of district filtering
    const handleSiteDataSelection = async (siteBands) => {
        if (!mapRef.current) return;


        // Extract planning and live site selections
        const planningSites = siteBands
            .filter(band => band.startsWith('site_structure_data_planning_sites_'))
            .map(band => band.replace('site_structure_data_planning_sites_', ''));

        const liveSites = siteBands
            .filter(band => band.startsWith('site_structure_data_live_sites_'))
            .map(band => band.replace('site_structure_data_live_sites_', ''));

        // 🚀 NEW: Extract competitive sites selections
        const competitiveSites = siteBands
            .filter(band => band.startsWith('site_structure_data_competitive_sites_'))
            .map(band => band.replace('site_structure_data_competitive_sites_', ''));

        const complaintTOC = siteBands
            .filter(band => band.startsWith('complaint__toc_'))
            .map(band => band.replace('complaint__toc_', ''));

        try {
            // Load planning sites if selected
            if (planningSites.length > 0) {
                await loadPlanningSites(planningSites);
            }

            // Load live sites if selected  
            if (liveSites.length > 0) {
                await loadLiveSites(liveSites);
            }

            // 🚀 NEW: Load competitive sites if selected
            if (competitiveSites.length > 0) {
                await loadCompetitiveSites(competitiveSites);
            }

            if (complaintTOC.length > 0) {
                await loadComplaintTOC(complaintTOC);
            }
        } catch (error) {
            console.error('Error loading site data:', error);
            alert('站點數據加載失敗');
        }
    };

    // Load planning sites based on scenario selection (one layer per scenario)
    const loadPlanningSites = async (scenarios) => {

        // Separate regular scenarios from special site lists
        const regularScenarios = scenarios.filter(s => s !== '126 New Site' && s !== '729 Planning List');
        const has126NewSite = scenarios.includes('126 New Site');
        const has729PlanningList = scenarios.includes('729 Planning List');

        // Handle regular scenarios with existing database logic
        if (regularScenarios.length > 0) {
            try {
                const scenarioParam = regularScenarios.join(',');
                // Build URL with spatial filtering using buildApiUrl helper
                const baseUrl = `${EXTERNAL_SERVER_URL}/planning_sites?scenarios=${encodeURIComponent(scenarioParam)}`;
                const url = buildApiUrl(baseUrl);

                const res = await apiRequest(url);
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                const data = await res.json();

                const allFeatures = (data.features || []).filter(f =>
                    f && f.geometry && f.properties &&
                    (f.geometry.type === 'Point' || f.geometry.type === 'MultiPoint')
                );

                if (allFeatures.length > 0) {
                    // Build a map for quick truthy checks across different DB representations
                    const isTruthy = (value) => {
                        if (value === true || value === 1) return true;
                        if (typeof value === 'string') {
                            const s = value.trim().toLowerCase();
                            return s === 't' || s === 'true' || s === 'y' || s === 'yes' || s === '1';
                        }
                        return false;
                    };

                    // For each regular scenario, create its own layer and register with the exact key
                    regularScenarios.forEach((scenarioKey) => {
                        const featuresForScenario = allFeatures.filter(f => isTruthy(f.properties[scenarioKey]));
                        if (featuresForScenario.length === 0) return;

                        // Remove old layer for this scenario if exists to prevent duplicates
                        removeCustomLayer(`site_structure_data_planning_sites_${scenarioKey}`);

                        const layer = L.geoJSON(featuresForScenario, {
                            pane: 'planningSitesPane',
                            pointToLayer: (feature, latlng) => {
                                // Use primary_scenario from backend for shape determination
                                const primaryScenario = feature.properties.primary_scenario || scenarioKey;
                                const color = PLANNING_SCENARIO_COLOR_MAP[primaryScenario] || '#FF7800';

                                return createPlanningMarker(latlng, primaryScenario, color, feature);
                            },
                            onEachFeature: (feature, layer) => {
                                // Bind tooltip listing all active scenarios for this planning site
                                try {
                                    // Use satisfied_scenarios array from backend for more reliable data
                                    const satisfiedScenarios = feature.properties.satisfied_scenarios || [];
                                    const primaryScenario = feature.properties.primary_scenario;

                                    if (satisfiedScenarios.length > 0) {
                                        const labelList = satisfiedScenarios.map(scenario =>
                                            PLANNING_SCENARIO_LABEL_MAP[scenario] || scenario
                                        ).join('、');

                                        // Add indication if this is a multi-scenario site
                                        const multiScenarioIndicator = satisfiedScenarios.length > 1 ? ' [多場景]' : '';
                                        const shapeInfo = primaryScenario ? ` (${PLANNING_SCENARIO_SHAPE_MAP[primaryScenario] || 'circle'})` : '';
                                        const siteName = feature.properties['site_name'] || feature.properties['plan_site_id'] || '';
                                        const tooltip = `${siteName ? siteName + ' | ' : ''}場景：${labelList}${multiScenarioIndicator}${shapeInfo}`;
                                        layer.bindTooltip(tooltip, { direction: 'top', opacity: 0.9, offset: [0, -4] });
                                    }
                                } catch (e) { /* no-op */ }
                                layer.on('click', () => {
                                    setSelectedSiteData(feature);
                                    setShowSiteDetail(true);
                                });
                            },
                        });

                        layer.addTo(mapRef.current);
                        setLayers(prev => ({
                            ...prev,
                            [`site_structure_data_planning_sites_${scenarioKey}`]: layer,
                        }));
                    });
                }
            } catch (error) {
                console.error('Error loading regular planning sites:', error);
            }
        }

        // Handle "126 New Site" with special GeoJSON endpoint
        if (has126NewSite) {
            // Check if "已開通站點" is selected
            const hasActivatedSites = selectedNewSiteKeys.includes('已開通站點');
            const regularKeys = selectedNewSiteKeys.filter(key => key !== '已開通站點');

            // Load regular 126 new sites (SAF, 新站, NCR with filters)
            if (regularKeys.length > 0) {
                try {
                    // Build query parameters for TreeView filtering
                    const queryParams = new URLSearchParams();
                    queryParams.set('keys', regularKeys.join(','));

                    const url = `${EXTERNAL_SERVER_URL}/126_new_sites?${queryParams.toString()}`;

                    const res = await apiRequest(url);
                    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                    const data = await res.json();
                    // Backend should handle filtering based on keys parameter
                    let features = (data.features || []).filter(f =>
                        f && f.geometry && f.properties &&
                        f.geometry.type === 'Point'
                    );

                    if (features.length > 0) {
                        // Remove old layer if exists
                        removeCustomLayer('site_structure_data_planning_sites_126 New Site');

                        const layer = L.geoJSON(features, {
                            pane: 'newSitesPane',
                            pointToLayer: (feature, latlng) => {
                                // Use a special color for 126 New Sites
                                const color = '#FF6B35'; // Orange color for 126 New Sites
                                return createPlanningMarker(latlng, '126 New Site', color, feature);
                            },
                            onEachFeature: (feature, layer) => {
                                try {
                                    const siteName = feature.properties['site name'] || feature.properties['site ID'] || '';
                                    const district = feature.properties['District'] || '';
                                    const gradeInfo = feature.properties['Grade (A+, A)'] || '';
                                    const tooltip = `${siteName ? siteName + ' | ' : ''}126新站${district ? ' (' + district + ')' : ''}${gradeInfo ? ' [' + gradeInfo + ']' : ''}`;
                                    layer.bindTooltip(tooltip, { direction: 'top', opacity: 0.9, offset: [0, -4] });
                                } catch (e) { /* no-op */ }
                                layer.on('click', () => {
                                    setSelectedSiteData(feature);
                                    setShowSiteDetail(true);
                                });
                            }
                        });

                        layer.addTo(mapRef.current);
                        setLayers(prev => ({
                            ...prev,
                            'site_structure_data_planning_sites_126 New Site': layer,
                        }));

                    } else {
                        // Remove layer if no features
                        removeCustomLayer('site_structure_data_planning_sites_126 New Site');
                    }
                } catch (error) {
                    console.error('Error loading 126 New Sites:', error);
                    console.error('Error details:', {
                        url: `${EXTERNAL_SERVER_URL}/126_new_sites`,
                        selectedNewSiteKeys: regularKeys,
                        errorMessage: error.message,
                        errorStack: error.stack
                    });
                    alert(`加載126新站失敗: ${error.message}\n\n請檢查:\n1. 後端服務器是否運行\n2. 數據文件是否存在\n3. 控制台查看詳細錯誤`);
                }
            } else {
                // Remove layer if no regular keys selected
                removeCustomLayer('site_structure_data_planning_sites_126 New Site');
            }

            // Load activated sites (已開通站點)
            if (hasActivatedSites) {
                try {
                    const url = `${EXTERNAL_SERVER_URL}/126_activated_sites`;

                    const res = await apiRequest(url);
                    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                    const data = await res.json();

                    let features = (data.features || []).filter(f =>
                        f && f.geometry && f.properties &&
                        f.geometry.type === 'Point'
                    );

                    if (features.length > 0) {
                        // Remove old layer if exists
                        removeCustomLayer('site_structure_data_planning_sites_126 Activated Site');

                        const layer = L.geoJSON(features, {
                            pane: 'newSitesPane',
                            pointToLayer: (feature, latlng) => {
                                // Use a different color for activated sites
                                const color = '#00FF00'; // Green color for activated sites
                                return createPlanningMarker(latlng, '126 Activated Site', color, feature);
                            },
                            onEachFeature: (feature, layer) => {
                                try {
                                    const siteName = feature.properties['site name'] || feature.properties['site ID'] || '';
                                    const district = feature.properties['District'] || '';
                                    const gradeInfo = feature.properties['Grade (A+, A)'] || '';
                                    const siteType = feature.properties['Type'] || '';
                                    const tooltip = `${siteName ? siteName + ' | ' : ''}已開通站點${siteType ? ' [' + siteType + ']' : ''}${district ? ' (' + district + ')' : ''}${gradeInfo ? ' [' + gradeInfo + ']' : ''}`;
                                    layer.bindTooltip(tooltip, { direction: 'top', opacity: 0.9, offset: [0, -4] });
                                } catch (e) { /* no-op */ }
                                layer.on('click', () => {
                                    setSelectedSiteData(feature);
                                    setShowSiteDetail(true);
                                });
                            }
                        });

                        layer.addTo(mapRef.current);
                        setLayers(prev => ({
                            ...prev,
                            'site_structure_data_planning_sites_126 Activated Site': layer,
                        }));

                    } else {
                        // Remove layer if no features
                        removeCustomLayer('site_structure_data_planning_sites_126 Activated Site');
                    }
                } catch (error) {
                    console.error('Error loading 126 Activated Sites:', error);
                    console.error('Error details:', {
                        url: `${EXTERNAL_SERVER_URL}/126_activated_sites`,
                        errorMessage: error.message,
                        errorStack: error.stack
                    });
                    alert(`加載已開通站點失敗: ${error.message}\n\n請檢查:\n1. 後端服務器是否運行\n2. 數據文件是否存在\n3. 控制台查看詳細錯誤`);
                }
            } else {
                // Remove layer if activated sites not selected
                removeCustomLayer('site_structure_data_planning_sites_126 Activated Site');
            }
        }

        // Handle "729 Planning List" with dedicated database endpoint
        if (has729PlanningList) {
            try {
                // Build URL with spatial filtering using buildApiUrl helper
                const baseUrl = `${EXTERNAL_SERVER_URL}/planning_729_sites`;
                const url = buildApiUrl(baseUrl);

                const res = await apiRequest(url);
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                const data = await res.json();

                let features = (data.features || []).filter(f =>
                    f && f.geometry && f.properties &&
                    f.geometry.type === 'Point'
                );

                if (features.length > 0) {
                    // Remove old layer if exists
                    removeCustomLayer('site_structure_data_planning_sites_729 Planning List');

                    const layer = L.geoJSON(features, {
                        pane: 'planningSitesPane',
                        pointToLayer: (feature, latlng) => {
                            // Use a distinct color for 729 Planning List sites
                            const color = '#8B4789'; // Purple color for 729 Planning List
                            return createPlanningMarker(latlng, '729_planning', color, feature);
                        },
                        onEachFeature: (feature, layer) => {
                            try {
                                const siteName = feature.properties['site_name'] || feature.properties['site_id'] || '';
                                const district = feature.properties['district'] || '';
                                const grade = feature.properties['grade'] || '';
                                const solutionType = feature.properties['master_solution_type'] || '';
                                const tooltip = `${siteName ? siteName + ' | ' : ''}729清單${district ? ' (' + district + ')' : ''}${grade ? ' [' + grade + ']' : ''}${solutionType ? ' (' + solutionType + ')' : ''}`;
                                layer.bindTooltip(tooltip, { direction: 'top', opacity: 0.9, offset: [0, -4] });
                            } catch (e) { /* no-op */ }
                            layer.on('click', () => {
                                setSelectedSiteData(feature);
                                setShowSiteDetail(true);
                            });
                        }
                    });

                    layer.addTo(mapRef.current);
                    setLayers(prev => ({
                        ...prev,
                        'site_structure_data_planning_sites_729 Planning List': layer,
                    }));

                } else {
                    // Remove layer if no features
                    removeCustomLayer('site_structure_data_planning_sites_729 Planning List');
                }
            } catch (error) {
                console.error('Error loading 729 Planning List:', error);
                console.error('Error details:', {
                    url: `${EXTERNAL_SERVER_URL}/planning_729_sites`,
                    errorMessage: error.message,
                    errorStack: error.stack
                });
                alert(`加載729清單失敗: ${error.message}\n\n請檢查:\n1. 後端服務器是否運行\n2. 數據庫連接是否正常\n3. 控制台查看詳細錯誤`);
            }
        } else {
            // Remove layer if 729 Planning List not selected
            removeCustomLayer('site_structure_data_planning_sites_729 Planning List');
        }
    };

    // Load live sites based on site type selection (one layer per site type)
    const loadLiveSites = async (siteTypes) => {
        const siteTypeParam = siteTypes.join(',');

        // Build URL with spatial filtering using buildApiUrl helper
        const baseUrl = `${EXTERNAL_SERVER_URL}/live_sites?site_types=${encodeURIComponent(siteTypeParam)}`;
        const url = buildApiUrl(baseUrl);

        const res = await apiRequest(url);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();

        const allFeatures = (data.features || []).filter(f =>
            f && f.geometry && f.properties &&
            (f.geometry.type === 'Point' || f.geometry.type === 'MultiPoint')
        );

        if (allFeatures.length === 0) {
            return;
        }

        // Group features by site_type and create one layer per type
        const groups = new Map();
        allFeatures.forEach(f => {
            const key = f.properties.site_type;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(f);
        });

        // Map frontend selection keys to database site_type values
        const frontendToDbMapping = {
            'Outdoor Site': 'Outdoor',
            'Indoor Site': 'Indoor',
            'Indoor-Pico/Micro Site': ['Indoor-Pico', 'Indoor-Micro'],
            'Indoor + Outdoor Site': 'Indoor + Outdoor'
        };

        siteTypes.forEach((typeKey) => {
            // Get the actual database site_type(s) for this frontend selection
            let dbSiteTypes = frontendToDbMapping[typeKey];
            if (!dbSiteTypes) {
                console.warn(`Unknown site type: ${typeKey}`);
                return;
            }

            // Handle both single string and array of strings
            if (!Array.isArray(dbSiteTypes)) {
                dbSiteTypes = [dbSiteTypes];
            }

            // Collect all features for this frontend selection
            let allFeaturesForType = [];
            dbSiteTypes.forEach(dbType => {
                const features = groups.get(dbType) || [];
                allFeaturesForType.push(...features);
            });

            if (allFeaturesForType.length === 0) {
                return;
            }

            const features = allFeaturesForType;

            // Remove old layer for this site type if exists to prevent duplicates
            removeCustomLayer(`site_structure_data_live_sites_${typeKey}`);

            const layer = L.geoJSON(features, {
                pane: 'liveSitesPane',
                pointToLayer: (feature, latlng) => {
                    // Create triangle marker with zoom-dependent sizing and bold black border
                    const currentZoom = mapRef.current ? mapRef.current.getZoom() : 13;
                    const triangleMarker = createShapedMarker(latlng, 'triangle', {
                        fillColor: LIVE_SITE_TYPE_COLOR_MAP[typeKey] || '#999999',
                        color: '#000000',  // Black border for better visibility
                        weight: 2,         // Bold border
                        fillOpacity: 0.8,  // Slightly more opaque for better contrast
                    }, currentZoom);

                    return triangleMarker;
                },
                onEachFeature: (feature, layer) => {
                    // Bind tooltip with site name and type
                    try {
                        const nm = feature.properties['plan_site_name'] || feature.properties['site_name'] || feature.properties['live_site_id'] || '';
                        const tp = feature.properties['site_type'] || typeKey;
                        const tooltip = `${nm ? nm + ' | ' : ''}${tp}`;
                        layer.bindTooltip(tooltip, { direction: 'top', opacity: 0.9, offset: [0, -4] });
                    } catch (e) { /* no-op */ }

                    // Add click handler to the triangle marker
                    const clickHandler = () => {
                        setSelectedSiteData(feature);
                        setShowSiteDetail(true);
                    };

                    layer.on('click', clickHandler);
                },
            });

            layer.addTo(mapRef.current);
            setLayers(prev => ({
                ...prev,
                [`site_structure_data_live_sites_${typeKey}`]: layer,
            }));
        });
    };


    // Load live sites based on site type selection (one layer per site type)
    const loadComplaintTOC = async (siteTypes) => {
        const siteTypeParam = siteTypes.join(',');

        // Build URL with spatial filtering using buildApiUrl helper
        const baseUrl = `${EXTERNAL_SERVER_URL}/complaint_year?years=${encodeURIComponent(siteTypeParam)}`;
        const url = buildApiUrl(baseUrl);

        const res = await apiRequest(url);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();

        const allFeatures = (data.features || []).filter(f =>
            f && f.geometry && f.properties &&
            (f.geometry.type === 'Point' || f.geometry.type === 'MultiPoint')
        );

        if (allFeatures.length === 0) {
            return;
        }

        const groups = new Map();
        allFeatures.forEach(f => {
            const key = f.properties.raw_month.slice(0, 4);;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(f);
        });

        siteTypes.forEach((typeKey) => {

            // Collect all features for this frontend selection
            const features = groups.get(typeKey) || [];

            if (features.length === 0) {
                return;
            }

            // Remove old layer for this site type if exists to prevent duplicates
            removeCustomLayer(`complaint__toc_${typeKey}`);

            const layer = L.geoJSON(features, {
                pane: 'complaintsPane',
                pointToLayer: (feature, latlng) => {
                    const color = '#ff0000ff'; // Green color for activated sites
                    return createPlanningMarker(latlng, 'Complaint TOC ' + typeKey, color, feature);
                },
                onEachFeature: (feature, layer) => {
                    // Bind tooltip with site name and type
                    try {
                        const tooltip = feature.properties['final_final_name_chi'] || typeKey;
                        layer.bindTooltip(tooltip, { direction: 'top', opacity: 0.9, offset: [0, -4] });
                    } catch (e) { /* no-op */ }

                    // Add click handler to the triangle marker
                    const clickHandler = () => {
                        feature.properties.onlyothers = true;
                        setSelectedSiteData(feature);
                        setShowSiteDetail(true);
                    };

                    layer.on('click', clickHandler);
                },
            });

            layer.addTo(mapRef.current);
            setLayers(prev => ({
                ...prev,
                [`complaint__toc_${typeKey}`]: layer,
            }));
        });
    };

    // 🚀 NEW: Load competitive sites based on file selection with indoor/outdoor categorization
    const loadCompetitiveSites = async (selectedFiles) => {
        console.log(`🔍 [loadCompetitiveSites] Called with files:`, selectedFiles);
        console.log(`🔍 [loadCompetitiveSites] Current renderingMode:`, renderingMode);
        console.log(`🔍 [loadCompetitiveSites] Current selectedMicroGrids:`, selectedMicroGrids.length > 0 ? selectedMicroGrids.map(g => g.id || g) : 'None');

        // Parse the file names to extract base file and category (indoor/outdoor)
        const fileRequests = selectedFiles.map(file => {
            // Special handling for H3 sites
            if (file === 'h3_sites') {
                return { baseFile: 'h3_sites', category: null, originalFile: 'h3_sites' };
            }
            if (file.endsWith('_indoor') || file.endsWith('_outdoor')) {
                const category = file.endsWith('_indoor') ? 'indoor' : 'outdoor';
                const baseFile = file.replace(/_indoor$|_outdoor$/, '');
                return { baseFile, category, originalFile: file };
            } else {
                // Legacy support for non-categorized files
                return { baseFile: file, category: null, originalFile: file };
            }
        });

        // Group by base file to minimize API calls
        const fileGroups = {};
        fileRequests.forEach(req => {
            if (!fileGroups[req.baseFile]) {
                fileGroups[req.baseFile] = [];
            }
            fileGroups[req.baseFile].push(req);
        });

        const allMarkers = [];

        for (const [baseFile, requests] of Object.entries(fileGroups)) {
            // Special handling for H3 sites
            if (baseFile === 'h3_sites') {
                try {
                    // Load H3 geojson data from backend
                    const baseUrl = `${EXTERNAL_SERVER_URL}/competitive_sites/h3_sites`;
                    const url = buildApiUrl(baseUrl);
                    const response = await apiRequest(url);
                    if (!response.ok) {
                        throw new Error(`Failed to load H3 geojson data: ${response.status}`);
                    }
                    const h3GeojsonData = await response.json();

                    // Filter H3 hexagon features
                    const h3Features = h3GeojsonData.features.filter(feature =>
                        feature.properties && feature.properties.description === "分级六边形网格"
                    );

                    // Filter H3 base station features
                    const cmhkBaseStations = h3GeojsonData.features.filter(feature =>
                        feature.properties && feature.properties.description === "cmhk基站"
                    );

                    const otherBaseStations = h3GeojsonData.features.filter(feature =>
                        feature.properties && feature.properties.description === "别家基站"
                    );

                    // Filter weak signal area grids (方格)
                    const weakSignalGrids = h3GeojsonData.features.filter(feature =>
                        feature.properties && feature.properties.description === "网格内的弱信号区域"
                    );

                    // Process weak signal grid features
                    weakSignalGrids.forEach(feature => {
                        if (!feature.geometry || !feature.geometry.coordinates) return;

                        allMarkers.push({
                            feature,
                            originalFile: 'h3_sites',
                            baseFile: 'h3_sites',
                            category: 'weak_signal_grid',
                            isWeakSignalGrid: true  // Mark as weak signal grid
                        });
                    });

                    // Process H3 hexagon features as markers
                    h3Features.forEach(feature => {
                        if (!feature.geometry || !feature.geometry.coordinates) return;

                        const coordinates = feature.geometry.coordinates[0];
                        const centerLat = coordinates.reduce((sum, coord) => sum + coord[1], 0) / coordinates.length;
                        const centerLng = coordinates.reduce((sum, coord) => sum + coord[0], 0) / coordinates.length;
                        const latlng = L.latLng(centerLat, centerLng);
                        const color = feature.properties.color || '#808080';

                        allMarkers.push({
                            latlng,
                            color,
                            feature,
                            originalFile: 'h3_sites',
                            baseFile: 'h3_sites',
                            category: 'h3',
                            isH3: true  // Mark as H3 for special handling
                        });
                    });

                    // Process CMHK base stations
                    cmhkBaseStations.forEach(feature => {
                        if (!feature.geometry || !feature.geometry.coordinates) return;

                        const [lng, lat] = feature.geometry.coordinates;
                        const latlng = L.latLng(lat, lng);

                        allMarkers.push({
                            latlng,
                            color: '#00ff00',  // Green for CMHK
                            feature,
                            originalFile: 'h3_sites',
                            baseFile: 'h3_sites',
                            category: 'h3_cmhk_base',
                            isH3BaseStation: true
                        });
                    });

                    // Process other base stations
                    otherBaseStations.forEach(feature => {
                        if (!feature.geometry || !feature.geometry.coordinates) return;

                        const [lng, lat] = feature.geometry.coordinates;
                        const latlng = L.latLng(lat, lng);

                        allMarkers.push({
                            latlng,
                            color: '#0000ff',  // Blue for other operators
                            feature,
                            originalFile: 'h3_sites',
                            baseFile: 'h3_sites',
                            category: 'h3_other_base',
                            isH3BaseStation: true
                        });
                    });
                } catch (error) {
                    console.error('Error loading H3 sites:', error);
                }
                continue;
            }

            const categories = requests.map(r => r.category).filter(c => c);
            let baseUrl = `${EXTERNAL_SERVER_URL}/competitive_sites/${baseFile}`;

            if (categories.length > 0) {
                baseUrl += `?categories=${encodeURIComponent(categories.join(','))}`;
            }

            // Build URL with spatial filtering using buildApiUrl helper
            const url = buildApiUrl(baseUrl);
            console.log(`🔍 [loadCompetitiveSites] Generated URL for ${baseFile}:`, url);

            try {
                const response = await apiRequest(url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();
                if (!data.features || !Array.isArray(data.features)) {
                    throw new Error('Invalid response format');
                }

                console.log(`✅ [loadCompetitiveSites] Received ${data.features.length} features for ${baseFile} from backend`);
                console.log(`✅ [loadCompetitiveSites] Response metadata:`, data.metadata);

                // Process features for this base file
                data.features.forEach(feature => {
                    if (!feature.geometry || !feature.geometry.coordinates) return;

                    const [lng, lat] = feature.geometry.coordinates;
                    const latlng = L.latLng(lat, lng);

                    // Determine which category this feature belongs to
                    let featureCategory;
                    if (baseFile === 'hkt2025_sites') {
                        // For hkt2025_sites, use "Site Type" property
                        featureCategory = feature.properties['Site Type'];
                    } else if (baseFile === 'smt_sites') {
                        // For smt_sites, use "TYPE" property
                        featureCategory = feature.properties['TYPE'];
                    } else if (baseFile === 'hut_sites') {
                        // For hut_sites, use "sitetype" property
                        featureCategory = feature.properties['sitetype'];
                    } else {
                        // For hkt4g_1800 and hkt4g_900, use "coveragetype" property
                        featureCategory = feature.properties['coveragetype'];
                    }

                    // Check if this feature should be included based on selected categories
                    const shouldInclude = requests.some(req =>
                        req.category === null || req.category?.toLowerCase() === featureCategory?.toLowerCase()
                    );

                    if (!shouldInclude) return;

                    // Determine marker color based on source file and category
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

                    // Find the corresponding original file name for coloring
                    const matchingRequest = requests.find(req =>
                        req.category === null || req.category?.toLowerCase() === featureCategory?.toLowerCase()
                    );
                    const colorKey = matchingRequest ? matchingRequest.originalFile : `${baseFile}_${featureCategory}`;
                    const color = competitiveSiteColors[colorKey] || '#ff6b35';

                    allMarkers.push({
                        latlng,
                        color,
                        feature,
                        originalFile: matchingRequest?.originalFile || baseFile,
                        baseFile,
                        category: featureCategory
                    });
                });

            } catch (error) {
                console.error(`Error loading competitive sites for ${baseFile}:`, error);
                alert(`加載競對站點失敗 (${baseFile}): ${error.message}`);
            }
        }

        if (allMarkers.length === 0) {
            return;
        }

        try {
            // Separate H3 markers, H3 base stations, weak signal grids, and other markers
            const h3Markers = allMarkers.filter(m => m.isH3);
            const h3BaseStations = allMarkers.filter(m => m.isH3BaseStation);
            const weakSignalGrids = allMarkers.filter(m => m.isWeakSignalGrid);
            const otherMarkers = allMarkers.filter(m => !m.isH3 && !m.isH3BaseStation && !m.isWeakSignalGrid);

            // Create H3 layer group (includes hexagons, weak signal grids, and base stations)
            if (h3Markers.length > 0 || h3BaseStations.length > 0 || weakSignalGrids.length > 0) {
                // Remove existing H3 layer first to avoid layering
                removeCustomLayer('site_structure_data_competitive_sites_h3_sites');

                // Clean up previous H3 zoom listener if it exists
                if (h3ZoomListenerRef.current && mapRef.current) {
                    mapRef.current.off('zoomend', h3ZoomListenerRef.current);
                    h3ZoomListenerRef.current = null;
                }

                const h3LayerGroup = L.layerGroup();

                // Add hexagon polygons
                h3Markers.forEach(({ latlng, color, feature }) => {
                    // 只绘制有弱信号的区域（red_grid_count > 0 或 weak_signal_level 存在）
                    const redGridCount = feature.properties.red_grid_count || 0;
                    const weakSignalLevel = feature.properties.weak_signal_level;

                    // 只显示有弱信号的区域
                    if (redGridCount === 0 && !weakSignalLevel) {
                        return; // 跳过没有弱信号的区域
                    }

                    // Use the actual hexagon polygon from geojson coordinates
                    const coordinates = feature.geometry.coordinates[0];
                    const latLngs = coordinates.map(coord => L.latLng(coord[1], coord[0]));

                    // 根据弱信号等级设置不同的透明度
                    let fillOpacity = 0.5; // 默认透明度
                    if (weakSignalLevel === '大量') {
                        fillOpacity = 0.6; // 严重弱信号区域透明度稍高
                    } else if (weakSignalLevel === '中等') {
                        fillOpacity = 0.4; // 中等弱信号区域透明度稍低
                    }

                    const polygon = L.polygon(latLngs, {
                        fillColor: color,
                        fillOpacity: fillOpacity,  // 中间填充透明度适中
                        color: color,  // 边框颜色与填充颜色一致
                        opacity: 1.0,  // 边框不透明
                        weight: 2,  // 边框稍粗一些
                        interactive: true
                    });

                    // H3 hexagon popup content
                    const popupContent = `
                        <div class="competitive-site-popup">
                            <p><strong>所屬行政區:</strong> ${feature.properties.district_name || 'N/A'}</p>
                            <p><strong>弱信號等級:</strong> ${feature.properties.weak_signal_level || 'N/A'}</p>
                            <p><strong>我弱柵格數量:</strong> ${feature.properties.red_grid_count || 'N/A'}</p>
                            <p><strong>CMHK基站數量:</strong> ${feature.properties.cmhk_base_count || 'N/A'}</p>
                            <p><strong>H站點數量:</strong> ${feature.properties.other_base_count || 'N/A'}</p>
                            <p><strong>與H站點數量差距:</strong> ${feature.properties.base_difference || 'N/A'}</p>
                        </div>
                    `;

                    polygon.bindPopup(popupContent);

                    h3LayerGroup.addLayer(polygon);
                });

                // Add weak signal grid squares (弱信号方格)
                console.log(`🔴 Loading ${weakSignalGrids.length} weak signal grid squares`);

                weakSignalGrids.forEach(({ feature }) => {
                    if (!feature || !feature.geometry || !feature.geometry.coordinates) return;

                    // Use the actual polygon coordinates from geojson
                    const coordinates = feature.geometry.coordinates[0];
                    const latLngs = coordinates.map(coord => L.latLng(coord[1], coord[0]));

                    // Draw red squares with high transparency fill
                    const gridSquare = L.polygon(latLngs, {
                        fillColor: '#ff0000',    // 红色填充
                        fillOpacity: 0.25,       // 填充高透明度（更透明）
                        color: '#ff0000',        // 红色边框
                        opacity: 1.0,            // 边框不透明
                        weight: 1.5,             // 边框宽度
                        interactive: true
                    });


                    h3LayerGroup.addLayer(gridSquare);
                });

                // Add base station circle markers
                // Function to calculate radius based on zoom level
                const getRadiusForZoom = (zoom) => {
                    if (zoom <= 10) return 1;      // Very small at low zoom
                    if (zoom <= 12) return 2;      // Small at medium-low zoom
                    if (zoom <= 14) return 3;      // Normal at medium zoom
                    return 4;                       // Slightly larger at high zoom
                };

                const currentZoom = mapRef.current.getZoom();
                const baseStationMarkers = []; // Store markers for zoom updates

                h3BaseStations.forEach(({ latlng, color, feature, category }) => {
                    const circleMarker = L.circleMarker(latlng, {
                        radius: getRadiusForZoom(currentZoom),
                        fillColor: color,
                        fillOpacity: 0.6,  // Add transparency
                        color: '#ffffff',
                        weight: 1,
                        opacity: 0.8  // Add transparency to border
                    });

                    // Base station popup content
                    const stationType = category === 'h3_cmhk_base' ? 'CMHK 基站' : '別家基站';

                    // Different content for CMHK vs Other base stations
                    let popupContent, tooltipContent;

                    if (category === 'h3_cmhk_base') {
                        // CMHK 自家基站：显示 id, name, lat, lon, type
                        popupContent = `
                            <div class="competitive-site-popup">
                                <h4>${stationType}</h4>
                                <p><strong>站點ID:</strong> ${feature.properties.site_id || 'N/A'}</p>
                                <p><strong>站點名稱:</strong> ${feature.properties.site_name || 'N/A'}</p>
                                <p><strong>緯度:</strong> ${feature.properties.latitude || 'N/A'}</p>
                                <p><strong>經度:</strong> ${feature.properties.longitude || 'N/A'}</p>
                                <p><strong>站點類型:</strong> ${feature.properties.site_coverage_type || 'N/A'}</p>
                                <p><strong>H3索引:</strong> ${feature.properties.h3_index || 'N/A'}</p>
                                <p><strong>所屬行政區:</strong> ${feature.properties.district_name || 'N/A'}</p>
                            </div>
                        `;

                        tooltipContent = `
                            <strong>${stationType}</strong><br/>
                            Site_ID: ${feature.properties.site_id || 'N/A'}<br/>
                            Site_Name: ${feature.properties.site_name || 'N/A'}<br/>
                            Latitude: ${feature.properties.latitude || 'N/A'}<br/>
                            Longitude: ${feature.properties.longitude || 'N/A'}<br/>
                            Type: ${feature.properties.site_coverage_type || 'N/A'}
                        `;
                    } else {
                        // 別家基站：显示 BName, location, lat, lon
                        popupContent = `
                            <div class="competitive-site-popup">
                                <h4>${stationType}</h4>
                                <p><strong>基站名稱:</strong> ${feature.properties.eNodeBName || 'N/A'}</p>
                                <p><strong>站點位置:</strong> ${feature.properties.Site_Location || 'N/A'}</p>
                                <p><strong>緯度:</strong> ${feature.properties.latitude || 'N/A'}</p>
                                <p><strong>經度:</strong> ${feature.properties.longitude || 'N/A'}</p>
                                <p><strong>站點類型:</strong> ${feature.properties.site_coverage_type || 'N/A'}</p>
                                <p><strong>H3索引:</strong> ${feature.properties.h3_index || 'N/A'}</p>
                                <p><strong>所屬行政區:</strong> ${feature.properties.district_name || 'N/A'}</p>
                            </div>
                        `;

                        tooltipContent = `
                            <strong>${stationType}</strong><br/>
                            eNodeBName: ${feature.properties.eNodeBName || 'N/A'}<br/>
                            Location: ${feature.properties.Site_Location || 'N/A'}<br/>
                            Latitude: ${feature.properties.latitude || 'N/A'}<br/>
                            Longitude: ${feature.properties.longitude || 'N/A'}
                        `;
                    }

                    // Bind popup
                    circleMarker.bindPopup(popupContent);

                    // Add tooltip for hover effect
                    circleMarker.bindTooltip(tooltipContent, {
                        permanent: false,
                        direction: 'top',
                        className: 'h3-base-station-tooltip'
                    });

                    baseStationMarkers.push(circleMarker);
                    h3LayerGroup.addLayer(circleMarker);
                });

                // Update marker size on zoom
                const onZoomEnd = () => {
                    const zoom = mapRef.current.getZoom();
                    const newRadius = getRadiusForZoom(zoom);
                    baseStationMarkers.forEach(marker => {
                        marker.setRadius(newRadius);
                    });
                };

                // Store listener reference for cleanup and add zoom event listener
                h3ZoomListenerRef.current = onZoomEnd;
                mapRef.current.on('zoomend', onZoomEnd);

                h3LayerGroup.addTo(mapRef.current);

                setLayers(prev => ({
                    ...prev,
                    'site_structure_data_competitive_sites_h3_sites': h3LayerGroup
                }));
            }

            if (otherMarkers.length === 0) {
                return;
            }

            const markerClusterGroup = L.markerClusterGroup({
                iconCreateFunction: function (cluster) {
                    const count = cluster.getChildCount();
                    let className = 'competitive-cluster-small';
                    if (count > 10) className = 'competitive-cluster-medium';
                    if (count > 50) className = 'competitive-cluster-large';

                    return L.divIcon({
                        html: `<div><span>${count}</span></div>`,
                        className: `competitive-cluster ${className}`,
                        iconSize: L.point(50, 50)
                    });
                },
                spiderfyOnMaxZoom: true,
                showCoverageOnHover: false,
                zoomToBoundsOnClick: true,
                maxClusterRadius: 50,
                pane: 'competitiveSitesPane'
            });

            // Add other markers to cluster group
            otherMarkers.forEach(({ latlng, color, feature, originalFile, baseFile, category }) => {
                const [lng, lat] = [latlng.lng, latlng.lat];

                // Create diamond marker for competitive sites
                const currentZoom = mapRef.current ? mapRef.current.getZoom() : 13;
                const marker = createShapedMarker(latlng, 'diamond', {
                    fillColor: color,
                    color: '#000000',  // Bold black border for all competitive sites
                    weight: 2,         // Bold border for better visibility
                    fillOpacity: 0.8,
                }, currentZoom);

                // Popup content
                const popupContent = `
                    <div class="competitive-site-popup">
                        <h4>競對站點 - ${category === 'indoor' ? '室內' : '室外'}</h4>
                        <p><strong>來源:</strong> ${originalFile}</p>
                        <p><strong>類型:</strong> ${baseFile.replace('hkt', 'HKT ')}</p>
                        <p><strong>覆蓋類型:</strong> ${category === 'indoor' ? '室內覆蓋' : '室外覆蓋'}</p>
                        ${feature.properties.eNodeBName ? `<p><strong>基站名稱:</strong> ${feature.properties.eNodeBName}</p>` : ''}
                        ${feature.properties['行标签'] ? `<p><strong>站點標識:</strong> ${feature.properties['行标签']}</p>` : ''}
                        ${feature.properties.Site_Location ? `<p><strong>位置:</strong> ${feature.properties.Site_Location}</p>` : ''}
                        ${feature.properties.freq ? `<p><strong>頻段:</strong> ${feature.properties.freq}</p>` : ''}
                        ${feature.properties.N78 ? `<p><strong>N78:</strong> ${feature.properties.N78}</p>` : ''}
                        ${feature.properties.N79 ? `<p><strong>N79:</strong> ${feature.properties.N79}</p>` : ''}
                        ${feature.properties.N1 ? `<p><strong>N1:</strong> ${feature.properties.N1}</p>` : ''}
                        <p><strong>坐標:</strong> ${lat.toFixed(6)}, ${lng.toFixed(6)}</p>
                    </div>
                `;

                marker.bindPopup(popupContent);
                markerClusterGroup.addLayer(marker);
            });

            selectedFiles.filter(f => f !== 'h3_sites').forEach(file => {
                removeCustomLayer(`site_structure_data_competitive_sites_${file}`);
            });

            // Add cluster group to map
            markerClusterGroup.addTo(mapRef.current);

            setLayers(prev => {
                const newLayers = { ...prev };
                selectedFiles.filter(f => f !== 'h3_sites').forEach(file => {
                    newLayers[`site_structure_data_competitive_sites_${file}`] = markerClusterGroup;
                });
                return newLayers;
            });


        } catch (error) {
            console.error('Error loading competitive sites:', error);
            alert(`加載競對站點失敗: ${error.message}`);
        }
    };

    // --------------------------------------------------------------------------
    // Click handler for each polygon/point
    const createOnFeatureClick = (datasetName, bandName) => (feature, layer) => {
        layer.on('click', async () => {
            // 1. If you click the same layer again, toggle it off
            if (highlightedLayer === layer) {
                layer.setStyle({ weight: 2, color: 'white', fillOpacity: 0.7 });
                setHighlightedLayer(null);
                return;
            }

            // Grab the grid ID
            const grid_id = Number(feature.properties.id) || feature.properties.id;

            // 🚀 ENHANCED: Check if multiple six-dimension datasets are available
            const sixDimensionBands = selectedBands.filter(band => (
                // Six-Dimension data categories (testing data is NOT part of six-dimension data)
                band.startsWith('complaint__') ||                 // Complaint data (note double underscore)
                band.startsWith('Discovery_MR_Data_NR_') ||       // Discovery MR data
                band.startsWith('microphone_data_') ||            // Microphone/high load data
                band.startsWith('site_structure_data_')           // Site structure data
            ));

            // 🚀 OPTIMIZED: Use new backend endpoint for efficient multi-dataset fetching
            if (sixDimensionBands.length > 1) {
                try {
                    // Map selected datasets to categories based on actual band naming patterns
                    const categories = new Set();
                    sixDimensionBands.forEach(bandName => {
                        // Discovery MR data (competitive analysis)
                        if (bandName.startsWith('Discovery_MR_Data_NR_')) {
                            categories.add('discovery_mr');
                        }
                        // Complaint data
                        if (bandName.startsWith('complaint__')) {
                            categories.add('complaint_data');
                        }
                        // High load data (microphone/traffic data)
                        if (bandName.startsWith('microphone_data_')) {
                            categories.add('high_load_data');
                        }
                    });


                    // Fetch data for all detected categories
                    const categoriesString = categories.size > 0 ? Array.from(categories).join(',') : null;
                    const fullUrl = buildGridDetailsUrl(grid_id, categoriesString);
                    const response = await debouncedApiRequest(`panel-grid-details-${grid_id}`, fullUrl);

                    if (response.ok) {
                        const gridData = await response.json();
                        if (gridData.available_categories.length > 0) {
                            // Create feature object for GridDetailPanel with multi-category data
                            const featureData = {
                                type: 'Feature',
                                properties: {
                                    id: grid_id,
                                    grid_id: grid_id,
                                    selected_datasets: sixDimensionBands,
                                    multi_selection: true,
                                    ...gridData.categories,
                                    coordinates: gridData.coordinates
                                },
                                geometry: null // Will be filled if needed
                            };
                            setSelectedGridData(featureData);
                            setShowGridDetail(true);
                        } else {
                            alert(`網格 ${grid_id} 在所選數據集中無可用數據`);
                        }
                    } else {
                        console.error(`Failed to fetch multi-dataset grid details: ${response.status}`);
                        alert('無法讀取網格詳情，請稍後再試。');
                    }
                } catch (err) {
                    console.error('Failed to fetch multiple dataset data:', err);
                    alert('無法讀取網格詳情，請稍後再試。');
                }
                return;
            }

            // ─── Single dataset handling (original logic) ───────────────────────────────

            // ─── Special case for "話筒數據" (cmhk_grid_highload) ────────────────────────
            if (datasetName.startsWith('microphone_data')) {
                // Fetch high load grid details using unified API  
                try {
                    const fullUrl = buildGridDetailsUrl(grid_id, 'complaint_data,discovery_mr,high_load_data,simulation_data');
                    const response = await debouncedApiRequest(`panel-grid-details-${grid_id}`, fullUrl);
                    if (response.ok) {
                        const gridData = await response.json();
                        if (gridData.available_categories.length > 0) {
                            // Create feature object for GridDetailPanel
                            const featureData = {
                                type: 'Feature',
                                properties: {
                                    id: grid_id,
                                    grid_id: grid_id,
                                    dataset_name: datasetName,
                                    ...gridData.categories,
                                    coordinates: gridData.coordinates
                                },
                                geometry: null // Will be filled if needed
                            };
                            setSelectedGridData(featureData);
                            setShowGridDetail(true);
                        }
                    } else {
                        console.error(`Failed to fetch microphone data: ${response.status}`);
                    }
                } catch (fetchErr) {
                    console.error('Error fetching microphone data details:', fetchErr);
                }
                return;
            }

            // ─── All other datasets ─────────────────────────────────────────────────────
            try {
                // Determine scenario key (for MR / LTE / NR)
                let scenarioKey;
                if (
                    datasetName.startsWith('Discovery MR Data') ||
                    datasetName.includes('Discovery_MR_Data')
                ) {
                    const parts = bandName.split('_');
                    scenarioKey = parts[parts.length - 1];
                } else {
                    scenarioKey = bandName || feature.properties.band;
                }

                // Fetch grid details using new unified API
                try {
                    // Map dataset names to categories
                    let categories = [];
                    if (datasetName.includes('cmhk_weak_coverage') || datasetName.includes('CMHK_Test_Data') || datasetName.includes('competition_scenario')) {
                        categories.push('cmhk_test_data');
                    }
                    if (datasetName.includes('Discovery_MR_Data')) {
                        categories.push('discovery_mr');
                    }
                    if (datasetName.includes('complaint_data')) {
                        categories.push('complaint_data');
                    }
                    if (datasetName.includes('microphone_data') || datasetName.includes('cmhk_grid_highload')) {
                        categories.push('high_load_data');
                    }
                    if (datasetName.includes('simulation_data')) {
                        categories.push('simulation_data');
                    }

                    // If no specific category detected, fetch all available data
                    const categoriesString = categories.length > 0 ? categories.join(',') : null;

                    const fullUrl = buildGridDetailsUrl(grid_id, categoriesString);
                    const response = await debouncedApiRequest(`panel-grid-details-${grid_id}`, fullUrl);
                    if (response.ok) {
                        const gridData = await response.json();
                        if (gridData.available_categories.length > 0) {
                            // Create feature object for GridDetailPanel
                            const featureData = {
                                type: 'Feature',
                                properties: {
                                    id: grid_id,
                                    grid_id: grid_id,
                                    dataset_name: datasetName,
                                    scenario_key: scenarioKey,
                                    ...gridData.categories,
                                    coordinates: gridData.coordinates
                                },
                                geometry: null // Will be filled if needed
                            };
                            setSelectedGridData(featureData);
                            setShowGridDetail(true);
                        }
                    } else {
                        console.error(`Failed to fetch grid details: ${response.status}`);
                    }
                } catch (fetchErr) {
                    console.error('Error fetching grid details:', fetchErr);
                }

                // Still preserve highlight styling for visual feedback
                if (highlightedLayer) {
                    highlightedLayer.setStyle({ weight: 2, color: 'white', fillOpacity: 0.7 });
                }
                layer.setStyle({ weight: 6, color: 'blue', fillOpacity: 0.9 });
                setHighlightedLayer(layer);
            } catch (err) {
                console.error('Failed to fetch data:', err);
                alert('Failed to retrieve grid details. Please try again.');
            }
        });
    };


    // --------------------------------------------------------------------------
    // 🚀 錯誤處理和重試機制
    const handleRetry = useCallback(() => {
        if (!errorState) return;

        // 清除錯誤狀態
        setErrorState(null);
        setRetryAttempts(prev => prev + 1);

        // 根據錯誤類型決定重試策略
        if (errorState.type === 'network' || errorState.type === 'server') {
            // 重新加載當前選中的數據
            if (selectedBands.length > 0) {
                // Use current map bounds for retry (micro grid filtering handled by backend)
                const bounds = mapRef.current.getBounds();
                if (bounds) {
                    fetchBandData(selectedBands, bounds);
                }
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [errorState, selectedBands]);

    const dismissError = useCallback(() => {
        setErrorState(null);
    }, []);

    // --------------------------------------------------------------------------
    // Helper function to check if a band is blocked in spatial mode
    const isBandBlockedInSpatialMode = (band) => {
        // Not in spatial mode → no blocking
        if (renderingMode !== 'spatial') return false;

        // Require at least one micro grid to unlock 六維數據
        const missingRequiredSelections = (selectedMicroGrids.length === 0);
        if (!missingRequiredSelections) return false; // user has met prerequisites

        // Identify 六維數據 related bands
        const isCMHKTestBand = band.startsWith('testing_data_lte_cmhk_') ||
            band.startsWith('testing_data_nr_cmhk_');

        const isNormalSixDimensionBand = band.startsWith('simulation_data_') ||
            band.startsWith('complaint_') ||
            band.startsWith('Discovery_MR_Data_NR') ||
            band.startsWith('microphone_data') ||
            band.startsWith('cmhk_test_data_');

        const isSiteBand = band.startsWith('site_structure_data_');

        return isCMHKTestBand || isNormalSixDimensionBand || isSiteBand;
    };

    // Band selection callbacks - 多選支持
    const handleBandSelect = (bands, deselectedBand) => {
        // 🚀 IMPROVED: 処理取消選擇的情況
        if (deselectedBand) {
            removeCustomLayer(deselectedBand);
        }

        // 🚀 IMPROVED: 檢查是否有圖層需要被移除（比較新舊選擇）
        const bandsToRemove = selectedBands.filter(oldBand => !bands.includes(oldBand));
        bandsToRemove.forEach(bandToRemove => {
            removeCustomLayer(bandToRemove);
        });

        // 🚀 NEW: Check for spatial mode blocking before updating state
        const newlySelectedBands = bands.filter(band => !selectedBands.includes(band));
        const blockedBands = newlySelectedBands.filter(band => isBandBlockedInSpatialMode(band));

        if (blockedBands.length > 0) {
            // Show alert and prevent state update to keep checkbox unchecked
            console.warn('🚫 六維數據已被阻止：區域模式下無法存取六維數據');
            alert('請先選擇行政區或微網格後才能存取六維數據。');
            // Force a re-render to sync the UI (checkbox will reset via SelectionList's effect)
            setSelectedBands(prev => [...prev]);
            return; // Don't update with the newly-selected bands
        }

        setSelectedBands(bands);
    };

    const removeCustomLayer = (bandKey) => {

        // 🚀 FIX: Also clean up MVT layers for this band
        if (mapRef.current) {
            mapRef.current.eachLayer((layer) => {
                // Check if this is an MVT layer that should be removed
                if (layer.options && layer.options.rendererFactory === L.canvas.tile) {
                    // This is likely an MVT layer, check if it matches our band
                    const layerUrl = layer._url || '';
                    const shouldRemove = (
                        (bandKey.startsWith('testing_data_lte_') && !bandKey.includes('cmhk_') && layerUrl.includes('/other_lte_weak/mvt/')) ||
                        (bandKey.startsWith('testing_data_lte_cmhk_') && layerUrl.includes('/cmhk_weak_coverage/mvt/')) ||
                        (bandKey.startsWith('testing_data_nr_cmhk_') && layerUrl.includes('/cmhk_weak_coverage/mvt/')) ||
                        ((bandKey.startsWith('cmhk_test_data_lte_competition_') || bandKey.startsWith('cmhk_test_data_nr_competition_')) && layerUrl.includes('/competition_scenario_test/')) ||
                        (bandKey.startsWith('cmhk_test_data_lte_competition_rsrp') && layerUrl.includes('/cmhk_rsrp_data/lte/mvt/')) ||
                        (bandKey.startsWith('cmhk_test_data_nr_competition_rsrp') && layerUrl.includes('/cmhk_rsrp_data/nr/mvt/')) ||
                        (bandKey.startsWith('cmhk_test_data_lte_competition_sinr') && layerUrl.includes('/cmhk_sinr_data/lte/mvt/')) ||
                        (bandKey.startsWith('cmhk_test_data_nr_competition_sinr') && layerUrl.includes('/cmhk_sinr_data/nr/mvt/')) ||
                        (bandKey.startsWith('testing_data_nr_') && !bandKey.includes('cmhk_') && layerUrl.includes('/other_nr_weak/mvt/')) ||
                        (bandKey.startsWith('complaint_') && layerUrl.includes('/complaint_data/mvt/')) ||
                        (bandKey.startsWith('simulation_data_raw_simulation')) ||
                        (bandKey.startsWith('Discovery_MR_Data_NR') && layerUrl.includes('/discovery_mr/')) ||
                        (bandKey.startsWith('microphone_data') && layerUrl.includes('/cmhk_grid_highload/mvt/'))
                    );

                    if (shouldRemove) {
                        try {
                            mapRef.current.removeLayer(layer);
                        } catch (e) {
                            console.warn('Error removing MVT layer:', e);
                        }
                    }
                }
            });
        }

        setLayers((prevLayers) => {
            if (prevLayers[bandKey]) {
                try {
                    // 🚀 IMPROVED: 檢查地圖和圖層是否仍然存在
                    if (mapRef.current && prevLayers[bandKey]) {
                        mapRef.current.removeLayer(prevLayers[bandKey]);

                        // 🚀 IMPROVED: 如果是 marker cluster 圖層，額外清理
                        if (prevLayers[bandKey].clearLayers) {
                            prevLayers[bandKey].clearLayers();
                        }

                    }
                } catch (error) {
                    console.warn(`⚠️ Error removing layer ${bandKey}:`, error);
                }

                const newLayers = { ...prevLayers };
                delete newLayers[bandKey];
                return newLayers;
            } else {
                return prevLayers;
            }
        });
    };

    // --------------------------------------------------------------------------
    // 🚀 IMPROVED: 圖層狀態同步檢查機制
    useEffect(() => {
        if (!mapRef.current) return;

        // Extract currently selected scenarios from selectedBands
        const planningSites = selectedBands
            .filter(band => band.startsWith('site_structure_data_planning_sites_'))
            .map(band => band.replace('site_structure_data_planning_sites_', ''));

        const liveSites = selectedBands
            .filter(band => band.startsWith('site_structure_data_live_sites_'))
            .map(band => band.replace('site_structure_data_live_sites_', ''));

        const competitiveSites = selectedBands
            .filter(band => band.startsWith('site_structure_data_competitive_sites_'))
            .map(band => band.replace('site_structure_data_competitive_sites_', ''));

        // 檢查是否有未清理的圖層（在layers中但不在selectedBands中）
        // 但排除由其他狀態管理的圖層類型
        const orphanedLayers = Object.keys(layers).filter(layerKey => {
            // Skip 126 New Site layers, Activated Site layers, and 729 Planning List - managed separately
            if (layerKey.includes('site_structure_data_planning_sites_126 New Site') ||
                layerKey.includes('site_structure_data_planning_sites_126 Activated Site') ||
                layerKey.includes('site_structure_data_planning_sites_729 Planning List')) return false;

            // Skip planning site layers that are still selected
            if (layerKey.includes('site_structure_data_planning_sites_') &&
                planningSites.some(s => layerKey.includes(`site_structure_data_planning_sites_${s}`))) return false;

            // Skip live site layers that are still selected
            if (layerKey.includes('site_structure_data_live_sites_') &&
                liveSites.some(t => layerKey.includes(`site_structure_data_live_sites_${t}`))) return false;

            // Skip competitive site layers that are still selected
            if (layerKey.includes('site_structure_data_competitive_sites_') &&
                competitiveSites.some(f => layerKey.includes(`site_structure_data_competitive_sites_${f}`))) return false;

            // Only check selectedBands for actual band layers
            return !selectedBands.includes(layerKey);
        });

        if (orphanedLayers.length > 0) {
            orphanedLayers.forEach(layerKey => {
                removeCustomLayer(layerKey);
            });
        }

    }, [selectedBands, layers, selectedNewSiteKeys]);

    // --------------------------------------------------------------------------
    const removeAllLayers = useCallback(() => {
        try {
            // 🚀 STEP 1: Cancel all ongoing requests and reinitialize request manager
            const currentRequestManager = requestManagerRef.current;
            if (currentRequestManager) {
                currentRequestManager.cancelAll();
            }
            // 🚀 COMPLETE RESET: Create fresh request manager to ensure no stale state
            requestManagerRef.current = new APIRequestManager(4, 300);

            // 🚀 STEP 2: Clear all caching completely
            fetchCacheRef.current.clear();

            // 🚀 ADDITIONAL CACHE CLEANUP: Clear any browser caches if applicable
            // Force garbage collection of cached data references
            if (window.gc && typeof window.gc === 'function') {
                try {
                    window.gc(); // Only available in development with --expose-gc flag
                } catch (e) {
                    // Ignore if not available
                }
            }

            // 🚀 STEP 3: Clear all refs
            microGridLayersRef.current = {};
            layerUpdateLockRef.current = false;
            pendingLayerUpdatesRef.current = [];
            zoomProcessingRef.current = false;
            lastZoomTimeRef.current = 0;
            if (zoomTimeoutRef.current) {
                clearTimeout(zoomTimeoutRef.current);
                zoomTimeoutRef.current = null;
            }

            // 🚀 STEP 4: Complete layer removal - collect ALL non-base layers first, then remove
            if (mapRef.current) {
                const layersToRemove = [];
                const baseLayer = baseLayerRef.current;

                // Collect ALL layers except the base map layer
                mapRef.current.eachLayer((layer) => {
                    // Only preserve the base map layer (OSM/CartoDB)
                    if (layer === baseLayer) {
                        return; // Skip base layer
                    }

                    // Remove ALL other layers including:
                    // 1. Regular data layers (GeoJSON, CircleMarkers, etc.)
                    // 2. MVT layers (TileLayer with rendererFactory)  
                    // 3. Canvas layers
                    // 4. LayerGroups and FeatureGroups
                    layersToRemove.push(layer);
                });

                // Now remove all collected layers safely
                layersToRemove.forEach(layer => {
                    try {
                        mapRef.current.removeLayer(layer);

                        // 🚀 EXTRA CLEANUP: For MVT/Canvas layers, ensure complete cleanup
                        if (layer.options && layer.options.rendererFactory === L.canvas.tile) {
                            // Additional MVT layer cleanup if needed
                            if (layer._url) {
                                console.log('🧹 Cleaned MVT layer:', layer._url);
                            }
                        }
                    } catch (e) {
                        // Silently handle removal errors - layers might already be removed
                        console.warn('Layer removal warning:', e.message);
                    }
                });

                // 🚀 EXTRA SAFETY: Force clear all custom panes of any remaining content
                const panes = [
                    'baseFrameworkPane', 'gridDataPane', 'planningSitesPane', 'complaintsPane',
                    'liveSitesPane', 'competitiveSitesPane', 'newSitesPane', 'highlightPane'
                ];
                panes.forEach(paneName => {
                    const pane = mapRef.current.getPane(paneName);
                    if (pane && pane.children) {
                        // Clear any remaining DOM elements in custom panes
                        while (pane.firstChild) {
                            pane.removeChild(pane.firstChild);
                        }
                    }
                });

                console.log(`🎉 Removed ${layersToRemove.length} layers from map`);
            }

            // 🚀 STEP 5: Clean up clustering layers
            cleanupClusteringLayers();

            // 🚀 STEP 6: Reset user selection states (NOT configuration data)
            setLayers({});
            setSelectedBands([]);
            setSelectedMicroGrids([]);
            setSelectedNewSiteKeys([]);
            setHighlightedLayer(null);
            setIsOptionsVisible(false);
            setIsOtherOptionsVisible(false);
            setIsRegionVisible(false);
            setShowSiteDetail(false);
            setSelectedSiteData(null);
            setShowGridDetail(false);
            setSelectedGridData(null);
            setRenderingMode('global');
            setMicroGridLayerGroup(null);
            setErrorState(null);
            setRetryAttempts(0);
            setClusteringData(null);
            setIsClusteringActive(false);
            setIsClusteringLoading(false);
            setClusteringProgress(0);
            setIsDashboardVisible(false);

            // 🚀 STEP 7: Reset map view to initial state
            if (mapRef.current) {
                mapRef.current.setView([22.3964, 114.1095], 11);
            }

            console.log('🎉 Successfully cleared all layers and reset to initial state');

        } catch (error) {
            console.error('🔥 Clear operation error:', error);
            // Don't show alert that could confuse users - just log the error
            // If there's a critical error, the user can refresh manually
        }
    }, []);

    // 🚀 检查是否已选择六维数据（現在包含6個類別）
    const hasSixDimensionDataSelected = () => {
        return selectedBands.some(band => {
            // 检查是否属于六维数据（包括6個類別）
            return band.startsWith('simulation_data_') ||
                band.startsWith('complaint_') ||
                band.startsWith('Discovery_MR_Data_NR') ||
                band.startsWith('microphone_data') ||
                band.startsWith('site_structure_data_') ||
                band.startsWith('cmhk_test_data_');
        });
    };

    // ============================================================================
    // 🚀 NEW: DBSCAN Clustering Functions

    // Enhanced color palette for better cluster distinction
    const clusterColors = [
        '#E74C3C', // Red
        '#3498DB', // Blue  
        '#2ECC71', // Green
        '#F39C12', // Orange
        '#9B59B6', // Purple
        '#1ABC9C', // Teal
        '#E67E22', // Dark Orange
        '#34495E', // Dark Blue-Gray
        '#F1C40F', // Yellow
        '#E91E63', // Pink
        '#00BCD4', // Cyan
        '#4CAF50', // Light Green
        '#FF9800', // Amber
        '#673AB7', // Deep Purple
        '#607D8B'  // Blue Gray
    ];

    // Fetch clustering data - focus on outdoor sites for meaningful coverage analysis
    const fetchClusteringData = useCallback(async () => {
        const selectedSiteTypes = selectedBands
            .filter(band => band.startsWith('site_structure_data_live_sites_'))
            .map(band => band.replace('site_structure_data_live_sites_', ''))
            .filter(type => type !== 'live_site_clustering') // Exclude the clustering checkbox itself
            .filter(type => type === 'Outdoor Site'); // Focus purely on outdoor macro sites for coverage analysis

        if (selectedSiteTypes.length === 0) {
            console.warn('No outdoor site types selected for clustering');
            return;
        }

        // Start loading process
        setIsClusteringLoading(true);
        setClusteringProgress(0);

        try {
            // Simulate progress stages
            setClusteringProgress(10);

            const queryParams = new URLSearchParams({
                site_types: selectedSiteTypes.join(','),
                epsilon: clusteringConfig.epsilon,
                min_points: clusteringConfig.minPoints,
                distance_unit: clusteringConfig.distanceUnit
            });

            if (selectedMicroGrids.length > 0) {
                queryParams.append('microGrids', selectedMicroGrids.join(','));
            }

            setClusteringProgress(30);

            const url = buildApiUrl(`${EXTERNAL_SERVER_URL}/live_sites_clustering?${queryParams}`);

            setClusteringProgress(50);

            const response = await apiRequest(url);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            setClusteringProgress(70);

            const data = await response.json();
            setClusteringData(data);

            setClusteringProgress(90);

            if (data.features && data.features.length > 0) {
                updateClusteringLayers(data);
            }

            setClusteringProgress(100);

            // 🚀 MEMORY LEAK FIX: Clear any pending timeout before creating new one
            if (clusteringProgressTimeoutRef.current) {
                clearTimeout(clusteringProgressTimeoutRef.current);
            }

            // Small delay to show completed progress
            clusteringProgressTimeoutRef.current = setTimeout(() => {
                // 🚀 MEMORY LEAK FIX: Check if component is still mounted before setState
                if (isMountedRef.current) {
                    setIsClusteringLoading(false);
                    setClusteringProgress(0);
                }
                clusteringProgressTimeoutRef.current = null; // Clear ref after execution
            }, 500);

        } catch (err) {
            console.error('Failed to fetch clustering data:', err);
            // 🚀 MEMORY LEAK FIX: Check if component is still mounted before setState
            if (isMountedRef.current) {
                setIsClusteringLoading(false);
                setClusteringProgress(0);
            }
        }
    }, [selectedBands, selectedMicroGrids, clusteringConfig]);

    // Update map layers with clustering data
    const updateClusteringLayers = useCallback((data) => {
        if (!mapRef.current || !data) return;

        // Remove existing layers
        cleanupClusteringLayers();

        // Add cluster points layer
        clusterLayerGroupRef.current = L.layerGroup().addTo(mapRef.current);

        data.features
            .filter(feature => !feature.properties.is_noise)
            .forEach(feature => {
                const clusterId = feature.properties.cluster_id;
                const clusterSize = feature.properties.cluster_size;
                const color = clusterColors[clusterId % clusterColors.length];

                const radius = Math.max(5, Math.min(7, 3 + (clusterSize * 0.4)));

                const marker = L.circleMarker(
                    [feature.geometry.coordinates[1], feature.geometry.coordinates[0]],
                    {
                        radius: radius,
                        fillColor: color,
                        color: '#ffffff',
                        weight: 2,
                        opacity: 1,
                        fillOpacity: 0.9
                    }
                );

                marker.bindPopup(`
                    <div style="font-family: Arial, sans-serif; font-size: 12px;">
                        <h4 style="margin: 0 0 8px 0; color: ${color};">High-Density Cluster ${clusterId}</h4>
                        <p><strong>站點:</strong> ${feature.properties.plan_site_name || feature.properties.live_site_id}</p>
                        <p><strong>類型:</strong> ${feature.properties.site_type}</p>
                        <p><strong>所在區:</strong> ${feature.properties.district}</p>
                        <p><strong>簇密度:</strong> ${clusterSize} sites within 800m</p>
                        <p><strong>地址:</strong> ${feature.properties.address || 'N/A'}</p>
                        <hr style="margin: 8px 0; border: 1px solid #eee;">
                        <small style="color: #666;"><strong>分析:</strong> ${clusterSize}+ sites within macro cell range (800m radius)</small>
                    </div>
                `);

                marker.addTo(clusterLayerGroupRef.current);
            });

        // Add noise points layer  
        noiseLayerGroupRef.current = L.layerGroup().addTo(mapRef.current);

        data.features
            .filter(feature => feature.properties.is_noise)
            .forEach(feature => {
                const marker = L.circleMarker(
                    [feature.geometry.coordinates[1], feature.geometry.coordinates[0]],
                    {
                        radius: 4,
                        fillColor: '#666666',
                        color: '#ffffff',
                        weight: 1,
                        opacity: 1,
                        fillOpacity: 0.6
                    }
                );

                marker.bindPopup(`
                    <div style="font-family: Arial, sans-serif; font-size: 12px;">
                        <h4 style="margin: 0 0 8px 0; color: #666;">Coverage Gap Area</h4>
                        <p><strong>站點:</strong> ${feature.properties.plan_site_name || feature.properties.live_site_id}</p>
                        <p><strong>類型:</strong> ${feature.properties.site_type}</p>
                        <p><strong>所在區:</strong> ${feature.properties.district}</p>
                        <p><strong>簇狀態:</strong> Isolated - fewer than 4 sites within 800m</p>
                        <p><strong>地址:</strong> ${feature.properties.address || 'N/A'}</p>
                        <hr style="margin: 8px 0; border: 1px solid #eee;">
                        <small style="color: #666;"><strong>分析:</strong> Potential coverage gap or edge-of-network site</small>
                    </div>
                `);

                marker.addTo(noiseLayerGroupRef.current);
            });

    }, [clusterColors, clusteringConfig]);

    // Clean up clustering layers
    const cleanupClusteringLayers = useCallback(() => {
        if (!mapRef.current) return;

        if (clusterLayerGroupRef.current) {
            mapRef.current.removeLayer(clusterLayerGroupRef.current);
            clusterLayerGroupRef.current = null;
        }

        if (noiseLayerGroupRef.current) {
            mapRef.current.removeLayer(noiseLayerGroupRef.current);
            noiseLayerGroupRef.current = null;
        }
    }, []);

    // Handle clustering checkbox changes
    useEffect(() => {
        const hasClusteringSelected = selectedBands.includes('site_structure_data_live_sites_live_site_clustering');

        if (hasClusteringSelected && !isClusteringActive) {
            setIsClusteringActive(true);
            fetchClusteringData();
        } else if (!hasClusteringSelected && isClusteringActive) {
            setIsClusteringActive(false);
            cleanupClusteringLayers();
            setClusteringData(null);
        }
    }, [selectedBands, isClusteringActive, fetchClusteringData]);

    // 🚀 检查是否已选择其他测试数据
    const hasOtherTestDataSelected = () => {
        return selectedBands.some(band => {
            // 检查是否属于其他测试数据（非cmhk的field_test_data）
            return band.startsWith('field_test_data_') && !band.includes('cmhk');
        });
    };

    // 🚀 IMPROVED: 統一的selection list狀態管理，防止重疊
    const closeAllSelectionLists = () => {
        setIsOptionsVisible(false);
        setIsOtherOptionsVisible(false);
        setIsRegionVisible(false);
    };

    // Toggle six dimension data selection menu (now includes testing data)
    const toggleVisibility = () => {
        // 🚀 RESTRICTION: 防止与其他数据类型冲突
        if (hasOtherTestDataSelected()) {
            alert('已選擇其他測試數據，無法選擇六維數據。請先清除當前選擇。');
            return;
        }

        // 🚀 FIX: 如果當前已開啟，則關閉；否則關閉所有其他的並開啟當前的
        if (isOptionsVisible) {
            setIsOptionsVisible(false);
        } else {
            closeAllSelectionLists();
            setIsOptionsVisible(true);
        }
    };

    const toggleOtherVisibility = () => {
        // 🚀 RESTRICTION: 防止与其他数据类型冲突
        if (hasSixDimensionDataSelected()) {
            alert('已選擇六維數據，無法選擇其他測試數據。請先清除當前選擇。');
            return;
        }

        // 🚀 FIX: 如果當前已開啟，則關閉；否則關閉所有其他的並開啟當前的
        if (isOtherOptionsVisible) {
            setIsOtherOptionsVisible(false);
        } else {
            closeAllSelectionLists();
            setIsOtherOptionsVisible(true);
        }
    };

    // Toggle unified region selection menu
    const [isRegionVisible, setIsRegionVisible] = useState(false);
    const toggleRegionVisibility = () => {
        // 🚀 FIX: 如果當前已開啟，則關閉；否則關閉所有其他的並開啟當前的
        if (isRegionVisible) {
            setIsRegionVisible(false);
        } else {
            closeAllSelectionLists();
            setIsRegionVisible(true);
        }
    };

    // --------------------------------------------------------------------------
    return (
        <div style={{ height: '100vh', position: 'relative', overflow: 'hidden' }}>

            <div style={{
                pointerEvents: isClusteringLoading ? 'none' : 'auto',
                opacity: isClusteringLoading ? 0.7 : 1,
                transition: 'opacity 0.3s ease'
            }}>
                <NavigationBar
                    removeAllLayers={removeAllLayers}
                    toggleVisibility={toggleVisibility}
                    toggleOtherVisibility={toggleOtherVisibility}
                    toggleDistrictVisibility={toggleRegionVisibility}
                    toggleBasemap={toggleBasemap}
                    toggleRenderingMode={toggleRenderingMode}
                    toggleComplaintChart={toggleComplaintChart}
                    currentBasemap={currentBasemap}
                    renderingMode={renderingMode}
                    isOtherDataDisabled={hasSixDimensionDataSelected()}
                    isSixDimensionDataDisabled={hasOtherTestDataSelected()}
                    complaintChartVisible={complaintChartVisible}
                    isDashboardVisible={isDashboardVisible}
                />
            </div>

            {/* 🚀 NEW: Clustering Progress Bar */}
            {isClusteringLoading && (
                <div style={{
                    position: 'absolute',
                    top: '70px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '400px',
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    borderRadius: '8px',
                    padding: '16px 20px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                    zIndex: 2000,
                    border: '1px solid #ddd'
                }}>
                    <div style={{
                        fontSize: '14px',
                        fontWeight: 'bold',
                        marginBottom: '8px',
                        textAlign: 'center',
                        color: '#333'
                    }}>
                        🔄 Running DBSCAN Clustering Analysis...
                    </div>
                    <div style={{
                        width: '100%',
                        height: '6px',
                        backgroundColor: '#e0e0e0',
                        borderRadius: '3px',
                        overflow: 'hidden'
                    }}>
                        <div style={{
                            width: `${clusteringProgress}%`,
                            height: '100%',
                            backgroundColor: '#4CAF50',
                            borderRadius: '3px',
                            transition: 'width 0.3s ease',
                            background: 'linear-gradient(90deg, #4CAF50, #66BB6A)'
                        }} />
                    </div>
                    <div style={{
                        fontSize: '12px',
                        marginTop: '6px',
                        textAlign: 'center',
                        color: '#666'
                    }}>
                        {clusteringProgress}% complete
                    </div>
                </div>
            )}

            {/* 🚀 NEW: Interaction Blocking Overlay */}
            {isClusteringLoading && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'rgba(0, 0, 0, 0.1)',
                    zIndex: 1500,
                    cursor: 'wait'
                }} />
            )}

            {/* 地图容器现在是纯粹的，React不会在其中渲染任何子组件 */}
            <div
                id="map"
                className="map-container"
                style={{
                    height: '100%',
                    width: '100%',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    zIndex: 0,
                    pointerEvents: isClusteringLoading ? 'none' : 'auto' // Block map interactions during clustering
                }}
            >
                {/* 这个div内部必须保持为空 */}
            </div>

            {/* 所有浮层UI现在都在地图的上方，由React独立管理 */}
            {isOptionsVisible && (
                <div style={{
                    pointerEvents: isClusteringLoading ? 'none' : 'auto',
                    opacity: isClusteringLoading ? 0.5 : 1,
                    transition: 'opacity 0.3s ease'
                }}>
                    <SelectionList
                        options={options}
                        onSelect={handleBandSelect}
                        selectedBands={selectedBands}
                        toggleVisibility={toggleVisibility}
                        title="六維數據"
                        renderingMode={renderingMode}
                        newSiteTreeData={createNewSiteTreeData(activatedSitesCount)}
                        selectedNewSiteKeys={selectedNewSiteKeys}
                        onNewSiteSelect={setSelectedNewSiteKeys}
                    />
                </div>
            )}
            {isOtherOptionsVisible && (
                <div style={{
                    pointerEvents: isClusteringLoading ? 'none' : 'auto',
                    opacity: isClusteringLoading ? 0.5 : 1,
                    transition: 'opacity 0.3s ease'
                }}>
                    <SelectionList
                        options={otherOptions}
                        onSelect={handleBandSelect}
                        selectedBands={selectedBands}
                        toggleVisibility={toggleOtherVisibility}
                        title="其他測試數據"
                        renderingMode={renderingMode}
                    />
                </div>
            )}
            {isRegionVisible && (
                <div style={{
                    pointerEvents: isClusteringLoading ? 'none' : 'auto',
                    opacity: isClusteringLoading ? 0.5 : 1,
                    transition: 'opacity 0.3s ease'
                }}>
                    <DistrictMicroGridSelection
                        selectedMicroGrids={selectedMicroGrids}
                        setSelectedMicroGrids={setSelectedMicroGrids}
                        onClose={toggleRegionVisibility}
                    />
                </div>
            )}


            {/* 🚀 NEW: 站點詳情窗口 */}
            {showSiteDetail && selectedSiteData && (
                <SiteDetailWindow
                    siteData={selectedSiteData}
                    onClose={() => {
                        setShowSiteDetail(false);
                        setSelectedSiteData(null);
                    }}
                />
            )}

            {/* 🚀 NEW: 網格詳情面板 */}
            {showGridDetail && selectedGridData && (
                <GridDetailPanel
                    gridData={selectedGridData}
                    onClose={() => {
                        setShowGridDetail(false);
                        setSelectedGridData(null);
                    }}
                    onMapInteractionChange={handleMapInteractionChange}
                />
            )}
            {/* 圖例：顯示規劃場景、現有站點類型與網格分類對應顏色 */}
            {/* 🚀 UPDATED: Only show legend when six-dimension data is selected */}
            <div style={{
                pointerEvents: isClusteringLoading ? 'none' : 'auto',
                opacity: isClusteringLoading ? 0.5 : 1,
                transition: 'opacity 0.3s ease'
            }}>
                <Legend
                    isVisible={hasSixDimensionDataSelected()}
                    planningScenarioColors={PLANNING_SCENARIO_COLOR_MAP}
                    planningScenarioLabels={PLANNING_SCENARIO_LABEL_MAP}
                    liveSiteTypeColors={LIVE_SITE_TYPE_COLOR_MAP}
                    competitiveSiteColors={COMPETITIVE_SITE_COLOR_MAP}
                    discoveryGridCategories={gridCategories}
                    complaintDataColors={COMPLAINT_DATA_COLOR_MAP}
                    simulationDataColors={SIMULATION_DATA_COLOR_MAP}
                    microphoneDataColors={MICROPHONE_DATA_COLOR_MAP}
                    lteCompetitionColors={LTE_COMPETITION_COLOR_MAP}
                    nrCompetitionColors={NR_COMPETITION_COLOR_MAP}
                    rsrpColors={selectedBands.some(band =>
                        band.startsWith('testing_data_lte_') ||
                        band.startsWith('testing_data_nr_') ||
                        band.startsWith('cmhk_test_data_lte_competition_rsrp') ||
                        band.startsWith('cmhk_test_data_nr_competition_rsrp')
                    ) ? RSRP_COLOR_MAP : {}}
                    sinrColors={selectedBands.some(band =>
                        band.startsWith('cmhk_test_data_lte_competition_sinr') ||
                        band.startsWith('cmhk_test_data_nr_competition_sinr')
                    ) ? SINR_COLOR_MAP : {}}
                />
            </div>

            {/* 🚀 NEW: 永久儀表板 */}
            <PermanentDashboard
                position={dashboardPosition}
                isVisible={isDashboardVisible}
                selectedMicroGrids={selectedMicroGrids}
                showComplaintChart={complaintChartVisible}
                isLegendVisible={hasSixDimensionDataSelected()}
            />

            {/* 🚀 錯誤提示組件 */}
            {errorState && (
                <div className="error-overlay-container">
                    <div className="error-overlay-backdrop" onClick={dismissError}></div>
                    <div className="error-message-center">
                        <div className="error-icon">
                            {errorState.type === 'network' ? '🌐' :
                                errorState.type === 'server' ? '🔧' :
                                    errorState.type === 'notfound' ? '📄' : '⚠️'}
                        </div>
                        <div className="error-title">
                            {errorState.type === 'network' ? '網絡連接問題' :
                                errorState.type === 'server' ? '服務器錯誤' :
                                    errorState.type === 'notfound' ? '數據不存在' : '加載錯誤'}
                        </div>
                        <div className="error-message">
                            {errorState.message}
                        </div>
                        {errorState.band && (
                            <div className="error-details">
                                影響數據：{errorState.band}
                            </div>
                        )}
                        <div className="error-actions">
                            {(errorState.type === 'network' || errorState.type === 'server') && (
                                <button
                                    className="error-button error-button-primary"
                                    onClick={handleRetry}
                                    disabled={retryAttempts >= 3}
                                >
                                    {retryAttempts >= 3 ? '已達最大重試次數' : '重試'}
                                </button>
                            )}
                            <button
                                className="error-button error-button-secondary"
                                onClick={dismissError}
                            >
                                關閉
                            </button>
                        </div>
                        {retryAttempts > 0 && (
                            <div className="error-retry-info">
                                重試次數：{retryAttempts}/3
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// (removed unused helpers getScenarioName/getScenarioKey)

export default TelecomMap;
