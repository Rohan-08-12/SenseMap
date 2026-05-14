import "dotenv/config";
import { defineConfig } from 'prisma/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrate: {
    async adapter() {
      const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      });
      return new PrismaPg(pool);
    },
  },
});
