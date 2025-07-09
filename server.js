import express from "express";
import { chatController } from "./chatController.js";
import dotenv from "dotenv";
dotenv.config();

const app = express();

const port = 8000;

app.use(express.json());

app.post("/api/chat", chatController);

app.get("/", (req, res) => {
	res.send("Welcome to the AI Chat API!");
});

app.listen(port, () => {
	console.log(`Server is running on http://localhost:${port}`);
});
