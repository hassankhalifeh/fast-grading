# Grading SaaS — Dashboard App

A real Next.js app, built and verified (`npm run build` passes with zero errors) — not a mockup.

## Before running this app — required SQL files

**Status on the live Supabase project (`rpxfbbznsctoyevfcvyu` / "Fast Grading"): everything below is already applied.** The base schema (01-06 — accounts, app_users, subjects, class_sections, students, exams, grades, capabilities/roles, subscription limits, notifications, term/class/school ranking views) was already live and is considerably richer than the file names below suggest (role-based RLS, per-plan class/student limits, weighted multi-component scoring views). Files `07_bulk_import.sql` through `12_security_fixes.sql` in this folder are what was added on top on 2026-09-17, and they've been rewritten to match the real column names/types found on the live database (`capabilities.key` not `id`/`code`, `has_capability(code)` with no actor argument, `audit_logs` with a restricted `action_type` enum + `jsonb` columns, `grade_history.resolution_method`). The zip `grading-saas-migrations-07-12.zip` bundles the same six files plus a `00_RUN_ALL_07_TO_12.sql` combined script for replaying on another environment (e.g. staging) — always diff column names against that environment's actual schema first, since the earlier 07-11 draft looked reasonable but didn't match reality until this pass.

`12_security_fixes.sql` fixes two issues Supabase's advisor caught that predate this session's changes: `grade_history` had RLS enabled with zero policies (silently blocking file 08's writes), and six reporting views (including `v_grade_report`) were implicitly `SECURITY DEFINER`, which let any authenticated user read every account's data through them.

### Known pre-existing gaps not yet fixed (flagged, not resolved)

Supabase's advisor also flagged, unrelated to this session's work:
- `subjects`, `custom_roles`, `notification_templates`, `class_subject_teachers` — RLS enabled with **no policies at all** (currently unusable via the API for any non-service-role caller, including `subjects` which the base dashboard screens read directly).
- The `user_capabilities` RLS policy scopes by account only, with no capability/role check — any account member can currently grant/revoke any capability for any other user in the account directly via the Supabase client.
- 27 functions (mostly pre-existing) have a mutable `search_path` (WARN-level hardening suggestion).
- `pg_trgm` extension installed in the `public` schema instead of a dedicated schema (WARN, cosmetic).
- Leaked-password protection is off in Supabase Auth settings (toggle in the dashboard, not a SQL fix).

## Running it locally

Same pattern as Buspulse:
```bash
npm install
cp .env.local.example .env.local   # fill in this project's Supabase URL + anon key
npm run dev
```
Open `http://localhost:3000` — you'll land on the login page, then `/dashboard`.

## What's in the dashboard

One shared dashboard (not separate role-specific apps like Buspulse) — the sidebar shows only the sections a user's granted capabilities allow:

- **المواد / المراحل / أنواع الاختبارات / سياسة العلامات** — the setup layer that must exist before grading can start
- **الصفوف / الطلاب** — roster management, including enrolling a student into a class from the same "Add Student" form
- **الامتحانات** — create exam records (class + subject + exam type + date)
- **إدخال العلامات** — pick an exam, see the roster, enter scores. Respects the grading-window lock and multi-component exams automatically. **Manual entry only** — the voice-to-data flow from the original design is a separate, larger build not included here.
- **الصلاحيات** — the literal "toggle switches per person" screen: every checkbox writes directly to `user_capabilities`.
- **التقارير** — `v_grade_report` (works today) and class rankings (needs files 04/05/06).

## First user setup

Same pattern as Buspulse: **Authentication → Users → Add user** in Supabase, then link them:
```sql
insert into app_users (account_id, auth_uid, full_name, role)
values ('<account-id>', '<auth-user-uid>', 'الاسم', 'solo_teacher');
```
Then, once file 04 is run, give them capabilities either via SQL (`select apply_default_capabilities('<app_user_id>', 'solo_teacher')`) or from the **الصلاحيات** screen itself once at least one capability is granted manually the first time.

## GitHub + Vercel

Identical steps to Buspulse — `git init`, push to a new repo, import into Vercel, set the two `NEXT_PUBLIC_SUPABASE_*` environment variables (pointing at the Grading SaaS project, not Buspulse's), deploy.

## What's deliberately not built yet

- Voice-to-data grade entry (manual entry only, for now)
- The parent notification Review & Compose Wizard
- A dedicated Exams-per-class-with-weight-override editor (`class_exam_type_weights` exists in the schema; editing it currently requires SQL — a natural next screen to add)
