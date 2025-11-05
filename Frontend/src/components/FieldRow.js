// FieldRow.js - Reusable component for displaying data fields with consistent styling
import React from 'react';
import { DataUtils } from '../dataSchemas';

const FieldRow = React.memo(({ field, data, sectionPriority = 'medium' }) => {
    // Extract value using the utility function
    const rawValue = DataUtils.extractValue(data, field.dataPath);
    const formattedValue = DataUtils.formatValue(rawValue, field);
    const priorityClass = DataUtils.getPriorityClass(sectionPriority);

    // Determine if field has valid data
    const hasData = formattedValue !== null && formattedValue !== undefined && formattedValue !== '';

    return (
        <div className={`field-row ${priorityClass} ${!hasData ? 'unavailable' : ''}`}>
            <span className="field-label">
                {field.label}
            </span>
            <span className={`field-value ${!hasData ? 'no-data' : ''}`}>
                {hasData ? formattedValue : 'NO DATA'}
            </span>
        </div>
    );
});

// Add display name for debugging
FieldRow.displayName = 'FieldRow';

export default FieldRow;