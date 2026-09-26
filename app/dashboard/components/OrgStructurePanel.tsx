"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser } from "@/lib/types";
import { Trash2 } from "lucide-react";
import { useTableKit } from "@/lib/tablekit";

const OVERVIEW_COLUMNS = [{ key: "class_name", label: "الشعبة" }, { key: "stage_name", label: "المرحلة" }, { key: "location", label: "الموقع" }, { key: "class_sup", label: "ناظر الصف" }, { key: "authority", label: "المسؤول فعلياً" }, { key: "assistants_count", label: "مساعدون" }, { key: "subjects_without_teacher", label: "مواد بلا أستاذ" }];
const CLASSES_COLUMNS = [{ key: "name", label: "الشعبة" }];

type Level = "class" | "floor" | "stage" | "building";
interface Named { id: string; name: string }
interface UserRow extends Named { role: string; is_active: boolean }
interface Floor extends Named { building_id: string | null }
interface Supervision { id: string; level: Level; supervisor_id: string; class_section_id: string | null; floor_id: string | null; stage_id: string | null; building_id: string | null }
interface Assistant { id: string; supervision_id: string; assistant_id: string }
interface Overview {
  class_id: string; class_name: string; stage_name: string | null; floor_name: string | null; building_name: string | null;
  class_supervisor: string | null; authority_level: string | null; authority_user: string | null;
  assistants_count: number; subjects_without_teacher: number;
}
interface Cap { key: string; label_ar: string }

const LEVELS: { id: Level; label: string; hint: string }[] = [
  { id: "stage", label: "ناظر المرحلة", hint: "الشأن التعليمي لمرحلته عبر كل المباني" },
  { id: "floor", label: "ناظر الطابق", hint: "شعب الطابق بكل مراحلها" },
  { id: "class", label: "ناظر الصف", hint: "شعبة واحدة" },
  { id: "building", label: "ناظر المبنى", hint: "إدارة المبنى فقط (طوابق وتوزيع شعب)، بلا شأن تعليمي" },
];
const AUTH_LABEL: Record<string, string> = { class: "ناظر الصف", stage: "ناظر المرحلة", floor: "ناظر الطابق", principal: "الناظر العام" };
const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;

function friendly(m: string) {
  if (m.includes("supervisions_one_per")) return "يوجد ناظر لهذا الهدف بالفعل — استبدله بدل إضافة ناظر ثانٍ (يمكنك إضافة مساعدين)";
  if (m.includes("row-level security")) return "ليس لديك صلاحية على هذا الإجراء";
  if (m.includes("duplicate")) return "موجود مسبقاً";
  return m;
}

// الهيكل التنظيمي: مبنى ← طابق ← شعبة، ونظّار حصريون (واحد لكل هدف) مع مساعدين.
// مبدأ الصعود: إن غاب الأدنى يشرف الأعلى (ناظر المرحلة ← الطابق ← الناظر العام)، والأعلى يقدر يعمل بدل الأدنى.
export default function OrgStructurePanel({ accountId, appUser }: { accountId: string; appUser: AppUser }) {
  const [tab, setTab] = useState<"overview" | "places" | "supervisors" | "levels">("overview");
  const [overview, setOverview] = useState<Overview[]>([]);
  const [buildings, setBuildings] = useState<Named[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [classes, setClasses] = useState<(Named & { floor_id: string | null })[]>([]);
  const [stages, setStages] = useState<Named[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [sups, setSups] = useState<Supervision[]>([]);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [levelCaps, setLevelCaps] = useState<{ account_id: string | null; level: Level; capability_key: string }[]>([]);
  const [customized, setCustomized] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [bName, setBName] = useState("");
  const [fName, setFName] = useState("");
  const [fBuilding, setFBuilding] = useState("");
  const [sLevel, setSLevel] = useState<Level>("stage");
  const [sTarget, setSTarget] = useState("");
  const [sUser, setSUser] = useState("");
  const [assistPick, setAssistPick] = useState<Record<string, string>>({});

  async function load() {
    const [ov, b, f, c, st, u, s, a, cp, lc, cz] = await Promise.all([
      supabase.rpc("org_overview"),
      supabase.from("buildings").select("id, name").eq("account_id", accountId).order("order_index"),
      supabase.from("floors").select("id, name, building_id").eq("account_id", accountId).order("order_index"),
      supabase.from("class_sections").select("id, name, floor_id").eq("account_id", accountId).order("name"),
      supabase.from("stages").select("id, stage_name").eq("account_id", accountId).order("order_index"),
      supabase.from("app_users").select("id, full_name, role, is_active").eq("account_id", accountId),
      supabase.from("supervisions").select("*").eq("account_id", accountId),
      supabase.from("supervision_assistants").select("*"),
      supabase.from("capabilities").select("key, label_ar").order("category"),
      supabase.from("supervision_level_capabilities").select("account_id, level, capability_key"),
      supabase.from("supervision_levels_customized").select("level").eq("account_id", accountId),
    ]);
    setOverview((ov.data ?? []) as Overview[]);
    setBuildings((b.data ?? []) as Named[]);
    setFloors((f.data ?? []) as Floor[]);
    setClasses((c.data ?? []) as any);
    setStages((st.data ?? []).map((x: any) => ({ id: x.id, name: x.stage_name })));
    setUsers((u.data ?? []).map((x: any) => ({ id: x.id, name: x.full_name, role: x.role, is_active: x.is_active })));
    setSups((s.data ?? []) as Supervision[]);
    setAssistants((a.data ?? []) as Assistant[]);
    setCaps((cp.data ?? []) as Cap[]);
    setLevelCaps((lc.data ?? []) as any);
    setCustomized(new Set((cz.data ?? []).map((x: any) => x.level)));
  }
  useEffect(() => { load(); }, [accountId]);

  const fail = (m: string) => { setMessage(null); setError(friendly(m)); };
  const ok = (m: string) => { setError(null); setMessage(m); };
  const uname = (id: string | null) => users.find((u) => u.id === id)?.name ?? "—";
  // صفوف النظرة العامة بنصوصها الظاهرة (أسماء لا معرّفات) ليعمل عليها البحث والفلترة
  const overviewRows = useMemo(() => overview.map((o) => ({
    ...o, stage_name: o.stage_name ?? "—", location: [o.building_name, o.floor_name].filter(Boolean).join(" / ") || "—",
    class_sup: o.class_supervisor ? uname(o.class_supervisor) : "غير معيّن",
    authority: o.authority_level ? `${uname(o.authority_user)} (${AUTH_LABEL[o.authority_level] ?? o.authority_level})` : "—",
  })), [overview, users]);
  const overviewTk = useTableKit(overviewRows, OVERVIEW_COLUMNS);
  const classesTk = useTableKit(classes, CLASSES_COLUMNS);
  const eligible = users.filter((u) => u.is_active && u.role !== "solo_teacher" && u.role !== "school_admin");

  const targetOptions: Named[] =
    sLevel === "class" ? classes : sLevel === "floor" ? floors.map((f) => ({ id: f.id, name: `${f.name}${f.building_id ? " — " + (buildings.find((b) => b.id === f.building_id)?.name ?? "") : ""}` }))
    : sLevel === "stage" ? stages : buildings;

  const targetName = (s: Supervision) =>
    s.level === "class" ? classes.find((c) => c.id === s.class_section_id)?.name
    : s.level === "floor" ? floors.find((f) => f.id === s.floor_id)?.name
    : s.level === "stage" ? stages.find((x) => x.id === s.stage_id)?.name
    : buildings.find((b) => b.id === s.building_id)?.name;

  async function addBuilding(e: React.FormEvent) {
    e.preventDefault();
    if (!bName) return;
    const { error: err } = await supabase.from("buildings").insert({ account_id: accountId, name: bName, order_index: buildings.length + 1 });
    if (err) return fail(err.message);
    setBName(""); ok("تمت إضافة المبنى"); load();
  }
  async function addFloor(e: React.FormEvent) {
    e.preventDefault();
    if (!fName) return;
    const { error: err } = await supabase.from("floors").insert({ account_id: accountId, name: fName, building_id: fBuilding || null, order_index: floors.length + 1 });
    if (err) return fail(err.message);
    setFName(""); ok("تمت إضافة الطابق"); load();
  }
  async function moveClass(classId: string, floorId: string) {
    const { data, error: err } = await supabase.rpc("assign_class_floor", { p_class: classId, p_floor: floorId || null });
    if (err) return fail(err.message);
    ok(String(data)); load();
  }
  async function deleteFloor(f: Floor) {
    const { error: err } = await supabase.from("floors").delete().eq("id", f.id);
    if (err) return fail(err.message); ok("تم حذف الطابق"); load();
  }
  async function deleteBuilding(b: Named) {
    const { error: err } = await supabase.from("buildings").delete().eq("id", b.id);
    if (err) return fail(err.message.includes("foreign key") ? "احذف طوابق المبنى أولاً" : err.message);
    ok("تم حذف المبنى"); load();
  }

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    if (!sTarget || !sUser) return fail("اختر الهدف والناظر");
    const { error: err } = await supabase.from("supervisions").insert({
      account_id: accountId, level: sLevel, supervisor_id: sUser, created_by: appUser.id,
      class_section_id: sLevel === "class" ? sTarget : null, floor_id: sLevel === "floor" ? sTarget : null,
      stage_id: sLevel === "stage" ? sTarget : null, building_id: sLevel === "building" ? sTarget : null,
    });
    if (err) return fail(err.message);
    setSTarget(""); setSUser(""); ok("تم التعيين"); load();
  }
  async function replaceSupervisor(s: Supervision, userId: string) {
    const { error: err } = await supabase.from("supervisions").update({ supervisor_id: userId }).eq("id", s.id);
    if (err) return fail(err.message); ok("تم استبدال الناظر"); load();
  }
  async function removeSupervision(s: Supervision) {
    if (!confirm("إلغاء هذا التعيين؟ ستنتقل المسؤولية للأعلى تلقائياً.")) return;
    const { error: err } = await supabase.from("supervisions").delete().eq("id", s.id);
    if (err) return fail(err.message); ok("تم الإلغاء"); load();
  }
  async function addAssistant(s: Supervision) {
    const id = assistPick[s.id];
    if (!id) return;
    const { error: err } = await supabase.from("supervision_assistants").insert({ supervision_id: s.id, assistant_id: id });
    if (err) return fail(err.message);
    setAssistPick((p) => ({ ...p, [s.id]: "" })); ok("تمت إضافة المساعد"); load();
  }
  async function removeAssistant(a: Assistant) {
    const { error: err } = await supabase.from("supervision_assistants").delete().eq("id", a.id);
    if (err) return fail(err.message); ok("تم إزالة المساعد"); load();
  }

  function levelHas(level: Level, key: string) {
    const rows = levelCaps.filter((r) => r.level === level && (customized.has(level) ? r.account_id === accountId : r.account_id === null));
    return rows.some((r) => r.capability_key === key);
  }
  async function toggleLevelCap(level: Level, key: string, granted: boolean) {
    const { error: err } = await supabase.rpc("set_level_capability", { p_level: level, p_key: key, p_granted: granted });
    if (err) return fail(err.message); ok("تم التحديث"); load();
  }

  const tabBtn = (id: typeof tab, label: string) => (
    <button onClick={() => setTab(id)} className="btn"
      style={{ background: tab === id ? "var(--indigo)" : "white", color: tab === id ? "white" : "var(--steel)", border: "1.5px solid var(--fog-dark)", padding: "8px 18px" }}>{label}</button>
  );

  return (
    <div className="fade-in">
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginBottom: 12 }}>
        لكل صف/طابق/مرحلة/مبنى ناظر واحد فقط (والمساعدون بلا حد). إذا غاب الأدنى تنتقل المسؤولية تلقائياً للأعلى: ناظر الصف ← المرحلة ← الطابق ← الناظر العام.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {tabBtn("overview", "النظرة العامة")}{tabBtn("places", "المباني والطوابق")}{tabBtn("supervisors", "النظّار والمساعدون")}{tabBtn("levels", "صلاحيات المستويات")}
      </div>
      {error && <p style={{ color: "var(--red)", fontSize: "0.85rem", marginBottom: 10 }}>{error}</p>}
      {message && <p style={{ color: "var(--green)", fontSize: "0.85rem", marginBottom: 10 }}>{message}</p>}

      {tab === "overview" && overviewTk.toolbar}
      {tab === "overview" && (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>الشعبة</th><th>المرحلة</th><th>الموقع</th><th>ناظر الصف</th><th>المسؤول فعلياً</th><th>مساعدون</th><th>مواد بلا أستاذ</th></tr></thead>
            <tbody>
              {overviewTk.rows.map((o) => (
                <tr key={o.class_id}>
                  <td style={{ fontWeight: 700 }}>{o.class_name}</td>
                  <td>{o.stage_name}</td>
                  <td>{o.location}</td>
                  <td>{o.class_supervisor ? o.class_sup : <span style={{ color: "var(--red)" }}>غير معيّن</span>}</td>
                  <td>{o.authority}</td>
                  <td>{o.assistants_count}</td>
                  <td style={{ color: o.subjects_without_teacher > 0 ? "var(--red)" : undefined, fontWeight: 700 }}>{o.subjects_without_teacher}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {overview.length === 0 && <p style={{ color: "var(--steel)", padding: 12 }}>لا توجد شعب بعد.</p>}
        </div>
      )}

      {tab === "places" && (
        <>
          <p style={{ fontSize: "0.8rem", color: "var(--steel)", marginBottom: 10 }}>المباني والطوابق اختيارية: المدرسة ذات المبنى الواحد تكتفي بالطوابق أو بلا شيء.</p>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
            <form onSubmit={addBuilding} className="card" style={{ padding: "1rem", flex: 1, minWidth: 260 }}>
              <label style={lbl}>مبنى جديد</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" value={bName} onChange={(e) => setBName(e.target.value)} placeholder="مثلاً: المبنى الشرقي" />
                <button className="btn btn-gold" type="submit">إضافة</button>
              </div>
              {buildings.map((b) => (
                <div key={b.id} style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: "0.9rem" }}>
                  <span>{b.name}</span>
                  <button type="button" onClick={() => deleteBuilding(b)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}><Trash2 size={15} /></button>
                </div>
              ))}
            </form>
            <form onSubmit={addFloor} className="card" style={{ padding: "1rem", flex: 1, minWidth: 260 }}>
              <label style={lbl}>طابق جديد</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input className="input" style={{ maxWidth: 150 }} value={fName} onChange={(e) => setFName(e.target.value)} placeholder="الطابق الأول" />
                <select className="input" style={{ maxWidth: 160 }} value={fBuilding} onChange={(e) => setFBuilding(e.target.value)}>
                  <option value="">— بلا مبنى —</option>{buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <button className="btn btn-gold" type="submit">إضافة</button>
              </div>
              {floors.map((f) => (
                <div key={f.id} style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: "0.9rem" }}>
                  <span>{f.name}{f.building_id ? ` — ${buildings.find((b) => b.id === f.building_id)?.name ?? ""}` : ""}</span>
                  <button type="button" onClick={() => deleteFloor(f)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}><Trash2 size={15} /></button>
                </div>
              ))}
            </form>
          </div>
          {classesTk.toolbar}
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead><tr><th>الشعبة</th><th>الطابق</th></tr></thead>
              <tbody>
                {classesTk.rows.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 700 }}>{c.name}</td>
                    <td>
                      <select className="input" style={{ maxWidth: 260 }} value={c.floor_id ?? ""} onChange={(e) => moveClass(c.id, e.target.value)}>
                        <option value="">— بلا طابق —</option>
                        {floors.map((f) => <option key={f.id} value={f.id}>{f.name}{f.building_id ? ` — ${buildings.find((b) => b.id === f.building_id)?.name ?? ""}` : ""}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "supervisors" && (
        <>
          <form onSubmit={assign} className="card" style={{ padding: "1.1rem", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div><label style={lbl}>المستوى</label>
              <select className="input" value={sLevel} onChange={(e) => { setSLevel(e.target.value as Level); setSTarget(""); }}>
                {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select></div>
            <div><label style={lbl}>الهدف</label>
              <select className="input" value={sTarget} onChange={(e) => setSTarget(e.target.value)}>
                <option value="">— اختر —</option>{targetOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select></div>
            <div><label style={lbl}>الناظر</label>
              <select className="input" value={sUser} onChange={(e) => setSUser(e.target.value)}>
                <option value="">— اختر —</option>{eligible.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select></div>
            <button className="btn btn-gold" type="submit">تعيين</button>
            <span style={{ fontSize: "0.78rem", color: "var(--steel)", width: "100%" }}>{LEVELS.find((l) => l.id === sLevel)?.hint}</span>
          </form>

          {LEVELS.map((lv) => {
            const list = sups.filter((s) => s.level === lv.id);
            return (
              <div key={lv.id} style={{ marginBottom: 14 }}>
                <strong style={{ color: "var(--indigo)" }}>{lv.label}</strong>
                {list.length === 0 && <span style={{ fontSize: "0.85rem", color: "var(--steel)", marginInlineStart: 8 }}>لا يوجد — تعود المسؤولية للأعلى</span>}
                {list.map((s) => (
                  <div key={s.id} className="card" style={{ padding: "0.8rem 1rem", marginTop: 8 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700 }}>{targetName(s) ?? "—"}</span>
                      <select className="input" style={{ maxWidth: 200 }} value={s.supervisor_id} onChange={(e) => replaceSupervisor(s, e.target.value)}>
                        {eligible.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        {!eligible.some((u) => u.id === s.supervisor_id) && <option value={s.supervisor_id}>{uname(s.supervisor_id)}</option>}
                      </select>
                      <button onClick={() => removeSupervision(s)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}><Trash2 size={15} /></button>
                    </div>
                    <div style={{ marginTop: 8, fontSize: "0.85rem" }}>
                      <span style={{ color: "var(--steel)" }}>المساعدون: </span>
                      {assistants.filter((a) => a.supervision_id === s.id).map((a) => (
                        <span key={a.id} style={{ marginInlineEnd: 10 }}>
                          {uname(a.assistant_id)}
                          <button onClick={() => removeAssistant(a)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}>×</button>
                        </span>
                      ))}
                      <select className="input" style={{ maxWidth: 170, display: "inline-block", marginInlineEnd: 6 }} value={assistPick[s.id] ?? ""}
                        onChange={(e) => setAssistPick((p) => ({ ...p, [s.id]: e.target.value }))}>
                        <option value="">+ مساعد</option>
                        {eligible.filter((u) => u.id !== s.supervisor_id && !assistants.some((a) => a.supervision_id === s.id && a.assistant_id === u.id))
                          .map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                      {assistPick[s.id] && <button className="btn btn-secondary" style={{ padding: "4px 12px", fontSize: "0.8rem" }} onClick={() => addAssistant(s)}>إضافة</button>}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </>
      )}

      {tab === "levels" && (
        <>
          <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginBottom: 12 }}>
            ماذا يملك كل مستوى ضمن نطاقه؟ الافتراضيات مناسبة لمعظم المدارس، وأي تعديل يخص مدرستك فقط. ناظر المبنى محصور بإدارة المبنى.
          </p>
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead><tr><th>الصلاحية</th>{LEVELS.map((l) => <th key={l.id}>{l.label}</th>)}</tr></thead>
              <tbody>
                {caps.map((c) => (
                  <tr key={c.key}>
                    <td style={{ fontSize: "0.82rem" }}>{c.label_ar}</td>
                    {LEVELS.map((l) => {
                      const has = levelHas(l.id, c.key);
                      const locked = l.id === "building" && c.key !== "building.manage";
                      return (
                        <td key={l.id} style={{ textAlign: "center" }}>
                          <input type="checkbox" checked={has} disabled={locked} onChange={(e) => toggleLevelCap(l.id, c.key, e.target.checked)} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
