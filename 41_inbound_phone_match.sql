-- 41: مطابقة رقم المرسِل الوارد مع هاتف ولي الأمر رغم اختلاف الصيغة (03123456 محلي مقابل 9613123456 دولي)
create or replace function public.wa_log_inbound(
  p_account uuid, p_our_phone_id text, p_our_display text, p_contact text, p_wa_id text, p_type text, p_body text, p_at timestamptz
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sid uuid; v_name text; v_n int; v_contact text := regexp_replace(p_contact, '\D', '', 'g');
begin
  -- الهاتف المحلي بعد حذف الأصفار البادئة يجب أن يكون لاحقة لرقم المرسِل الدولي (7 أرقام على الأقل)
  select count(*), min(s.id::text)::uuid, min(s.full_name) into v_n, v_sid, v_name
  from public.students s
  where s.account_id = p_account and s.parent_phone is not null
    and length(ltrim(regexp_replace(s.parent_phone, '\D', '', 'g'), '0')) >= 7
    and v_contact like '%' || ltrim(regexp_replace(s.parent_phone, '\D', '', 'g'), '0');
  if v_n <> 1 then v_sid := null; v_name := null; end if;

  insert into public.whatsapp_messages (
    account_id, direction, channel_mode, our_phone_number_id, our_display_phone, contact_phone, student_id, student_name,
    msg_type, body, wa_message_id, status, occurred_at
  ) values (p_account, 'in', 'inbound', p_our_phone_id, p_our_display, p_contact, v_sid, v_name, coalesce(p_type, 'text'), p_body, p_wa_id, 'received', coalesce(p_at, now()))
  on conflict do nothing;
end $$;
revoke all on function public.wa_log_inbound(uuid, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.wa_log_inbound(uuid, text, text, text, text, text, text, timestamptz) to service_role;
