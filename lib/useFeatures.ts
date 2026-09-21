"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import type { AppUser } from "./types";

// الميزات الإضافية لحساب المدرسة. الاشتراك تفعّله إدارة المنصة (account_features)،
// و"whatsapp_active" = مشترك + لم توقف المدرسة الخدمة من إعداداتها. للإخفاء في الواجهة فقط؛ الإنفاذ في قاعدة البيانات والـEdge Functions.
export function useFeatures(appUser: AppUser | null) {
  const [features, setFeatures] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!appUser) return;
    const [f, active] = await Promise.all([
      supabase.from("account_features").select("feature_key").eq("account_id", appUser.account_id).eq("enabled", true),
      supabase.rpc("whatsapp_active"),
    ]);
    const set = new Set<string>(f.error ? [] : (f.data ?? []).map((x: any) => x.feature_key));
    if (active.data === true) set.add("whatsapp_active");
    setFeatures(set);
  }, [appUser]);

  useEffect(() => { refresh(); }, [refresh]);

  return { features, refresh };
}
