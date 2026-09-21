"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import type { AppUser } from "./types";

// الميزات الإضافية المفعّلة لحساب المدرسة (account_features). التفعيل بيد مالك المنصة فقط.
// هنا لإخفاء الواجهة؛ الإنفاذ الفعلي في قاعدة البيانات (account_has_feature) والـEdge Function.
export function useFeatures(appUser: AppUser | null) {
  const [features, setFeatures] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!appUser) return;
    supabase.from("account_features").select("feature_key").eq("account_id", appUser.account_id).eq("enabled", true)
      .then(({ data, error }) => setFeatures(new Set(error ? [] : (data ?? []).map((f: any) => f.feature_key))));
  }, [appUser]);

  return features;
}
