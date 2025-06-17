import Fuse from "fuse.js";

export const updateFieldMap = {
	// props
	title: "props.title",
	heading: "props.title",
	"main heading": "props.title",

	caption: "props.caption",
	subtitle: "props.subtitle",
	description: "props.description",

	// link_props
	url: "link_props.url",
	link: "link_props.url",
	"link url": "link_props.url",
	"link address": "link_props.url",

	// layout_json
	"text alignment": "layout_json.textalignment",
	textalign: "layout_json.textalignment",
	"text-alignment": "layout_json.textalignment",
	textalignement: "layout_json.textalignment", // common typo
	"alignment of text": "layout_json.textalignment",
};

export const fuse = new Fuse(Object.keys(updateFieldMap), {
	threshold: 0.3,
	includeScore: true,
});

// export default fuse;
