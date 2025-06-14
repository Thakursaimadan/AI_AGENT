import pool from './db.js';

export async function getComponent({ clientId, componentId }) {
  console.log('🔍 getComponent called with:', { clientId, componentId });
  
  try {
    let sql, values;
    
    if (componentId) {
      sql = 'SELECT * FROM components WHERE client_id = $1 AND component_id = $2';
      values = [clientId, componentId];
      console.log('📋 SQL for specific component:', sql, values);
    } else {
      sql = 'SELECT * FROM components WHERE client_id = $1';
      values = [clientId];
      console.log('📋 SQL for all components:', sql, values);
    }
    
    const { rows } = await pool.query(sql, values);
    console.log('📊 Query result rows:', rows.length);
    
    if (componentId && rows.length === 0) {
      console.log('❌ Component not found');
      return {
        success: false,
        error: `Component with ID ${componentId} not found for client ${clientId}`
      };
    }
    
    console.log('✅ getComponent successful');
    return {
      success: true,
      components: rows
    };
  } catch (error) {
    console.error('❌ Get component error:', error);
    return {
      success: false,
      error: 'Failed to retrieve component',
      details: error.message
    };
  }
}

export async function updateComponent({ clientId, componentId, updates }) {
  console.log('🔄 updateComponent called with:');
  console.log('  - clientId:', clientId);
  console.log('  - componentId:', componentId);
  console.log('  - updates:', updates);
  console.log('  - updates type:', typeof updates);
  console.log('  - updates is null/undefined:', updates == null);
  
  try {
    // Validate required parameters
    if (!clientId) {
      console.log('❌ Missing clientId');
      return {
        success: false,
        error: 'clientId is required'
      };
    }
    
    if (!componentId) {
      console.log('❌ Missing componentId');
      return {
        success: false,
        error: 'componentId is required'
      };
    }
    
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      console.log('❌ Invalid or empty updates object');
      return {
        success: false,
        error: 'updates object is required and must contain at least one field to update'
      };
    }
    
    // First check if component exists
    console.log('🔍 Checking if component exists...');
    const checkSql = 'SELECT component_id FROM components WHERE client_id = $1 AND component_id = $2';
    const { rows: existingRows } = await pool.query(checkSql, [clientId, componentId]);
    
    if (existingRows.length === 0) {
      console.log('❌ Component does not exist');
      return {
        success: false,
        error: `Component with ID ${componentId} not found for client ${clientId}`
      };
    }
    
    console.log('✅ Component exists, proceeding with update...');

    // Build dynamic update query
    const setClauses = [];
    const values = [clientId, componentId];
    let idx = 3;

    console.log('🔧 Building update query...');
    for (const [key, value] of Object.entries(updates)) {
      console.log(`  - Processing field: ${key} = ${value}`);
      
      if (key.includes('.')) {
        // Handle nested JSON updates (e.g., props.title)
        const [column, jsonKey] = key.split('.');
        setClauses.push(`${column} = jsonb_set(COALESCE(${column}, '{}'), '{${jsonKey}}', $${idx})`);
        values.push(JSON.stringify(value));
        console.log(`    - JSON update: ${column}.${jsonKey} = ${JSON.stringify(value)}`);
      } else {
        // Handle direct column updates
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
        console.log(`    - Direct update: ${key} = ${value}`);
      }
      idx++;
    }

    const sql = `
      UPDATE components 
      SET ${setClauses.join(', ')}
      WHERE client_id = $1 AND component_id = $2
      RETURNING *
    `;

    console.log('📋 Final SQL:', sql);
    console.log('📋 SQL values:', values);

    const { rows } = await pool.query(sql, values);
    console.log('✅ Update successful, returning:', rows[0]);
    
    return {
      success: true,
      message: `Component ${componentId} updated successfully`,
      component: rows[0]
    };
  } catch (error) {
    console.error('❌ Update component error:', error);
    console.error('❌ Error stack:', error.stack);
    return {
      success: false,
      error: 'Failed to update component',
      details: error.message
    };
  }
}