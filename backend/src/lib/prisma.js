/**
 * Prisma Database Client Configuration
 * Uses @prisma/adapter-pg to connect to Supabase PostgreSQL efficiently.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// Initialize a PostgreSQL connection pool using the DATABASE_URL from .env
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Create a Prisma adapter to use the connection pool instead of Prisma's default engine
// This improves connection handling in serverless/cloud environments like Supabase
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export default prisma;