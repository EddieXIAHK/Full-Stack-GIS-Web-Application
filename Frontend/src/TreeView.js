import React, { useState } from 'react';
import { FaChevronDown, FaChevronUp, FaMinus, FaPlus } from 'react-icons/fa';
import './SelectionList.css';

const TreeView = ({ 
    data, 
    selectedKeys = [], 
    onSelectionChange, 
    title = "Tree Selection" 
}) => {
    const [expandedNodes, setExpandedNodes] = useState(new Set(['root']));

    const toggleNode = (nodeKey) => {
        const newExpanded = new Set(expandedNodes);
        if (newExpanded.has(nodeKey)) {
            newExpanded.delete(nodeKey);
        } else {
            newExpanded.add(nodeKey);
        }
        setExpandedNodes(newExpanded);
    };

    const isNodeExpanded = (nodeKey) => expandedNodes.has(nodeKey);

    const handleLeafCheck = (nodeKey, isChecked) => {
        let newSelectedKeys = [...selectedKeys];
        if (isChecked) {
            if (!newSelectedKeys.includes(nodeKey)) {
                newSelectedKeys.push(nodeKey);
            }
        } else {
            newSelectedKeys = newSelectedKeys.filter(key => key !== nodeKey);
        }
        onSelectionChange(newSelectedKeys);
    };

    const renderNode = (node, level = 0) => {
        const isExpanded = isNodeExpanded(node.key);
        const hasChildren = node.children && node.children.length > 0;
        const indent = level * 20;

        return (
            <div key={node.key} className="tree-node">
                <div 
                    className="tree-node-content"
                    style={{ paddingLeft: `${indent}px` }}
                >
                    {hasChildren && (
                        <button
                            className="tree-expand-button"
                            onClick={() => toggleNode(node.key)}
                            type="button"
                        >
                            {isExpanded ? <FaMinus size={10} /> : <FaPlus size={10} />}
                        </button>
                    )}
                    {!hasChildren && (
                        <span className="tree-expand-placeholder" />
                    )}
                    
                    {hasChildren ? (
                        <span className="tree-node-label">
                            <span className="tree-node-text">{node.label}</span>
                        </span>
                    ) : (
                        <label className="tree-node-label">
                            <input
                                type="checkbox"
                                className="tree-checkbox"
                                checked={selectedKeys.includes(node.key)}
                                onChange={(e) => handleLeafCheck(node.key, e.target.checked)}
                            />
                            <span className="tree-node-text">
                                {node.label}
                                {node.count !== undefined && (
                                    <span style={{ 
                                        marginLeft: '8px', 
                                        color: '#d61818', 
                                        fontSize: '0.9em',
                                        fontWeight: 'normal'
                                    }}>
                                        ({node.count})
                                    </span>
                                )}
                            </span>
                        </label>
                    )}
                </div>
                {hasChildren && isExpanded && (
                    <div className="tree-children">
                        {node.children.map(child => renderNode(child, level + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="tree-view">
            <div className="provider-section">
                <div 
                    className="provider-title" 
                    onClick={() => toggleNode('root')}
                    style={{ 
                        fontSize: '13px',
                        fontWeight: '500',
                        color: '#d0d0d0',
                        marginTop: '15px',
                        marginBottom: '8px'
                    }}
                >
                    {title}
                    <span className="accordion-icon">
                        {isNodeExpanded('root') ? <FaChevronUp /> : <FaChevronDown />}
                    </span>
                </div>
                {isNodeExpanded('root') && (
                    <div className="tree-content">
                        {data.map(node => renderNode(node, 0))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TreeView;