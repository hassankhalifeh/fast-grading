-- 50: يستبدل "شعار المدرسة" الصغير بخلفية صورة تظهر خلف كل صفحات لوحة التحكم للحساب.
-- الخلفية الافتراضية يحددها مالك المنصة (platform_settings، صف واحد)، ولكل حساب أن يستبدلها بخلفيته الخاصة.

alter table school_settings rename column logo_path to background_path;

-- إعدادات المنصة العامة: صف واحد فقط (نمط singleton). الخلفية الافتراضية حين لا يخصّص الحساب خلفيته.
create table if not exists platform_settings (
  id boolean primary key default true,
  background_path text,
  updated_at timestamptz not null default now(),
  constraint platform_settings_singleton check (id)
);
insert into platform_settings (id) values (true) on conflict (id) do nothing;

alter table platform_settings enable row level security;

drop policy if exists platform_settings_read on platform_settings;
create policy platform_settings_read on platform_settings for select
  using (true); -- كل مستخدم مسجَّل يحتاج معرفة الخلفية الافتراضية حتى لو حسابه بلا خلفية خاصة

drop policy if exists platform_settings_write on platform_settings;
create policy platform_settings_write on platform_settings for update
  using (is_platform_admin())
  with check (is_platform_admin());

-- صلاحية مالك المنصة برفع/تعديل/حذف خلفية المنصة الافتراضية ضمن مسار _platform/ بنفس حافظة التخزين،
-- إلى جانب صلاحية كل حساب بخلفيته الخاصة ضمن مساره (موجودة أصلاً من الترحيل 49).
drop policy if exists school_logos_platform_write on storage.objects;
create policy school_logos_platform_write on storage.objects for insert
  with check (bucket_id = 'school-logos' and (storage.foldername(name))[1] = '_platform' and is_platform_admin());

drop policy if exists school_logos_platform_update on storage.objects;
create policy school_logos_platform_update on storage.objects for update
  using (bucket_id = 'school-logos' and (storage.foldername(name))[1] = '_platform' and is_platform_admin());

drop policy if exists school_logos_platform_delete on storage.objects;
create policy school_logos_platform_delete on storage.objects for delete
  using (bucket_id = 'school-logos' and (storage.foldername(name))[1] = '_platform' and is_platform_admin());
