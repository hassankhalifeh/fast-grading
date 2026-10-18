"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Bell, CheckCheck, X } from "lucide-react";

interface Item { id: string; kind: string; title: string; body: string | null; section: string | null; created_at: string; read_at: string | null }

const POLL_MS = 60_000;

// جرس الإشعارات: صندوق وارد شخصي (app_notifications) تكتبه التريغرات ويقرؤه صاحبه فقط.
// يُحدَّث كل دقيقة وعند عودة التبويب للواجهة. النقر على إشعار يعلّمه مقروءاً ويفتح القسم المرتبط به.
export default function NotificationBell({ onNavigate, placement = "nav" }: { onNavigate: (section: string) => void; placement?: "nav" | "bar" }) {
  // نسخة واحدة فقط تعمل في كل وضع: الشريط الجانبي على الحاسوب، والشريط العلوي على الجوال (فلا استعلام مكرَّر)
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const active = placement === "bar" ? mobile : !mobile;
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("app_notifications")
      .select("id, kind, title, body, section, created_at, read_at").order("created_at", { ascending: false }).limit(40);
    if (error) { setFailed(true); return; }   // مثلاً قبل تطبيق الترحيل 55: نُخفي الجرس بصمت
    setFailed(false);
    setItems((data ?? []) as Item[]);
  }, []);

  useEffect(() => {
    if (!active) return;
    load();
    const timer = setInterval(load, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (failed || !active) return null;
  const unread = items.filter((i) => !i.read_at).length;

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setItems((cur) => cur.map((i) => (ids.includes(i.id) ? { ...i, read_at: now } : i)));
    await supabase.from("app_notifications").update({ read_at: now }).in("id", ids);
  }
  async function dismiss(id: string) {
    setItems((cur) => cur.filter((i) => i.id !== id));
    await supabase.from("app_notifications").delete().eq("id", id);
  }
  function openItem(i: Item) {
    markRead([i.id]);
    if (i.section) { setOpen(false); onNavigate(i.section); }
  }

  return (
    <div ref={boxRef} style={{ marginInlineStart: "auto", position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={unread ? `الإشعارات (${unread} غير مقروء)` : "الإشعارات"} title="الإشعارات"
        style={{ position: "relative", background: "rgba(255,255,255,0.12)", border: "none", borderRadius: 9, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        <Bell size={17} color="white" />
        {unread > 0 && (
          <span style={{ position: "absolute", top: -4, insetInlineEnd: -4, minWidth: 17, height: 17, padding: "0 4px", borderRadius: 9, background: "var(--red)", color: "white", fontSize: "0.68rem", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="card" style={placement === "bar"
          ? { position: "fixed", top: 58, left: 8, right: 8, maxHeight: "70vh", overflowY: "auto", zIndex: 70, padding: 0, boxShadow: "0 12px 32px rgba(0,0,0,0.18)" }
          : { position: "fixed", top: 58, right: 248, width: 360, maxWidth: "calc(100vw - 270px)", maxHeight: "70vh", overflowY: "auto", zIndex: 50, padding: 0, boxShadow: "0 12px 32px rgba(0,0,0,0.18)" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--fog)", position: "sticky", top: 0, background: "var(--white, #fff)" }}>
            <strong style={{ color: "var(--indigo)", fontSize: "0.95rem" }}>الإشعارات</strong>
            {unread > 0 && (
              <button type="button" onClick={() => markRead(items.filter((i) => !i.read_at).map((i) => i.id))} className="btn btn-secondary"
                style={{ marginInlineStart: "auto", fontSize: "0.72rem", padding: "3px 10px", display: "flex", alignItems: "center", gap: 4 }}>
                <CheckCheck size={13} /> تعليم الكل كمقروء
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p style={{ margin: 0, padding: "18px 14px", color: "var(--steel)", fontSize: "0.88rem" }}>لا إشعارات بعد.</p>
          ) : items.map((i) => (
            <div key={i.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--fog)", background: i.read_at ? "transparent" : "rgba(212,175,55,0.10)" }}>
              <button type="button" onClick={() => openItem(i)} style={{ flex: 1, textAlign: "start", background: "none", border: "none", padding: 0, cursor: i.section ? "pointer" : "default", font: "inherit", color: "inherit" }}>
                <div style={{ fontWeight: i.read_at ? 600 : 800, fontSize: "0.88rem" }}>{i.title}</div>
                {i.body && <div style={{ fontSize: "0.8rem", color: "var(--steel)", marginTop: 2 }}>{i.body}</div>}
                <div style={{ fontSize: "0.7rem", color: "var(--steel-light)", marginTop: 3 }}>{new Date(i.created_at).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" })}</div>
              </button>
              <button type="button" onClick={() => dismiss(i.id)} aria-label="حذف الإشعار" title="حذف" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--steel)", padding: 2 }}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
