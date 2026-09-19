"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import type { AppUser } from "./types";

// UI-level convenience only — hides sections/buttons the user has no
// capability for. RLS is what actually enforces this.
// يشمل الصلاحيات العامة (user_capabilities) والمقيّدة بنطاق (user_scoped_capabilities):
// صاحب صلاحية ضمن نطاق معيّن بيشوف القسم، والـRLS بتحدد شو بيقدر يعدّل فيه فعلياً.
export function useCapabilities(appUser: AppUser | null) {
  const [capabilities, setCapabilities] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!appUser) return;
    Promise.all([
      supabase.from("user_capabilities").select("capability_key, granted").eq("app_user_id", appUser.id),
      supabase.from("user_scoped_capabilities").select("capability_key").eq("app_user_id", appUser.id),
    ]).then(([general, scoped]) => {
      if (general.error) {
        console.warn("Could not load capabilities:", general.error.message);
        setCapabilities(new Set());
        return;
      }
      const keys = new Set<string>((general.data ?? []).filter((c) => c.granted).map((c) => c.capability_key));
      (scoped.data ?? []).forEach((c) => keys.add(c.capability_key));
      setCapabilities(keys);
    });
  }, [appUser]);

  return capabilities;
}
