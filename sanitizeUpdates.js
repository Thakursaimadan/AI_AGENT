export const protectedFields = [
	"clientId",
	"componentId",
	"component_type",
	"library_id",
];

// Optional: define allowed top-level keys if you prefer whitelist over blacklist
// export const allowedFields = ["props", "layout_json", "link_props"];

export function sanitizeUpdates(rawUpdates) {
	const sanitized = {};
	const rejected = [];

	for (const key in rawUpdates) {
		if (protectedFields.includes(key)) {
			rejected.push(key);
			continue;
		}

		// Optional: deep protection for nested props
		const parts = key.split(".");
		const path = [];

		let isProtected = false;
		for (const part of parts) {
			path.push(part);
			if (protectedFields.includes(path.join("."))) {
				isProtected = true;
				rejected.push(key);
				break;
			}
		}

		if (!isProtected) {
			sanitized[key] = rawUpdates[key];
		}
	}

	return { sanitized, rejected };
}
