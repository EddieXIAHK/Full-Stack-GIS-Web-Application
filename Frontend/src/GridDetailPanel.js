// GridDetailPanel.js
import React, { useRef, useEffect, useState } from 'react';
import './GridDetailPanel.css';
import { DATA_SCHEMAS, DataUtils } from './dataSchemas';
import FieldRow from './components/FieldRow';

// Performance optimization: Memoize component to prevent unnecessary re-renders
const GridDetailPanel = React.memo(({ gridData, onClose, onMapInteractionChange }) => {
    const panelRef = useRef(null);
    const [activeTab, setActiveTab] = useState('');

    useEffect(() => {
        // Prevent event bubbling to map
        if (panelRef.current) {
            const handleWheel = (e) => e.stopPropagation();
            const handleMouseDown = (e) => e.stopPropagation();
            const handleDoubleClick = (e) => e.stopPropagation();
            
            const element = panelRef.current;
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
        // Safer body style management to prevent memory leaks
        if (panelRef.current) {
            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            
            return () => {
                if (originalOverflow) {
                    document.body.style.overflow = originalOverflow;
                } else {
                    document.body.style.removeProperty('overflow');
                }
            };
        }
    }, []);

    useEffect(() => {
        // Disable map interactions when panel is open
        if (onMapInteractionChange) {
            onMapInteractionChange(false); // Disable interactions
        }
        
        return () => {
            // Re-enable map interactions when panel is closed
            if (onMapInteractionChange) {
                onMapInteractionChange(true); // Enable interactions
            }
        };
    }, [onMapInteractionChange]);

    // Schema-driven dynamic tab configuration with error handling
    const createDynamicTabs = () => {

        if (!gridData) {
            return [];
        }

        try {
            // Use schema-based approach to determine available tabs
            const availableSchemas = DataUtils.getAvailableSchemas(gridData);


            const tabs = availableSchemas.map(schema => ({
                id: schema.id,
                label: schema.label,
                icon: schema.icon,
                description: schema.description,
                priority: schema.priority
            }));

            return tabs;
        } catch (error) {
            console.error('❌ Error creating dynamic tabs:', error);
            return [];
        }
    };

    const tabs = createDynamicTabs();

    // Auto-select first tab if no active tab is set
    useEffect(() => {

        if (tabs.length > 0) {
            const tabExists = tabs.find(tab => tab.id === activeTab);

            if (!activeTab || !tabExists) {
                const firstTabId = tabs[0].id;
                setActiveTab(firstTabId);
            }
        }
    }, [tabs, activeTab]);

    if (!gridData) return null;

    const properties = gridData.properties || {};
    const gridId = gridData.grid_id || properties.grid_id || properties.id || 'Unknown Grid';

    // Schema-driven tab content generation with error handling
    const getTabContent = (tabId) => {

        try {
            const schema = DATA_SCHEMAS[tabId];

            if (!schema) {
                console.warn(`❌ No schema found for tab: ${tabId}`);
                return null;
            }


            // Filter sections that have data available
            const availableSections = schema.sections.filter(section => {
                try {
                    if (section.condition) {
                        const conditionResult = section.condition(gridData);
                        return conditionResult;
                    } else {
                        return true;
                    }
                } catch (error) {
                    console.error(`❌ Error checking section condition for ${section.title}:`, error);
                    return false;
                }
            });


            return {
                title: schema.label,
                sections: availableSections
            };
        } catch (error) {
            console.error(`❌ Error generating tab content for ${tabId}:`, error);
            return {
                title: '數據錯誤',
                sections: [],
                error: true
            };
        }
    };

    const currentTabContent = getTabContent(activeTab);


    return (
        <div className="grid-detail-overlay">
            <div className="grid-detail-backdrop" onClick={onClose}></div>
            <div className="grid-detail-panel" ref={panelRef}>
                {/* Panel Header */}
                <div className="grid-detail-header">
                    <div className="grid-detail-title">
                        <div className="grid-title-info">
                            <span className="grid-name">GRID: {gridId}</span>
                            <span className="grid-subtitle">TELECOM GRID ANALYSIS</span>
                        </div>
                    </div>
                    <button className="grid-detail-close" onClick={onClose}>
                        X
                    </button>
                </div>

                {/* Tab Navigation */}
                <div className="grid-tab-navigation">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            className={`grid-tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                            title={tab.description}
                        >
                            <span className="tab-label">{tab.label}</span>
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div className="grid-detail-content">
                    {currentTabContent ? (
                        currentTabContent.error ? (
                            <div className="grid-tab-content">
                                <div className="error-state">
                                    <h3 className="error-title">DATA ERROR</h3>
                                    <p className="error-message">Unable to load grid data. Please try again.</p>
                                </div>
                            </div>
                        ) : currentTabContent.sections.length > 0 ? (
                            <div className="grid-tab-content">
                                {currentTabContent.sections.map((section, sectionIndex) => (
                                    <div
                                        key={sectionIndex}
                                        className={`grid-detail-section priority-${section.priority}`}
                                    >
                                        <h3 className="section-title">
                                            <span className="section-indicator"></span>
                                            {section.title}
                                            <span className={`priority-badge priority-${section.priority}`}>
                                                {DataUtils.getPriorityLabel(section.priority)}
                                            </span>
                                        </h3>
                                        <div className="section-content">
                                            {section.fields.map((field, fieldIndex) => (
                                                <FieldRow
                                                    key={`${field.key}-${fieldIndex}`}
                                                    field={field}
                                                    data={gridData}
                                                    sectionPriority={section.priority}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="grid-tab-content">
                                <div className="empty-state">
                                    <h3 className="empty-title">NO DATA AVAILABLE</h3>
                                    <p className="empty-message">No data available for this category.</p>
                                </div>
                            </div>
                        )
                    ) : tabs.length === 0 ? (
                        <div className="grid-tab-content">
                            <div className="empty-state">
                                <h3 className="empty-title">NO GRID DATA</h3>
                                <p className="empty-message">No data available for this grid.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="grid-tab-content">
                            <div className="loading-state">
                                <h3 className="loading-title">LOADING</h3>
                                <p className="loading-message">Loading grid data...</p>
                            </div>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
});

// Add display name for debugging
GridDetailPanel.displayName = 'GridDetailPanel';

export default GridDetailPanel;