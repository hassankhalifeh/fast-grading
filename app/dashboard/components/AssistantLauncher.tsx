"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

// مساعد الذكاء الاصطناعي (Devology AI): سطر تضمين واحد يحمّل واجهة المساعد من بوابة Devology ويسلّمها جلسة المستخدم الحالية،
// فيفتح المساعد جلسة بتوكن المستخدم نفسه. لا يظهر شيء إلا إذا فعّل مالك المنصة الإعداد ومنح الإضافة لهذا الحساب
// (ai_assistant_config ترجع null وإلا). كل قراءة يقوم بها المساعد تمرّ بدوال ai_* في قاعدة البيانات وبصلاحيات المستخدم وRLS.
export default function AssistantLauncher({ userId }: { userId: string | null | undefined }) {
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase.rpc("ai_assistant_config").then(({ data, error }) => {
      if (cancelled || error || !data?.application_id || !data?.gateway_url) return;
      if (document.getElementById("devology-embed")) return;
      const s = document.createElement("script");
      s.id = "devology-embed";
      s.src = `${data.gateway_url}/widget/v1/embed.js`;
      s.defer = true;
      s.setAttribute("data-application", data.application_id);
      s.setAttribute("data-session", "supabase");
      document.body.appendChild(s);
    });
    return () => { cancelled = true; };
  }, [userId]);
  return null;
}
