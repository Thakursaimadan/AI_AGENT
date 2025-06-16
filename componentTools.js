import pool from "./db.js";
import { sanitizeUpdates } from "./sanitizeUpdates.js";

export async function getComponent({ clientId, componentId }) {
	console.log("🔍 getComponent called with:", { clientId, componentId });

	try {
		let sql, values;

		if (componentId) {
			sql =
				"SELECT * FROM components WHERE client_id = $1 AND component_id = $2";
			values = [clientId, componentId];
			console.log("📋 SQL for specific component:", sql, values);
		} else {
			sql = "SELECT * FROM components WHERE client_id = $1";
			values = [clientId];
			console.log("📋 SQL for all components:", sql, values);
		}

		const { rows } = await pool.query(sql, values);
		console.log("📊 Query result rows:", rows.length);

		if (componentId && rows.length === 0) {
			console.log("❌ Component not found");
			return {
				success: false,
				error: `Component with ID ${componentId} not found for client ${clientId}`,
			};
		}

		console.log("✅ getComponent successful");
		return {
			success: true,
			components: rows,
		};
	} catch (error) {
		console.error("❌ Get component error:", error);
		return {
			success: false,
			error: "Failed to retrieve component",
			details: error.message,
		};
	}
}

export async function updateComponent({ clientId, componentId, updates }) {
    console.log("🔄 updateComponent called with:");
    console.log("  - clientId:", clientId);
    console.log("  - componentId:", componentId);
    console.log("  - updates:", updates);
    console.log("  - updates type:", typeof updates);
    console.log("  - updates is null/undefined:", updates == null);

    try {
        // Validate required parameters
        if (!clientId) {
            console.log("❌ Missing clientId");
            return { success: false, error: "clientId is required" };
        }
        if (!componentId) {
            console.log("❌ Missing componentId");
            return { success: false, error: "componentId is required" };
        }
        if (!updates || typeof updates !== "object" || Object.keys(updates).length === 0) {
            console.log("❌ Invalid or empty updates object");
            return {
                success: false,
                error: "updates object is required and must contain at least one field to update",
            };
        }

        const { sanitized, rejected } = sanitizeUpdates(updates);
        if (Object.keys(sanitized).length === 0) {
            console.log("❌ No valid fields to update after sanitization");
            return { success: false, error: "No valid fields to update", rejectedFields: rejected };
        }
        console.log("🔧 Sanitized updates:", sanitized);
        updates = sanitized;

        // Check if component exists
        const checkSql =
            "SELECT component_id FROM components WHERE client_id = $1 AND component_id = $2";
        const { rows: existingRows } = await pool.query(checkSql, [clientId, componentId]);
        if (existingRows.length === 0) {
            console.log("❌ Component does not exist");
            return { success: false, error: `Component with ID ${componentId} not found for client ${clientId}` };
        }

        console.log("✅ Component exists, proceeding with update...");

        // Build dynamic update query
        const setClauses = [];
        const values = [clientId, componentId];
        let idx = 3;

        console.log("🔧 Building update query...");
        for (const [key, value] of Object.entries(updates)) {
            console.log(`  - Processing field: ${key} = ${value}`);

            // If updating JSONB 'props' with an object, merge instead of replace
            if (key === 'props' && typeof value === 'object') {
                setClauses.push(
                    `props = COALESCE(props, '{}'::jsonb) || $${idx}::jsonb`
                );
                values.push(JSON.stringify(value));
                console.log(
                    `    - JSONB merge update: props || ${JSON.stringify(value)}`
                );

            } else if (key.includes('.')) {
                // Handle nested JSON updates (e.g., props.title)
                const [column, jsonKey] = key.split('.');
                setClauses.push(
                    `${column} = jsonb_set(COALESCE(${column}, '{}'::jsonb), '{${jsonKey}}', $${idx}::jsonb, true)`
                );
                values.push(JSON.stringify(value));
                console.log(
                    `    - JSON update: ${column}.${jsonKey} = ${JSON.stringify(value)}`
                );

            } else {
                // Direct column update
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

        console.log("📋 Final SQL:", sql);
        console.log("📋 SQL values:", values);

        const { rows } = await pool.query(sql, values);
        console.log("✅ Update successful, returning:", rows[0]);

        return {
            success: true,
            message: `Component ${componentId} updated successfully`,
            component: rows[0],
        };
    } catch (error) {
        console.error("❌ Update component error:", error);
        console.error("❌ Error stack:", error.stack);
        return {
            success: false,
            error: "Failed to update component",
            details: error.message,
        };
    }
}

const getSecurityGroupId = async (security_group_title, clientId) => {
	try {
		const res = await pool.query(
			`SELECT security_group_id FROM security_groups 
       WHERE client_id = $1 AND security_group_title = $2`,
			[clientId, security_group_title]
		);

		if (res.rows.length === 0) {
			return null; // No matching security group found
		}

		return res.rows[0].security_group_id;
	} catch (err) {
		console.error("Error fetching security group ID:", err);
		throw new Error("Database error while fetching security group ID");
	}
};

export const addSecurityGroup = async ({
	clientId,
	componentId,
	security_group_title,
}) => {
	console.log("🔒 addSecurityGroup called with:", {
		clientId,
		componentId,
		security_group_title,
	});
	if (!clientId || !componentId || !security_group_title) {
		console.error("❌ Missing required parameters");
		return {
			success: false,
			error: "clientId, componentId, and security_group_title are required",
		};
	}
	const security_group_id = await getSecurityGroupId(
		security_group_title,
		clientId
	);
	if (!security_group_id) {
		console.error("❌ Security group does not exist");
		return {
			success: false,
			error: `Security group with title "${security_group_title}" does not exist for client ${clientId}`,
		};
	}
	console.log("✅ Security group found with ID:", security_group_id);

	try {
		// Check if the component already has this security group
		const checkRes = await pool.query(
			`SELECT * FROM component_security_groups 
       WHERE component_id = $1 AND security_group_id = $2`,
			[componentId, security_group_id]
		);

		if (checkRes.rows.length > 0) {
			console.log("❌ Security group already exists for this component");
			return {
				success: false,
				error: "Security group already exists for this component",
			};
		}

		// Insert the new security group for the component
		await pool.query(
			`INSERT INTO component_security_groups (component_id, security_group_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
			[componentId, security_group_id]
		);

		const isSecured = true; // Since we are adding a security group, the component is now secured

		await pool.query(
			`UPDATE components SET is_secured = $1 WHERE component_id = $2`,
			[isSecured, componentId]
		);

		console.log("✅ Security group added and is_secured updated");
		return {
			success: true,
			message: "Security group added successfully",
			is_secured: isSecured,
		};
	} catch (err) {
		console.error("❌ Error adding security group:", err);
		return {
			success: false,
			error: "Failed to add security group",
			details: err.message,
		};
	}
};

export const removeSecurityGroup = async ({
	clientId,
	componentId,
	security_group_title,
}) => {
	console.log("🔒 removeSecurityGroup called with:", {
		clientId,
		componentId,
		security_group_title,
	});

	if (!clientId || !componentId || !security_group_title) {
		console.error("❌ Missing required parameters");
		return {
			success: false,
			error: "clientId, componentId, and security_group_title are required",
		};
	}

	const security_group_id = await getSecurityGroupId(
		security_group_title,
		clientId
	);

	if (!security_group_id) {
		console.error("❌ Security group does not exist");
		return {
			success: false,
			error: `Security group with title "${security_group_title}" does not exist for client ${clientId}`,
		};
	}
	console.log("✅ Security group found with ID:", security_group_id);

	try {
		// Check if the component already has this security group
		const checkRes = await pool.query(
			`SELECT * FROM component_security_groups 
       WHERE component_id = $1 AND security_group_id = $2`,
			[componentId, security_group_id]
		);

		if (checkRes.rows.length == 0) {
			console.log("❌ Security group does not exist for this component");
			return {
				success: false,
				error: "Security group does not exist for this component",
			};
		}

		// Delete the security group for the component
		await pool.query(
			`DELETE FROM component_security_groups 
       WHERE component_id = $1 AND security_group_id = $2`,
			[componentId, security_group_id]
		);
		console.log("✅ Security group removed from component");
		// Check if the component has any other security groups
		const remainingGroups = await pool.query(
			`SELECT * FROM component_security_groups 
       WHERE component_id = $1`,
			[componentId]
		);
		if (remainingGroups.rows.length === 0) {
			// If no other security groups, set is_secured to false
			await pool.query(
				`UPDATE components SET is_secured = $1 WHERE component_id = $2`,
				[false, componentId]
			);
			console.log("✅ Component is no longer secured");
		} else {
			// If there are still security groups, keep is_secured as true
			await pool.query(
				`UPDATE components SET is_secured = $1 WHERE component_id = $2`,
				[true, componentId]
			);
			console.log("✅ Component remains secured");
		}

		return {
			success: true,
			message: "Security group removed successfully",
			is_secured: remainingGroups.rows.length > 0, // Return true if there are still security groups
		};
	} catch (err) {
		console.error("❌ Error removing security group:", err);
		return {
			success: false,
			error: "Failed to remove security group",
			details: err.message,
		};
	}
};

export const deleteComponent = async ({ clientId, componentId }) => {
	try {
		console.log("🗑️ deleteComponent called with:", { clientId, componentId });
		if (!clientId || !componentId) {
			console.error("❌ Missing required parameters");
			return {
				success: false,
				error: "clientId and componentId are required",
			};
		}
		// Check if the component exists
		const checkRes = await pool.query(
			`SELECT * FROM components WHERE client_id = $1 AND component_id = $2`,
			[clientId, componentId]
		);
		if (checkRes.rows.length === 0) {
			console.error("❌ Component not found");
			return {
				success: false,
				error: `Component with ID ${componentId} not found for client ${clientId}`,
			};
		}
		// Proceed to delete the component
		console.log("✅ Component found, proceeding to delete...");
		const result = await pool.query(
			`DELETE FROM components WHERE component_id = $1`,
			[componentId]
		);
		if (!result.rowCount) {
			console.error("❌ Component deletion failed");
			return {
				success: false,
				error: "Failed to delete component",
			};
		}
		console.log("✅ Component deleted successfully");
		return {
			success: true,
			message: `Component with ID ${componentId} deleted successfully`,
		};
	} catch (err) {
		console.error("Error deleting component:", err);
		return {
			success: false,
			error: "Internal Server Error",
			message: err.message,
		};
	}
};
