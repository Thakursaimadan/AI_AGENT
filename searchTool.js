import pool from "./db.js";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const searchComponent = tool(
	async ({ clientId, criteria }) => {
		try {
			const clauses = ["client_id = $1"];
			const values = [clientId];
			let idx = 2;
			console.log("Search tool woth criteria:", criteria);
			for (const [key, val] of Object.entries(criteria)) {
				console.log("Key", key, "and", val, "val");
				if (key.includes(".")) {
					const [col, jsonKey] = key.split(".");
					clauses.push(`${col}->>'${jsonKey}' = $${idx}`);
				} else {
					const exactMatch = key === "component_type"; // <- add this
					const comparator = exactMatch ? "=" : "ILIKE";
					clauses.push(`${key}::text ${comparator} $${idx}`);
				}

				values.push(`${val}`);
				idx++;
			}
			console.log("Values :", values[2]);
			const sql = `SELECT component_id, component_type, props FROM components WHERE ${clauses.join(
				" AND "
			)}`;

			console.log("SQL query:", sql);
			const { rows } = await pool.query(sql, values);

			console.log("Rows", rows);

			return {
				success: true,
				components: rows.map((r) => ({
					componentId: r.component_id,
					type: r.component_type,
					props: r.props,
				})),
			};
		} catch (error) {
			console.error("Search component error:", error);
			return {
				success: false,
				error: "Failed to search components",
				details: error.message,
			};
		}
	},
	{
		name: "searchComponent",
		description: "Find component IDs matching criteria for a client",
		schema: z.object({
			clientId: z.string(),
			criteria: z
				.record(z.string())
				.describe("Search criteria as key-value pairs"),
		}),
	}
);
