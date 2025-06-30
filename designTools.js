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

export const getClientDesign = async (clientId) => {
	if (!clientId) {
		throw new Error("Client ID is required");
	}
	try {
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
		console.log("sample  -->\n",result.rows[0],"\n")
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

export const getClientDesignTool = tool(
	async ({ clientId }) => {
		try {
			const designData = await getClientDesign(clientId);
			return {
				success: true,
				design: designData,
			};
		} catch (error) {
			return {
				success: false,
				error: error.message,
			};
		}
	},
	{
		name: "getClientDesign",
		description: "Get the current design configuration for a client",
		schema: z.object({
			clientId: z.string().describe("The client ID to get design for"),
		}),
	}
);

export const updateDesignTool = tool(
	async ({ clientId, designUpdates }) => {
		try {
			// TODO: Implement actual design update logic
			console.log(
				"Updating design for client:",
				clientId,
				"with updates:",
				designUpdates
			);
			return {
				success: true,
				message: "Design updated successfully",
				updates: designUpdates,
			};
		} catch (error) {
			return {
				success: false,
				error: error.message,
			};
		}
	},
	{
		name: "updateDesign",
		description: "Update design configuration for a client",
		schema: z.object({
			clientId: z.string().describe("The client ID"),
			designUpdates: z.object({}).describe("Design updates to apply"),
		}),
	}
);
