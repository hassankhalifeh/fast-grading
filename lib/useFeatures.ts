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
    const [f, active, hist] = await Promise.all([
      supabase.from("account_features").select("feature_key").eq("account_id", appUser.account_id).eq("enabled", true),
      supabase.rpc("whatsapp_active"),
      supabase.from("whatsapp_messages").select("id").limit(1),
    ]);
    const set = new Set<string>(f.error ? [] : (f.data ?? []).map((x: any) => x.feature_key));
    if (active.data === true) set.add("whatsapp_active");
    // سجل المحادثات يبقى متاحاً ما دام هناك اشتراك أو توجد رسائل موثّقة (حتى لو أُوقفت الخدمة)
    if (set.has("whatsapp_notifications") || (hist.data ?? []).length > 0) set.add("whatsapp_history");
    setFeatures(set);
  }, [appUser]);

  useEffect(() => { refresh(); }, [refresh]);

  return { features, refresh };
}
