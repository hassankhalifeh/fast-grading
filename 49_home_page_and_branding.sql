-- 49: صفحة رئيسية مخصّصة بدل الدخول التلقائي إلى "المواد"، وشعار المدرسة، وصفحة افتراضية لكل مستخدم.

-- شعار المدرسة: مسار الملف داخل حافظة التخزين (وليس الرابط الكامل، يُبنى في الواجهة).
alter table school_settings add column if not exists logo_path text;

-- الصفحة الافتراضية لكل مستخدم عند الدخول (قيمة section في الواجهة، مثل "home" أو "students")؛
-- فارغة = الافتراضي العام (الرئيسية).
alter table app_users add column if not exists default_section text;

-- يحدّث المستخدم صفحته الافتراضية بنفسه فقط (بلا صلاحية خاصة)، بلا حاجة لسياسة RLS عامة للتعديل الذاتي
-- على app_users (الجدول ليس له سياسة UPDATE أصلاً، وهذا يبقيه كذلك ويفتح هذا العمود تحديداً فقط).
create or replace function public.set_my_default_section(p_section text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update public.app_users set default_section = nullif(trim(coalesce(p_section, '')), '') where id = current_app_user_id();
end
$$;

-- حافظة شعارات المدارس: صورة واحدة لكل حساب بمسار account_id/logo.<ext>، عامة القراءة (لا بيانات حساسة)،
-- والكتابة محصورة بمن يملك config.manage ضمن حساب نفسه فقط.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('school-logos', 'school-logos', true, 2097152, array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png','image/jpeg','image/webp','image/svg+xml'];

drop policy if exists school_logos_public_read on storage.objects;
create policy school_logos_public_read on storage.objects for select
  using (bucket_id = 'school-logos');

drop policy if exists school_logos_account_write on storage.objects;
create policy school_logos_account_write on storage.objects for insert
  with check (bucket_id = 'school-logos' and (storage.foldername(name))[1] = current_account_id()::text and has_capability('config.manage'));

drop policy if exists school_logos_account_update on storage.objects;
create policy school_logos_account_update on storage.objects for update
  using (bucket_id = 'school-logos' and (storage.foldername(name))[1] = current_account_id()::text and has_capability('config.manage'));

drop policy if exists school_logos_account_delete on storage.objects;
create policy school_logos_account_delete on storage.objects for delete
  using (bucket_id = 'school-logos' and (storage.foldername(name))[1] = current_account_id()::text and has_capability('config.manage'));
