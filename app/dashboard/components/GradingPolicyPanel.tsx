"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function GradingPolicyPanel({ accountId }: { accountId: string }) {
  const [policy, setPolicy] = useState<{ id?: string; formula_type: string; passing_threshold_percent: number }>({
    formula_type: "weighted_by_exam_type",
    passing_threshold_percent: 50,
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("grading_policies")
      .select("*")
      .eq("account_id", accountId)
      .maybeSingle()
      .then(({ data }) => { if (data) setPolicy(data); });
  }, [accountId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error: err } = await supabase
      .from("grading_policies")
      .upsert({ ...policy, account_id: accountId }, { onConflict: "account_id" });
    if (err) setError(err.message);
    else { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  }

  return (
    <form onSubmit={save} className="card fade-in" style={{ padding: "1.5rem", maxWidth: 460 }}>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginBottom: 18 }}>
        هذه الإعدادات تُطبَّق تلقائياً على كل الصفوف، وتقبل استثناءات لكل صف من شاشة "الصفوف".
      </p>

      <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 5 }}>صيغة احتساب المعدل</label>
      <select
        className="input" style={{ marginBottom: 16 }}
        value={policy.formula_type}
        onChange={(e) => setPolicy({ ...policy, formula_type: e.target.value })}
      >
        <option value="weighted_by_exam_type">مرجّح حسب نوع الاختبار (السعي/الفصل/النهائي بأوزان مختلفة)</option>
        <option value="simple_average">معدل بسيط لكل العلامات</option>
      </select>

      <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 5 }}>حد النجاح (%)</label>
      <input
        type="number" className="input" style={{ marginBottom: 16 }}
        value={policy.passing_threshold_percent}
        onChange={(e) => setPolicy({ ...policy, passing_threshold_percent: e.target.valueAsNumber })}
      />

      {error && <p style={{ color: "var(--red)", fontSize: "0.85rem", marginBottom: 12 }}>{error}</p>}

      <button type="submit" className="btn btn-gold">{saved ? "تم الحفظ ✓" : "حفظ الإعدادات"}</button>
    </form>
  );
}
