import { createClient } from "@supabase/supabase-js";

// The database is now shared with BusPulse (one project, separate Postgres schemas per product) —
// `fastgrading` is this product's own schema there, kept fully isolated from BusPulse's `public` schema.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { db: { schema: "fastgrading" } }
);
