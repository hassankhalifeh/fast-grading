"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import type { AppUser } from "./types";

// UI-level convenience only — hides sections/buttons the user has no
// capability for, so the dashboard doesn't dangle actions that would
// just be rejected by RLS anyway. RLS (see 04_config_permissions_ranking.sql
// and 06_rls_for_upgrade_tables.sql) is what actually enforces this;
// this hook never substitutes for it.
export function useCapabilities(appUser: AppUser | null) {
  const [capabilities, setCapabilities] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!appUser) return;
    supabase
      .from("user_capabilities")
      .select("capability_key, granted")
      .eq("app_user_id", appUser.id)
      .then(({ data, error }) => {
        if (error) {
          // Likely upgrade 04/06 hasn't been run yet on this project —
          // fail open to "no capabilities known" rather than crash the
          // whole dashboard, so the rest of the app stays usable.
          console.warn("Could not load capabilities (has upgrade 04/06 been run?):", error.message);
          setCapabilities(new Set());
          return;
        }
        setCapabilities(new Set((data ?? []).filter((c) => c.granted).map((c) => c.capability_key)));
      });
  }, [appUser]);

  return capabilities;
}
