import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env.local for local development so `drizzle-kit` picks it up
config({ path: ".env.local" });

const url =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL_UNPOOLED (or DATABASE_URL) is required for drizzle-kit. " +
      "Set it in .env.local or your shell.",
  );
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
