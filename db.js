import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: {
		rejectUnauthorized: false,
	},
	connectionTimeoutMillis: 120000, // Timeout after 5 seconds
	idleTimeoutMillis: 3000,
});

pool
	.connect()
	.then(() => console.log("Connected to NeonDB PostgreSQL"))
	.catch((err) => console.error("Connection error", err));

export default pool;
