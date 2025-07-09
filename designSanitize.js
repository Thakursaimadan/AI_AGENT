// designSanitize.js

import Fuse from "fuse.js";

// Expanded mapping for all major fields in the design object
export const designUpdateFieldMap = {
	// Header Design
	layout: "header_design.Layout",
	"banner mediaurl": "header_design.banner_mediaUrl",
	"banner image url": "header_design.banner_image_url",
	"banner library id": "header_design.banner_library_id",
	"banner source url": "header_design.banner_source_url",
	"social icon style": "header_design.social-icon-style",
	"social-icon-style": "header_design.social-icon-style",
	socialiconstyle: "header_design.social-icon-style",
	social_icon_style: "header_design.social-icon-style",
	socialIconStyle: "header_design.social-icon-style",

	// Color Palate
	// "color palate name": "color_palate.name",
	// "color palette name": "color_palate.name",
	// "accent color": "color_palate.colors.accent",
	// "primary color": "color_palate.colors.primary",
	// "secondary color": "color_palate.colors.secondary",
	// "background color": "color_palate.colors.background",

	// Appearance
	"appearance title": "appearance.title",
	"appearance background": "appearance.background",
	"video type": "appearance.video_type",
	"image title": "appearance.image_title",
	"video title": "appearance.video_title",
	"media source": "appearance.media_source",
	"appearance background image url": "appearance.background_image_url",
	"appearance background thumbnail": "appearance.background_thumbnail",
	"appearance background video url": "appearance.background_video_url",
	"appearance background library id": "appearance.background_library_id",

	// Page Props
	"page filter": "page_props.filter",
	"page animation": "page_props.animation",
	"page background": "page_props.background",
	"page color count": "page_props.color_count",
	"page gradient type": "page_props.gradient_type",
	"page animation shapes": "page_props.animation_shapes",
	"header text icons": "page_props.header-text-icons",
	"animation position": "page_props.animation_position",
	"page background mediaurl": "page_props.background_mediaUrl",

	// Link Block
	"link text color": "link_block.text",
	"link background color": "link_block.background",

	// Card Block
	"card text color": "card_block.text",
	"card background color": "card_block.background",
	"card button text color": "card_block.button-text",
	"card button background color": "card_block.button-background",

	// Desktop Background
	"desktop background type": "desktop_background.type",
	"desktop's background type": "desktop_background.type",
	"desktop's background" : "desktop_background.type",
	// "desktop background color": "desktop_background.background",
	// "desktop background color count": "desktop_background.color_count",
	"desktop background gradient type": "desktop_background.type",
	"gradient of desktop background" : "desktop_background.gradient_type",
	"gradient desktop background" : "desktop_background.gradient_type",
	"gradient type desktop background" : "desktop_background.gradient_type",

	// Card Design
	"card style": "card_design.style",
	"card radius": "card_design.radius",
	"card-radius": "card_design.radius",
	cardradius: "card_design.radius",
	card_radius: "card-radius",
	cardRadius: "card-radius",

	// Button Design
	"button style": "button_design.style",
	"button radius": "button_design.radius",

	// Text Props
	"title font": "text_props.titles",
	"subtitle font": "text_props.subtitles",


};

export const designFuse = new Fuse(Object.keys(designUpdateFieldMap), {
	threshold: 0.3,
	includeScore: true,
});

export function sanitizeDesignUpdates(rawUpdates) {
	const sanitized = {};
	for (const key in rawUpdates) {
		// Fuzzy match
		let mappedKey = designUpdateFieldMap[key];
		console.log("Sanitizing key:", key, "Mapped to:", mappedKey);
		if (!mappedKey) {
			const result = designFuse.search(key);
			console.log("Searching for key:", key, "Result:", result);
			if (result.length > 0) mappedKey = designUpdateFieldMap[result[0].item];
		}
		if (!mappedKey) continue; // skip unknown fields

		// Build nested object
		const parts = mappedKey.split(".");
		let curr = sanitized;
		for (let i = 0; i < parts.length - 1; i++) {
			curr[parts[i]] = curr[parts[i]] || {};
			curr = curr[parts[i]];
		}
		curr[parts[parts.length - 1]] = rawUpdates[key];
		console.log("Curr:", curr);
		console.log("Sanitized:", sanitized);
	}
	return sanitized;
}
