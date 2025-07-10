import pool from "./db.js";
import dotenv from "dotenv";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
dotenv.config();

const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN;

function cloudfrontUrl(key) {
	if (!key) return null;
	return `https://${CLOUDFRONT_DOMAIN}/${key}`;
}

export const DESIGN_OPTIONS = {
	header_layout: ["classic", "compact", "banner", "imaged"],
	header_socialIconStyle: ["solid", "stroked", "soft-shadow"],
	appearance_background: [
		"none",
		"solid",
		"gradient",
		"image",
		"video",
		"dualcolor",
	],
	cardDesign_Style: ["solid", "stroked", "soft-shadow", "hard-shadow"],
	cardDesign_Radius: ["no-radius", "small", "medium", "full"],
	buttonDesign_Style: ["solid", "stroked", "soft-shadow"],
	buttonDesign_Radius: ["no-radius", "small", "medium", "full"],
};

export const OPTION_EXPLANATIONS = {
	header_socialIconStyle: {
		solid: "Filled social media icons",
		stroked: "Outlined social media icons",
		"soft-shadow": "Social icons with subtle shadow effect",
	},
	cardDesign_Style: {
		solid: "Filled with solid color, no border",
		stroked: "Border with no fill, outline style",
		"soft-shadow": "Subtle shadow for depth effect",
		"hard-shadow": "Strong shadow for dramatic effect",
	},
	cardDesign_Radius: {
		"no-radius": "Sharp 90-degree corners",
		small: "Slightly rounded corners (4px)",
		medium: "Moderately rounded corners (8px)",
		full: "Pill-shaped corners (50%)",
	},
	buttonDesign_Style: {
		solid: "Filled with solid color",
		stroked: "Border with no fill",
		"soft-shadow": "Button with soft drop shadow",
	},
	buttonDesign_Radius: {
		"no-radius": "Sharp corners",
		small: "Slight rounding (4px)",
		medium: "Medium rounding (8px)",
		full: "Fully rounded (pill shape)",
	},
	appearance_background: {
		none: "No background",
		solid: "Single color background",
		gradient: "Smooth color transition background",
		image: "Background with an image",
		video: "Background with a video",
		dualcolor: "Two-color split background",
	},
};

export const LAYOUT_DEFINITIONS = {
	classic: {
		Visual_Style: "Clean, minimalist design with structured layout",
		Profile_Section:
			"Circular profile photo prominently displayed at the top center",
		Username: "Centered below the profile photo",
		Navigation: "Buttons arranged horizontally below the username",
		Content_Area:
			"Multiple horizontal rectangular sections stacked vertically below the navigation",
		Layout_Structure: "Symmetrical, top-to-bottom flow with centered alignment",
		Overall_Feel:
			"Professional, traditional, and straightforward - similar to a standard social media profile layout",
		Best_For:
			"Users who prefer clean, professional aesthetics without distractions",
	},
	compact: {
		Visual_Style: "Space-efficient design with high information density",
		Profile_Section:
			"Smaller circular profile photo positioned in the upper left corner",
		Username: "Displayed next to the profile photo on the same horizontal line",
		Navigation: "Buttons positioned below the profile section",
		Content_Area:
			"Distinct rectangular input/content fields with defined borders",
		Layout_Structure: "Condensed layout maximizing vertical space usage",
		Overall_Feel: "Modern, streamlined, and mobile-optimized",
		Best_For:
			"Users who want maximum information density and mobile-first experience",
	},
	banner: {
		Visual_Style: "Balanced design with moderate spacing",
		Profile_Section: "Circular profile photo centered at the top",
		Username: "Centered below the profile photo",
		Navigation: "Buttons arranged horizontally below the username",
		Content_Area:
			"Multiple horizontal banner-style sections with consistent spacing",
		Layout_Structure:
			"Similar to classic but with more emphasis on horizontal sections and also additionally can add a banner image",
		Overall_Feel:
			"Balanced between professional and casual, moderate visual weight",
		Best_For:
			"Users who want a middle ground between bold and subtle aesthetics and want upload a banner image",
	},
	imaged: {
		Visual_Style: "Image-centric design with asymmetrical layout",
		Profile_Section:
			"Large portrait photo taking up significant space on one side of the layout",
		Username: "Positioned over or integrated with the profile image",
		Navigation: "Buttons positioned to complement the image layout",
		Content_Area:
			"Content sections arranged around the prominent profile image",
		Layout_Structure:
			"Asymmetrical design with image as the primary focal point",
		Overall_Feel: "Personal, visually striking, and brand-focused",
		Best_For:
			"Users who want to showcase their personality/brand through photography and prefer eye-catching, unique layouts",
	},
};

export const getClientDesign = async ({ clientId }) => {
	if (!clientId) {
		console.log("Client ID is required to fetch design");
		throw new Error("Client ID is required");
	}
	try {
		// const clientId = parseInt(args.clientId, 10); // ✅ convert to integer
		// if (isNaN(clientId)) throw new Error("Invalid clientId");
		console.log("Fetching design for client:", clientId);
		const result = await pool.query(
			`SELECT * FROM designs WHERE client_id = $1`,
			[clientId]
		);

		if (result.rows.length === 0) {
			throw new Error("Design not found for this client");
		}

		const banner_library_id = result.rows[0]?.banner_library_id;
		const background_library_id = result.rows[0]?.background_library_id;
		let banner_mediaUrl = null;
		let background_mediaUrl = null;
		if (banner_library_id) {
			const {
				rows: [ml],
			} = await pool.query(
				`SELECT s3_key
               FROM media_library
              WHERE library_id = $1
                AND client_id  = $2
              LIMIT 1`,
				[banner_library_id, clientId]
			);
			if (ml?.s3_key) {
				banner_mediaUrl = cloudfrontUrl(ml.s3_key);
			}
		}
		if (background_library_id) {
			const {
				rows: [ml],
			} = await pool.query(
				`SELECT s3_key
               FROM media_library
              WHERE library_id = $1
                AND client_id  = $2
              LIMIT 1`,
				[background_library_id, clientId]
			);
			if (ml?.s3_key) {
				background_mediaUrl = cloudfrontUrl(ml.s3_key);
			}
		}
		console.log(
			"Fetched design for client:",
			clientId,
			"Banner URL:",
			banner_mediaUrl,
			"Background URL:",
			background_mediaUrl
		);
		console.log("sample  -->\n", result.rows[0], "\n");
		return {
			...result.rows[0],
			banner_mediaUrl,
			background_mediaUrl,
		};
	} catch (err) {
		console.error("Error fetching design:", err);
		throw new Error("Internal server error");
	}
};

const JSONB_FIELDS = [
	"header_design",
	"color_palate",
	"appearance",
	"page_props",
	"link_block",
	"card_block",
	"desktop_background",
	"card_design",
	"button_design",
	"text_props",
];

export const updateDesign = async ({ clientId, designUpdates }) => {
	try {
		console.log(
			"Updating design for client:",
			clientId,
			"with updates:",
			designUpdates
		);

		if (!clientId || !designUpdates) {
			throw new Error("Client ID and updates are required");
		}

		const setClauses = [];
		const values = [];
		let idx = 1;

		for (const field of JSONB_FIELDS) {
			if (designUpdates[field] !== undefined) {
				// Merge incoming JSON into existing column
				setClauses.push(
					`${field} = COALESCE(${field}, '{}'::jsonb) || $${idx}`
				);
				values.push(designUpdates[field]);
				idx++;
			}
		}

		if (setClauses.length === 0) {
			throw new Error("No valid design fields to update.");
		}

		// Add WHERE param
		values.push(clientId);

		const sql = `
			UPDATE designs
			SET ${setClauses.join(", ")}
			WHERE client_id = $${idx}
			RETURNING *;
		`;

		try {
			const { rowCount, rows } = await pool.query(sql, values);
			if (!rowCount) {
				throw new Error("Design not found for this client");
			}

			return {
				design: rows[0],
				message: "Design updated successfully.",
			};
		} catch (err) {
			console.error("Error updating design:", err);
			throw new Error("Failed to update design");
		}
	} catch (err) {
		console.log("Error updating design:", err);
		throw new Error("Failed to update design");
	}
};

export const getQAForClient = async ({ clientId }) => {
	try {
		console.log("Fetching QA for client:", clientId);

		const clientType = await pool.query(
			"SELECT client_type FROM Client WHERE client_id = $1",
			[clientId]
		);

		// console.log("Client type for clientId:", clientId, "is", clientType);
		if (clientType.length === 0) {
			throw new Error("Client not found");
		}
		const questionQuery = await pool.query(
			"SELECT question_id, question_text, options FROM Questions WHERE client_type = $1",
			[clientType.rows[0].client_type]
		);

		if (questionQuery.rows.length === 0) {
			throw new Error("No questions found for this client type");
		}

		const questions = questionQuery.rows.map((row) => ({
			question_id: row.question_id,
			question_text: row.question_text,
			options: row.options || [],
		}));

		// console.log(
		// 	"Questions fetched for client type:",
		// 	clientType.rows[0].client_type
		// );
		// console.log("Questions:", questions);

		const answerQuery = await pool.query(
			"SELECT question_id, chosen_options FROM Answers WHERE client_id = $1",
			[clientId]
		);

		// const example = questions.find((q) => q.question_id === 1);
		// console.log("Example question:", example.question_text);

		// The answers should be mapped to the question text
		const answers = answerQuery.rows
			.map((row) => ({
				question: (
					questions.find((q) => q.question_id === row.question_id) || {}
				).question_text,
				chosen_options: row.chosen_options || [],
			}))
			.filter((a) => a.question !== undefined);

		// console.log("Fetched questions and answers for client:", clientId);
		// console.log("Questions:", questions);
		// console.log("Answers:", answers);
		// console.log("Final answers for client:", clientId, answers);
		return {
			answers: answers,
		};
	} catch (err) {
		console.error("Error fetching QA for client:", err);
		throw new Error("Internal server error");
	}
};
// getQAForClient({ clientId: 6 });
