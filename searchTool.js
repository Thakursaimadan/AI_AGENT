import pool from './db.js';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const searchComponent = tool(
  async ({ clientId, criteria }) => {
    try {
      const clauses = ['client_id = $1'];
      const values = [clientId];
      let idx = 2;

      for (const [key, val] of Object.entries(criteria)) {
        if (key.includes('.')) {
          const [col, jsonKey] = key.split('.');
          clauses.push(`${col}->> '${jsonKey}' ILIKE $${idx}`);
        } else {
          clauses.push(`${key}::text ILIKE $${idx}`);
        }
        values.push(`%${val}%`);
        idx++;
      }

      const sql = `SELECT component_id, component_type, props FROM components WHERE ${clauses.join(' AND ')}`;
      const { rows } = await pool.query(sql, values);
      
      return {
        success: true,
        components: rows.map(r => ({
          componentId: r.component_id,
          type: r.component_type,
          props: r.props
        }))
      };
    } catch (error) {
      console.error('Search component error:', error);
      return {
        success: false,
        error: 'Failed to search components',
        details: error.message
      };
    }
  },
  {
    name: 'searchComponent',
    description: 'Find component IDs matching criteria for a client',
    schema: z.object({ 
      clientId: z.string(), 
      criteria: z.record(z.string()).describe("Search criteria as key-value pairs")
    })
  }
);