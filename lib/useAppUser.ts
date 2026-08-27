"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import type { AppUser } from "./types";

export function useAppUser() {
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (isMounted) {
          setAppUser(null);
          setLoading(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from("app_users")
        .select("*")
        .eq("auth_uid", user.id)
        .single();

      if (isMounted) {
        if (error) console.error("Failed to load app_users row:", error.message);
        setAppUser(data ?? null);
        setLoading(false);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  return { appUser, loading };
}
