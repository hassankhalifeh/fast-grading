"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser } from "@/lib/types";
import { Trash2 } from "lucide-react";

interface Named { id: string; name: string }
interface Assignment { id: string; class_section_id: string; subject_id: string; teacher_id: string; assignment_role: "primary" | "secondary" }
interface Request {
  id: string; class_section_id: string; subject_id: string; teacher_id: string; requested_by: string;
  reason: string; status: "pending" | "approved" | "rejected"; decision_note: string | null; created_at: string;
}

const ROLE_LABEL: Record<string, string> = {
  solo_teacher: "معلم مستقل", school_admin: "الناظر العام", assistant_admin: "مساعد ناظر",
  subject_teacher: "معلم مادة", custom_role: "دور مخصص",
};

function friendly(msg: string) {
  if (msg.includes("class_subject_teachers_one_primary") || msg.includes("unique")) return "يوجد أستاذ أساسي لهذه المادة والشعبة — لا يجوز أستاذان متطابقان إلا بموافقة الناظر العام (اطلب أستاذاً ثانياً)";
  if (msg.includes("row-level security")) return "ليس لديك صلاحية على هذا الإجراء";
  return msg;
}

// قاعدة الحصرية: أستاذ أساسي واحد لكل (شعبة، مادة). الأستاذ الثاني لا يُضاف إلا بطلب يوافق عليه الناظر العام.
export default function TeacherAssignmentsPanel({ accountId, appUser, canApprove }: { accountId: string; appUser: AppUser; canApprove: boolean }) {
  const [classes, setClasses] = useState<Named[]>([]);
  const [subjects, setSubjects] = useState<Named[]>([]);
  const [users, setUsers] = useState<(Named & { role: string })[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [classId, setClassId] = useState("");
  const [openReq, setOpenReq] = useState<string | null>(null);
  const [reqTeacher, setReqTeacher] = useState("");
  const [reqReason, setReqReason] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [c, s, u, a, r] = await Promise.all([
      supabase.from("class_sections").select("id, name").eq("account_id", accountId).order("name"),
      supabase.from("subjects").select("id, name").eq("account_id", accountId).order("name"),
      supabase.from("app_users").select("id, full_name, role").eq("account_id", accountId).eq("is_active", true),
      supabase.from("class_subject_teachers").select("id, class_section_id, subject_id, teacher_id, assignment_role"),
      supabase.from("teaching_assignment_requests").select("*").eq("account_id", accountId).order("created_at", { ascending: false }),
    ]);
    const cl = (c.data ?? []) as Named[];
    setClasses(cl);
    setSubjects((s.data ?? []) as Named[]);
    setUsers((u.data ?? []).map((x: any) => ({ id: x.id, name: x.full_name, role: x.role })));
    setAssignments((a.data ?? []) as Assignment[]);
    setRequests((r.data ?? []) as Request[]);
    setClassId((cur) => cur || cl[0]?.id || "");
  }
  useEffect(() => { load(); }, [accountId]);

  const fail = (m: string) => { setMessage(null); setError(friendly(m)); };
  const ok = (m: string) => { setError(null); setMessage(m); };
  const uname = (id: string) => users.find((u) => u.id === id)?.name ?? "—";
  const sname = (id: string) => subjects.find((s) => s.id === id)?.name ?? "—";
  const cname = (id: string) => classes.find((c) => c.id === id)?.name ?? "—";

  async function setPrimary(subjectId: string, teacherId: string) {
    const existing = assignments.find((a) => a.class_section_id === classId && a.subject_id === subjectId && a.assignment_role === "primary");
    if (!teacherId) {
      if (!existing) return;
      if (assignments.some((a) => a.class_section_id === classId && a.subject_id === subjectId && a.assignment_role === "secondary"))
        return fail("احذف الأستاذ الثاني أولاً قبل إزالة الأستاذ الأساسي");
      const { error: err } = await supabase.from("class_subject_teachers").delete().eq("id", existing.id);
      if (err) return fail(err.message);
    } else if (existing) {
      const { error: err } = await supabase.from("class_subject_teachers").update({ teacher_id: teacherId }).eq("id", existing.id);
      if (err) return fail(err.message);
    } else {
      const { error: err } = await supabase.from("class_subject_teachers").insert({ class_section_id: classId, subject_id: subjectId, teacher_id: teacherId });
      if (err) return fail(err.message);
    }
    ok("تم الحفظ");
    load();
  }

  async function removeSecondary(a: Assignment) {
    const { error: err } = await supabase.from("class_subject_teachers").delete().eq("id", a.id);
    if (err) return fail(err.message);
    ok("تم حذف الأستاذ الثاني");
    load();
  }

  async function submitRequest(subjectId: string) {
    if (!reqTeacher || !reqReason) return fail("اختر الأستاذ واكتب سبب الطلب");
    const { error: err } = await supabase.from("teaching_assignment_requests").insert({
      account_id: accountId, class_section_id: classId, subject_id: subjectId, teacher_id: reqTeacher,
      requested_by: appUser.id, reason: reqReason,
    });
    if (err) return fail(err.message.includes("unique") ? "يوجد طلب معلّق لنفس الأستاذ والمادة والشعبة" : err.message);
    setOpenReq(null); setReqTeacher(""); setReqReason("");
    ok("أُرسل الطلب للناظر العام");
    load();
  }

  async function decide(req: Request, approve: boolean) {
    const { data, error: err } = await supabase.rpc("decide_teaching_request", { p_request: req.id, p_approve: approve, p_note: notes[req.id] || null });
    if (err) return fail(err.message);
    ok(String(data));
    load();
  }

  const pending = requests.filter((r) => r.status === "pending");

  return (
    <div className="fade-in">
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginBottom: 12 }}>
        لكل مادة في الشعبة أستاذ أساسي واحد فقط. لإضافة أستاذ ثانٍ لنفس المادة والشعبة قدّم طلباً يوافق عليه الناظر العام.
      </p>
      {error && <p style={{ color: "var(--red)", fontSize: "0.85rem", marginBottom: 10 }}>{error}</p>}
      {message && <p style={{ color: "var(--green)", fontSize: "0.85rem", marginBottom: 10 }}>{message}</p>}

      {pending.length > 0 && (
        <div className="card" style={{ padding: "1rem", marginBottom: 16, background: "#FBF3E3" }}>
          <strong style={{ color: "var(--gold-dark)" }}>طلبات بانتظار الموافقة ({pending.length})</strong>
          {pending.map((r) => (
            <div key={r.id} style={{ borderTop: "1px solid var(--fog)", marginTop: 8, paddingTop: 8, fontSize: "0.85rem" }}>
              <div>{uname(r.teacher_id)} — {sname(r.subject_id)} — {cname(r.class_section_id)}</div>
              <div style={{ color: "var(--steel)" }}>السبب: {r.reason} (طلب: {uname(r.requested_by)})</div>
              {canApprove ? (
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <input className="input" style={{ maxWidth: 220 }} placeholder="ملاحظة القرار (اختياري)" value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((s) => ({ ...s, [r.id]: e.target.value }))} />
                  <button className="btn btn-gold" style={{ padding: "6px 14px" }} onClick={() => decide(r, true)}>موافقة</button>
                  <button className="btn btn-secondary" style={{ padding: "6px 14px" }} onClick={() => decide(r, false)}>رفض</button>
                </div>
              ) : <div style={{ color: "var(--steel)", marginTop: 4 }}>القرار للناظر العام</div>}
            </div>
          ))}
        </div>
      )}

      {classes.length === 0 ? <p style={{ color: "var(--steel)" }}>أضف صفاً من قسم "الصفوف" أولاً.</p> : (
        <>
          <select className="input" style={{ maxWidth: 280, marginBottom: 14 }} value={classId} onChange={(e) => setClassId(e.target.value)}>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {subjects.length === 0 && <p style={{ color: "var(--steel)" }}>أضف مواد من قسم "المواد" أولاً.</p>}
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead><tr><th>المادة</th><th>الأستاذ الأساسي</th><th>الأستاذ الثاني (بموافقة)</th></tr></thead>
              <tbody>
                {subjects.map((s) => {
                  const primary = assignments.find((a) => a.class_section_id === classId && a.subject_id === s.id && a.assignment_role === "primary");
                  const seconds = assignments.filter((a) => a.class_section_id === classId && a.subject_id === s.id && a.assignment_role === "secondary");
                  return (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 700 }}>{s.name}</td>
                      <td>
                        <select className="input" style={{ maxWidth: 240, borderColor: primary ? undefined : "var(--red)" }}
                          value={primary?.teacher_id ?? ""} onChange={(e) => setPrimary(s.id, e.target.value)}>
                          <option value="">— بلا أستاذ —</option>
                          {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({ROLE_LABEL[u.role] ?? u.role})</option>)}
                        </select>
                      </td>
                      <td>
                        {seconds.map((a) => (
                          <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                            <span>{uname(a.teacher_id)}</span>
                            <button onClick={() => removeSecondary(a)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}><Trash2 size={14} /></button>
                          </div>
                        ))}
                        {primary && openReq !== s.id && (
                          <button className="btn btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 10px" }}
                            onClick={() => { setOpenReq(s.id); setReqTeacher(""); setReqReason(""); }}>طلب أستاذ ثانٍ</button>
                        )}
                        {openReq === s.id && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                            <select className="input" style={{ maxWidth: 170 }} value={reqTeacher} onChange={(e) => setReqTeacher(e.target.value)}>
                              <option value="">— الأستاذ —</option>
                              {users.filter((u) => u.id !== primary?.teacher_id && !seconds.some((x) => x.teacher_id === u.id))
                                .map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                            <input className="input" style={{ maxWidth: 200 }} placeholder="السبب" value={reqReason} onChange={(e) => setReqReason(e.target.value)} />
                            <button className="btn btn-gold" style={{ padding: "5px 12px" }} onClick={() => submitRequest(s.id)}>إرسال</button>
                            <button className="btn btn-secondary" style={{ padding: "5px 12px" }} onClick={() => setOpenReq(null)}>إلغاء</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
