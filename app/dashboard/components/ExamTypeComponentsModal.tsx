"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { ExamTypeComponent } from "@/lib/types";
import { X, Plus, Trash2 } from "lucide-react";

// "المدرسة تمنح المعلم حق إدخال أكثر من علامة للاختبار الواحد وتضع
// نسباً بينهما" — this screen is exactly that: define the split for
// one exam type (e.g. "امتحان نهائي" = تحريري 80% + شفهي 20%). The
// database trigger (enforce_component_weights_sum_100) is the real
// guard; this screen just makes hitting 100% easy to see while editing.
export default function ExamTypeComponentsModal({
  examTypeId, examTypeName, onClose,
}: { examTypeId: string; examTypeName: string; onClose: () => void }) {
  const [components, setComponents] = useState<ExamTypeComponent[]>([]);
  const [newName, setNewName] = useState("");
  const [newWeight, setNewWeight] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    supabase.from("exam_type_components").select("*").eq("exam_type_id", examTypeId)
      .then(({ data }) => setComponents(data ?? []));
  }
  useEffect(() => { load(); }, [examTypeId]);

  const total = components.reduce((sum, c) => sum + Number(c.weight_percent), 0);

  async function addComponent() {
    if (!newName || newWeight === "") return;
    setError(null);
    const { error: err } = await supabase.from("exam_type_components")
      .insert({ exam_type_id: examTypeId, component_name: newName, weight_percent: newWeight });
    if (err) setError(err.message);
    else { setNewName(""); setNewWeight(""); load(); }
  }

  async function removeComponent(id: string) {
    await supabase.from("exam_type_components").delete().eq("id", id);
    load();
  }

  return (
    <div onClick={onClose} className="fade-in" style={{ position: "fixed", inset: 0, background: "rgba(44,52,84,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ padding: "1.5rem", width: 440, maxWidth: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--indigo)" }}>مكوّنات: {examTypeName}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--steel)", marginBottom: 14 }}>
          مجموع النسب حالياً: <strong style={{ color: total === 100 ? "var(--green)" : "var(--red)" }}>{total}%</strong>
          {total !== 100 && components.length > 0 && " — يجب أن يكون المجموع 100% ليُقبل الحفظ"}
        </p>

        {components.map((c) => (
          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--fog)" }}>
            <span>{c.component_name} — {c.weight_percent}%</span>
            <button onClick={() => removeComponent(c.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <input placeholder="اسم المكوّن (مثلاً تحريري)" value={newName} onChange={(e) => setNewName(e.target.value)} className="input" />
          <input placeholder="%" type="number" value={newWeight} onChange={(e) => setNewWeight(e.target.valueAsNumber)} className="input" style={{ width: 80 }} />
          <button onClick={addComponent} className="btn btn-secondary" style={{ padding: "10px 14px" }}><Plus size={16} /></button>
        </div>
        {error && <p style={{ color: "var(--red)", fontSize: "0.8rem", marginTop: 10 }}>{error}</p>}
      </div>
    </div>
  );
}
