/**
 * Entry point for the backend server.
 * Initializes the Express app and binds it to the specified port.
 */
import app from "./app.js";
import dotenv from "dotenv";

dotenv.config();

// Default to port 3000 if not specified in .env
const PORT = process.env.PORT || 3000;

import prisma from "./lib/prisma.js";

// Bind the server to all network interfaces (0.0.0.0) 
// This ensures compatibility and proper IPv4 handling.
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    
    // Test the database connection on startup
    prisma.$connect()
        .then(() => console.log("Database connected."))
        .catch(err => console.error('Database connection failed:', err.message));
});