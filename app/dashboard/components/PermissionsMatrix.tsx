"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser, Capability } from "@/lib/types";
import { Check } from "lucide-react";

// The literal implementation of "كافة الصلاحيات قابلة للتعيين والتوقيف
// بموجب لوحة تحكم" — every checkbox here is a direct write to
// user_capabilities. RLS still enforces who's actually allowed to
// enforce anything; this screen is what an admin uses to change it.
export default function PermissionsMatrix({ accountId }: { accountId: string }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [grants, setGrants] = useState<Record<string, Set<string>>>({});

  async function load() {
    const [{ data: userRows }, { data: capRows }] = await Promise.all([
      supabase.from("app_users").select("*").eq("account_id", accountId),
      supabase.from("capabilities").select("*"),
    ]);
    setUsers(userRows ?? []);
    setCapabilities(capRows ?? []);

    if (userRows && userRows.length > 0) {
      const { data: grantRows } = await supabase
        .from("user_capabilities")
        .select("app_user_id, capability_key, granted")
        .in("app_user_id", userRows.map((u) => u.id));

      const map: Record<string, Set<string>> = {};
      (grantRows ?? []).forEach((g) => {
        if (!g.granted) return;
        if (!map[g.app_user_id]) map[g.app_user_id] = new Set();
        map[g.app_user_id].add(g.capability_key);
      });
      setGrants(map);
    }
  }

  useEffect(() => { load(); }, [accountId]);

  async function toggle(userId: string, capabilityKey: string, currentlyGranted: boolean) {
    // Optimistic UI update, then reconcile with the database.
    setGrants((g) => {
      const next = { ...g, [userId]: new Set(g[userId] ?? []) };
      if (currentlyGranted) next[userId].delete(capabilityKey);
      else next[userId].add(capabilityKey);
      return next;
    });

    if (currentlyGranted) {
      await supabase.from("user_capabilities").delete()
        .eq("app_user_id", userId).eq("capability_key", capabilityKey);
    } else {
      await supabase.from("user_capabilities")
        .upsert({ app_user_id: userId, capability_key: capabilityKey, granted: true }, { onConflict: "app_user_id,capability_key" });
    }
  }

  if (users.length === 0) return <p style={{ color: "var(--steel)" }}>لا يوجد مستخدمون بعد.</p>;

  const categories = Array.from(new Set(capabilities.map((c) => c.category)));

  return (
    <div className="card fade-in" style={{ overflowX: "auto", padding: "0.5rem" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>المستخدم</th>
            {categories.map((cat) => (
              capabilities.filter((c) => c.category === cat).map((c) => (
                <th key={c.key} style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>{c.label_ar}</th>
              ))
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td style={{ fontWeight: 700 }}>{u.full_name}<br /><span style={{ fontSize: "0.75rem", color: "var(--steel)" }}>{u.role}</span></td>
              {capabilities.map((c) => {
                const granted = grants[u.id]?.has(c.key) ?? false;
                return (
                  <td key={c.key} style={{ textAlign: "center" }}>
                    <button
                      onClick={() => toggle(u.id, c.key, granted)}
                      style={{
                        width: 26, height: 26, borderRadius: 7, border: "1.5px solid var(--fog-dark)",
                        background: granted ? "var(--green)" : "white", cursor: "pointer",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}
                      title={c.label_ar}
                    >
                      {granted && <Check size={15} color="white" />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
