// dataSchemas.js - Comprehensive configuration for Six-Dimension Grid Data
// This centralizes all field mappings, display names, and data types for maintainability

export const DATA_SCHEMAS = {
  // 1. Discovery MR Data (競對數據) - Competition Analysis
  discovery_mr: {
    id: 'discovery_mr',
    label: '2. 競對分析',
    icon: '',
    description: '競對數據分析結果',
    priority: 'critical',
    sections: [
      {
        title: '強競爭場景',
        key: 'strong',
        condition: (data) => data?.categories?.discovery_mr?.strong || data?.properties?.discovery_mr?.strong,
        priority: 'critical',
        fields: [
          {
            key: 'category',
            label: '場景類別',
            dataPath: 'categories.discovery_mr.strong.category',
            type: 'string',
            format: 'text'
          },
          {
            key: 'scenario',
            label: '場景描述',
            dataPath: 'categories.discovery_mr.strong.scenario',
            type: 'string',
            format: 'text'
          },
          {
            key: 'description',
            label: '詳細說明',
            dataPath: 'categories.discovery_mr.strong.description',
            type: 'string',
            format: 'text'
          },
          {
            key: 'analysis_type',
            label: '分析類型',
            dataPath: 'categories.discovery_mr.strong.analysis_type',
            type: 'string',
            format: 'text'
          }
        ]
      },
      {
        title: '弱競爭場景',
        key: 'weak',
        condition: (data) => data?.categories?.discovery_mr?.weak || data?.properties?.discovery_mr?.weak,
        priority: 'critical',
        fields: [
          {
            key: 'category',
            label: '場景類別',
            dataPath: 'categories.discovery_mr.weak.category',
            type: 'string',
            format: 'text'
          },
          {
            key: 'scenario',
            label: '場景描述',
            dataPath: 'categories.discovery_mr.weak.scenario',
            type: 'string',
            format: 'text'
          },
          {
            key: 'description',
            label: '詳細說明',
            dataPath: 'categories.discovery_mr.weak.description',
            type: 'string',
            format: 'text'
          },
          {
            key: 'analysis_type',
            label: '分析類型',
            dataPath: 'categories.discovery_mr.weak.analysis_type',
            type: 'string',
            format: 'text'
          }
        ]
      }
    ]
  },

  // 2. Complaint Data (投訴數據) - Customer Complaints
  complaint_data: {
    id: 'complaint_data',
    label: '1. 投訴數據',
    icon: '',
    description: '客戶投訴統計信息',
    priority: 'critical',
    sections: [
      {
        title: '投訴統計',
        key: 'complaint_stats',
        condition: (data) => data?.categories?.complaint_data || data?.properties?.complaint_data,
        priority: 'critical',
        fields: [
          {
            key: 'status',
            label: '投訴狀態',
            dataPath: 'categories.complaint_data.status',
            type: 'string',
            format: 'status'
          },
          {
            key: 'complaint_level',
            label: '投訴等級',
            dataPath: 'categories.complaint_data.complaint_level',
            type: 'string',
            format: 'level'
          },
          {
            key: 'description',
            label: '問題描述',
            dataPath: 'categories.complaint_data.description',
            type: 'string',
            format: 'text'
          },
          {
            key: 'risk_category',
            label: '風險類別',
            dataPath: 'categories.complaint_data.risk_category',
            type: 'string',
            format: 'category'
          }
        ]
      }
    ]
  },

  // 3. High Load Data (高負荷數據) - Network Load Statistics
  high_load_data: {
    id: 'high_load_data',
    label: '4. 負載數據',
    icon: '',
    description: '網絡負載統計',
    priority: 'critical',
    sections: [
      {
        title: '負載統計',
        key: 'load_stats',
        condition: (data) => data?.categories?.high_load_data || data?.properties?.high_load_data,
        priority: 'critical',
        fields: [
          {
            key: 'dl_prb_utilization',
            label: '下行PRB利用率',
            dataPath: 'categories.high_load_data.dl_prb_utilization',
            type: 'number',
            format: 'decimal',
            decimals: 2
          },
          {
            key: 'utilization_percentage',
            label: '利用率百分比',
            dataPath: 'categories.high_load_data.utilization_percentage',
            type: 'string',
            format: 'percentage'
          },
          {
            key: 'load_status',
            label: '負載狀態',
            dataPath: 'categories.high_load_data.load_status',
            type: 'string',
            format: 'status'
          },
          {
            key: 'description',
            label: '統計說明',
            dataPath: 'categories.high_load_data.description',
            type: 'string',
            format: 'text'
          },
          {
            key: 'capacity_recommendation',
            label: '容量建議',
            dataPath: 'categories.high_load_data.capacity_recommendation',
            type: 'string',
            format: 'recommendation'
          }
        ]
      }
    ]
  },

  // 4. Simulation Data (仿真數據) - Network Simulation Results
  simulation_data: {
    id: 'simulation_data',
    label: '3. 仿真數據',
    icon: '',
    description: '網絡仿真結果',
    priority: 'high',
    sections: [
      {
        title: '仿真結果',
        key: 'simulation_results',
        condition: (data) => data?.categories?.simulation_data || data?.properties?.simulation_data,
        priority: 'high',
        fields: [
          {
            key: 'district_id',
            label: '區域ID',
            dataPath: 'categories.simulation_data.district_id',
            type: 'string',
            format: 'id'
          },
          {
            key: 'mean_signal_strength',
            label: '平均信號強度',
            dataPath: 'categories.simulation_data.mean_signal_strength',
            type: 'number',
            format: 'signal',
            unit: 'dBm',
            decimals: 2
          },
          {
            key: 'coverage_quality',
            label: '覆蓋質量',
            dataPath: 'categories.simulation_data.coverage_quality',
            type: 'string',
            format: 'quality'
          },
          {
            key: 'simulation_type',
            label: '仿真類型',
            dataPath: 'categories.simulation_data.simulation_type',
            type: 'string',
            format: 'type'
          },
          {
            key: 'description',
            label: '仿真說明',
            dataPath: 'categories.simulation_data.description',
            type: 'string',
            format: 'text'
          },
          {
            key: 'improvement_priority',
            label: '優化優先級',
            dataPath: 'categories.simulation_data.improvement_priority',
            type: 'string',
            format: 'priority'
          }
        ]
      }
    ]
  },

  // 5. Test Data (測試數據) - Drive Test Results
  cmhk_test_data: {
    id: 'cmhk_test_data',
    label: '5. 測試數據',
    icon: '',
    description: 'CMHK場測數據分析',
    priority: 'critical',
    sections: [
      {
        title: '場測結果',
        key: 'test_results',
        condition: (data) => data?.categories?.cmhk_test_data || data?.properties?.cmhk_test_data,
        priority: 'critical',
        fields: [
          {
            key: 'drive_test_result',
            label: '場測結果',
            dataPath: 'categories.cmhk_test_data.drive_test_result',
            type: 'string',
            format: 'result'
          },
          {
            key: 'coverage_analysis',
            label: '覆蓋分析',
            dataPath: 'categories.cmhk_test_data.coverage_analysis',
            type: 'string',
            format: 'analysis'
          },
          {
            key: 'test_type',
            label: '測試類型',
            dataPath: 'categories.cmhk_test_data.test_type',
            type: 'string',
            format: 'type'
          },
          {
            key: 'description',
            label: '測試說明',
            dataPath: 'categories.cmhk_test_data.description',
            type: 'string',
            format: 'text'
          },
          {
            key: 'priority',
            label: '優先級',
            dataPath: 'categories.cmhk_test_data.priority',
            type: 'string',
            format: 'priority'
          },
          {
            key: 'category',
            label: '數據類別',
            dataPath: 'categories.cmhk_test_data.category',
            type: 'string',
            format: 'category'
          },
          {
            key: 'subcategory',
            label: '子類別',
            dataPath: 'categories.cmhk_test_data.subcategory',
            type: 'string',
            format: 'category'
          }
        ]
      }
    ]
  },

  // 6. Base Grid Data (基礎網格數據) - Core Grid Information
  base_grid_data: {
    id: 'base_grid_data',
    label: '6. 基礎數據',
    icon: '',
    description: '網格基礎信息',
    priority: 'medium',
    sections: [
      {
        title: '網格信息',
        key: 'grid_info',
        condition: (data) => data?.grid_id,
        priority: 'medium',
        fields: [
          {
            key: 'grid_id',
            label: '網格ID',
            dataPath: 'grid_id',
            type: 'string',
            format: 'id'
          },
          {
            key: 'coordinates',
            label: '經緯度坐標',
            dataPath: 'coordinates',
            type: 'coordinates',
            format: 'coordinates'
          },
          {
            key: 'longitude',
            label: '經度',
            dataPath: 'longitude',
            type: 'number',
            format: 'coordinate',
            decimals: 6
          },
          {
            key: 'latitude',
            label: '緯度',
            dataPath: 'latitude',
            type: 'number',
            format: 'coordinate',
            decimals: 6
          },
          {
            key: 'last_updated',
            label: '最後更新',
            dataPath: 'metadata.last_updated',
            type: 'datetime',
            format: 'datetime'
          },
          {
            key: 'total_records',
            label: '數據記錄數',
            dataPath: 'metadata.total_records',
            type: 'number',
            format: 'count'
          }
        ]
      }
    ]
  }
};

// Utility functions for data extraction and formatting
export const DataUtils = {
  // Extract value from nested object using dot notation path
  extractValue: (data, path) => {

    if (!data || !path) {
      return null;
    }

    // Try the original path first
    const keys = path.split('.');
    let value = data;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];

      if (value == null) {
        break;
      }

      value = value[key];
    }

    // If we found a value, return it
    if (value != null) {
      return value;
    }

    // If not found and path starts with 'categories.', try 'properties.' instead
    if (path.startsWith('categories.')) {
      const alternativePath = path.replace('categories.', 'properties.');
      return DataUtils.extractValue(data, alternativePath);
    }

    return null;
  },

  // Format value based on field configuration
  formatValue: (value, field) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    switch (field.type) {
      case 'number':
        const numValue = parseFloat(value);
        if (isNaN(numValue)) return value;

        switch (field.format) {
          case 'decimal':
            return numValue.toFixed(field.decimals || 2);
          case 'signal':
            return `${numValue.toFixed(field.decimals || 2)} ${field.unit || ''}`.trim();
          case 'coordinate':
            return numValue.toFixed(field.decimals || 6);
          case 'count':
            return Math.round(numValue).toString();
          default:
            return numValue.toString();
        }

      case 'coordinates':
        if (Array.isArray(value) && value.length >= 2) {
          return `${value[0]?.toFixed(6)}, ${value[1]?.toFixed(6)}`;
        }
        return value;

      case 'datetime':
        try {
          return new Date(value).toLocaleString('zh-HK');
        } catch (e) {
          return value;
        }

      case 'string':
      default:
        return value.toString();
    }
  },

  // Get priority color class for styling
  getPriorityClass: (priority) => {
    switch (priority) {
      case 'critical': return 'priority-critical';
      case 'high': return 'priority-high';
      case 'medium': return 'priority-medium';
      case 'low': return 'priority-low';
      default: return 'priority-medium';
    }
  },

  // Get priority display name in Chinese
  getPriorityLabel: (priority) => {
    switch (priority) {
      case 'critical': return '關鍵';
      case 'high': return '重要';
      case 'medium': return '一般';
      case 'low': return '參考';
      default: return '一般';
    }
  },

  // Get available schemas based on data content
  getAvailableSchemas: (data) => {
    const availableSchemas = [];

    // Check each schema's condition
    Object.values(DATA_SCHEMAS).forEach(schema => {

      const hasData = schema.sections.some(section => {
        if (section.condition) {
          const conditionResult = section.condition(data);
          return conditionResult;
        }
        return false;
      });

      if (hasData) {
        availableSchemas.push(schema);
      }
    });


    // Sort by priority and label
    const sortedSchemas = availableSchemas.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.label.localeCompare(b.label, 'zh');
    });

    return sortedSchemas;
  }
};

export default DATA_SCHEMAS;