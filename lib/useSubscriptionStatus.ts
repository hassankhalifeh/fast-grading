"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import type { AppUser } from "./types";

export interface SubStatus {
  ok: boolean; status: "active" | "suspended"; plan_type?: string; expires_at: string | null; days_left: number | null;
}

// حالة اشتراك حساب المدرسة (يضبطها مالك المنصة من /platform): للتنبيه فقط، والمنع الفعلي مفروض في قاعدة البيانات.
export function useSubscriptionStatus(appUser: AppUser | null) {
  const [sub, setSub] = useState<SubStatus | null>(null);
  useEffect(() => {
    if (!appUser) return;
    supabase.rpc("my_subscription_status").then(({ data }) => setSub((data as SubStatus) ?? null));
  }, [appUser]);
  return sub;
}
