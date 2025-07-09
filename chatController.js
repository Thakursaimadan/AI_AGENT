import { handleMessage } from "./supervisor.js";

export async function chatController(req, res) {
	const { message, conversation = [], pendingOperation = null } = req.body;

	if (!message) {
		return res.status(400).json({
			success: false,
			message: "Message is required.",
		});
	}

	try {
		const result = await handleMessage({
			message,
			conversation,
			pendingOperation,
		});

        console.log("ChatController result:", result);

		return res.status(200).json({
			response: {
				status: "success",
				data: {
					reply: result.reply,
					conversation: result.conversation,
					pendingOperation: result.pendingOperation,
				},
			},
		});
	} catch (err) {
		console.error("Error in chatController:", err);
		return res.status(500).json({
			success: false,
			message:
				err.message || "An error occurred while processing your request.",
		});
	}
}
