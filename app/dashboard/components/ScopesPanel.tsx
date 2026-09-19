"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser, ScopeGroup, ScopeGroupMember, UserScopedCapability } from "@/lib/types";
import { Trash2 } from "lucide-react";

interface Named { id: string; name: string }
interface Cap { key: string; label_ar: string }

const KINDS = [
  { value: "stage", label: "مرحلة" },
  { value: "floor", label: "طابق" },
  { value: "department", label: "قسم" },
  { value: "custom", label: "مخصص" },
];

const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;

function CheckList({ title, items, selected, onToggle }: { title: string; items: Named[]; selected: Set<string>; onToggle: (id: string) => void }) {
  return (
    <div style={{ minWidth: 170 }}>
      <label style={lbl}>{title}</label>
      {items.length === 0 && <span style={{ fontSize: "0.8rem", color: "var(--steel)" }}>لا يوجد</span>}
      {items.map((i) => (
        <label key={i.id} style={{ display: "flex", gap: 6, fontSize: "0.85rem", marginBottom: 3 }}>
          <input type="checkbox" checked={selected.has(i.id)} onChange={() => onToggle(i.id)} /> {i.name}
        </label>
      ))}
    </div>
  );
}

// نطاقات الصلاحيات: مجموعة = (مراحل / صفوف / مواد). صلاحية مقيّدة بمجموعة بتنطبق ضمنها فقط.
// مجموعة فيها مراحل/صفوف ومواد معاً = بتغطي التقاطع (مثلاً رياضيات بالمرحلة المتوسطة).
export default function ScopesPanel({ accountId, appUser }: { accountId: string; appUser: AppUser }) {
  const [groups, setGroups] = useState<ScopeGroup[]>([]);
  const [members, setMembers] = useState<ScopeGroupMember[]>([]);
  const [assignments, setAssignments] = useState<UserScopedCapability[]>([]);
  const [users, setUsers] = useState<Named[]>([]);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [stages, setStages] = useState<Named[]>([]);
  const [classes, setClasses] = useState<Named[]>([]);
  const [subjects, setSubjects] = useState<Named[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [gName, setGName] = useState("");
  const [gKind, setGKind] = useState("stage");
  const [selStages, setSelStages] = useState<Set<string>>(new Set());
  const [selClasses, setSelClasses] = useState<Set<string>>(new Set());
  const [selSubjects, setSelSubjects] = useState<Set<string>>(new Set());

  const [aUser, setAUser] = useState("");
  const [aCap, setACap] = useState("");
  const [aGroup, setAGroup] = useState("");

  async function load() {
    const [g, m, a, u, c, st, cl, su] = await Promise.all([
      supabase.from("scope_groups").select("*").eq("account_id", accountId).order("created_at"),
      supabase.from("scope_group_members").select("*"),
      supabase.from("user_scoped_capabilities").select("*"),
      supabase.from("app_users").select("id, full_name").eq("account_id", accountId),
      supabase.from("capabilities").select("key, label_ar").order("category"),
      supabase.from("stages").select("id, stage_name").eq("account_id", accountId).order("order_index"),
      supabase.from("class_sections").select("id, name").eq("account_id", accountId),
      supabase.from("subjects").select("id, name").eq("account_id", accountId),
    ]);
    setGroups((g.data ?? []) as ScopeGroup[]);
    setMembers((m.data ?? []) as ScopeGroupMember[]);
    setAssignments((a.data ?? []) as UserScopedCapability[]);
    setUsers((u.data ?? []).map((x: any) => ({ id: x.id, name: x.full_name })));
    setCaps((c.data ?? []) as Cap[]);
    setStages((st.data ?? []).map((x: any) => ({ id: x.id, name: x.stage_name })));
    setClasses((cl.data ?? []) as Named[]);
    setSubjects((su.data ?? []) as Named[]);
  }
  useEffect(() => { load(); }, [accountId]);

  function fail(m: string) { setMessage(null); setError(m.includes("row-level security") ? "ليس لديك صلاحية إدارة المستخدمين (users.manage)" : m.includes("duplicate") ? "هاي الصلاحية معطاة أصلاً لنفس المجموعة" : m); }
  function ok(m: string) { setError(null); setMessage(m); }

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!gName) return fail("اكتب اسم المجموعة");
    if (selStages.size + selClasses.size + selSubjects.size === 0) return fail("اختر مرحلة أو صفاً أو مادة على الأقل");
    const { data: grp, error: err } = await supabase.from("scope_groups").insert({ account_id: accountId, name: gName, kind: gKind }).select().single();
    if (err || !grp) return fail(err?.message ?? "تعذر الإنشاء");
    const rows = [
      ...[...selStages].map((id) => ({ group_id: grp.id, member_type: "stage", stage_id: id })),
      ...[...selClasses].map((id) => ({ group_id: grp.id, member_type: "class", class_section_id: id })),
      ...[...selSubjects].map((id) => ({ group_id: grp.id, member_type: "subject", subject_id: id })),
    ];
    const { error: mErr } = await supabase.from("scope_group_members").insert(rows);
    if (mErr) return fail(mErr.message);
    setGName(""); setSelStages(new Set()); setSelClasses(new Set()); setSelSubjects(new Set());
    ok("تم إنشاء المجموعة");
    load();
  }

  async function deleteGroup(g: ScopeGroup) {
    if (!confirm(`حذف المجموعة "${g.name}" وكل الصلاحيات المرتبطة بها؟`)) return;
    const { error: err } = await supabase.from("scope_groups").delete().eq("id", g.id);
    if (err) return fail(err.message);
    ok("تم الحذف");
    load();
  }

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    if (!aUser || !aCap || !aGroup) return fail("اختر المستخدم والصلاحية والمجموعة");
    const { error: err } = await supabase.from("user_scoped_capabilities").insert({
      app_user_id: aUser, capability_key: aCap, group_id: aGroup, granted_by: appUser.id,
    });
    if (err) return fail(err.message);
    ok("تم منح الصلاحية ضمن النطاق");
    load();
  }

  async function revoke(a: UserScopedCapability) {
    const { error: err } = await supabase.from("user_scoped_capabilities").delete().eq("id", a.id);
    if (err) return fail(err.message);
    ok("تم السحب");
    load();
  }

  const nm = (list: Named[], id: string | null) => list.find((x) => x.id === id)?.name ?? "—";
  const describe = (g: ScopeGroup) => {
    const ms = members.filter((m) => m.group_id === g.id);
    const part = (t: string, list: Named[], key: "stage_id" | "class_section_id" | "subject_id") =>
      ms.filter((m) => m.member_type === t).map((m) => nm(list, m[key])).join("، ");
    return [
      part("stage", stages, "stage_id") && `مراحل: ${part("stage", stages, "stage_id")}`,
      part("class", classes, "class_section_id") && `صفوف: ${part("class", classes, "class_section_id")}`,
      part("subject", subjects, "subject_id") && `مواد: ${part("subject", subjects, "subject_id")}`,
    ].filter(Boolean).join(" — ");
  };

  return (
    <div className="fade-in" style={{ marginTop: 28 }}>
      <h3 style={{ color: "var(--indigo)", fontSize: "1.05rem", margin: "0 0 4px" }}>الأدوار حسب النطاق (ناظر مرحلة / طابق / قسم ...)</h3>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginBottom: 12 }}>
        أنشئ مجموعة (مثلاً "ناظر المتوسطة" أو "قسم الرياضيات") ثم امنح المستخدم صلاحيات ضمنها فقط. إذا جمعت مراحل/صفوفاً مع مواد بنفس المجموعة فالنطاق هو التقاطع بينها.
        الصلاحية العامة (لكل المدرسة) بتُمنح من المصفوفة أعلاه.
      </p>
      {error && <p style={{ color: "var(--red)", fontSize: "0.85rem", marginBottom: 10 }}>{error}</p>}
      {message && <p style={{ color: "var(--green)", fontSize: "0.85rem", marginBottom: 10 }}>{message}</p>}

      <form onSubmit={createGroup} className="card" style={{ padding: "1.1rem", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div><label style={lbl}>اسم المجموعة</label><input className="input" value={gName} placeholder="ناظر المرحلة المتوسطة" onChange={(e) => setGName(e.target.value)} /></div>
          <div><label style={lbl}>النوع</label>
            <select className="input" value={gKind} onChange={(e) => setGKind(e.target.value)}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select></div>
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
          <CheckList title="المراحل" items={stages} selected={selStages} onToggle={(id) => toggle(selStages, setSelStages, id)} />
          <CheckList title="الصفوف" items={classes} selected={selClasses} onToggle={(id) => toggle(selClasses, setSelClasses, id)} />
          <CheckList title="المواد" items={subjects} selected={selSubjects} onToggle={(id) => toggle(selSubjects, setSelSubjects, id)} />
        </div>
        <button type="submit" className="btn btn-gold">إنشاء المجموعة</button>
      </form>

      {groups.map((g) => (
        <div key={g.id} className="card" style={{ padding: "0.9rem 1.1rem", marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>{g.name}</strong> <span style={{ fontSize: "0.75rem", color: "var(--steel)" }}>({KINDS.find((k) => k.value === g.kind)?.label ?? g.kind})</span>
              <div style={{ fontSize: "0.8rem", color: "var(--steel)" }}>{describe(g)}</div>
            </div>
            <button onClick={() => deleteGroup(g)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}><Trash2 size={16} /></button>
          </div>
          {assignments.filter((a) => a.group_id === g.id).map((a) => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "5px 0", borderTop: "1px solid var(--fog)", marginTop: 6 }}>
              <span>{nm(users, a.app_user_id)} — {caps.find((c) => c.key === a.capability_key)?.label_ar ?? a.capability_key}</span>
              <button onClick={() => revoke(a)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)", fontSize: "0.8rem" }}>سحب</button>
            </div>
          ))}
        </div>
      ))}

      {groups.length > 0 && (
        <form onSubmit={assign} className="card" style={{ padding: "1.1rem", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label style={lbl}>المستخدم</label>
            <select className="input" value={aUser} onChange={(e) => setAUser(e.target.value)}><option value="">— اختر —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
          <div><label style={lbl}>الصلاحية</label>
            <select className="input" value={aCap} onChange={(e) => setACap(e.target.value)}><option value="">— اختر —</option>
              {caps.map((c) => <option key={c.key} value={c.key}>{c.label_ar}</option>)}</select></div>
          <div><label style={lbl}>ضمن المجموعة</label>
            <select className="input" value={aGroup} onChange={(e) => setAGroup(e.target.value)}><option value="">— اختر —</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
          <button type="submit" className="btn btn-gold">منح</button>
        </form>
      )}
    </div>
  );
}
