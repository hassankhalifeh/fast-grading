# Grading SaaS — Dashboard App

A real Next.js app, built and verified (`npm run build` passes with zero errors) — not a mockup.

## Before running this app — required SQL files

**Status on the live Supabase project: everything below is already applied.** The base schema (01-06) was already live and is richer than the file names below suggest. Files `07_bulk_import.sql` through `23_revoke_anon_execute_on_helpers.sql` were added on top on 2026-09-17 and rewritten to match the real column names/types on the live database. Files 13-16 close out the rest of Supabase's security/performance advisor findings that were in scope for this pass (access-control and policy-coverage gaps, function hardening, redundant-policy cleanup) — see each file's header comment for specifics.

Two advisor items remain, both outside what a SQL migration can fix: an extension's schema placement (cosmetic), and a Supabase Auth setting that's a one-click toggle in the dashboard, not a migration.

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

- Automatic WhatsApp sending (currently click-to-chat; needs a provider such as WhatsApp Cloud API or Twilio)
- No editor for the legacy `class_exam_type_weights` table: it is superseded by the weights screen ("المعدلات والأوزان"), is empty, and nothing reads it (safe to drop later)

## Academic structure and weights (files 20-23)

Grading periods are configurable per school instead of hard-coded: academic year → terms → assessment items (e.g. coursework 1, term exam) → exams. Averages are computed automatically (exam → item → term → year) from default weights, which can be overridden by stage, class, subject or class+subject (most specific wins; weight 0 disables an item for that scope). Supervisors' permissions can be limited to a scope group (stage / floor / department / any mix) from the permissions screen. Dashboard sections: "الهيكل الأكاديمي" (setup wizard + defaults), "المعدلات والأوزان" (overrides), and scope groups under "الصلاحيات". "أنواع الاختبارات" is now "قوالب الاختبارات" (the multi-mark structure of a single exam).

## Teachers, users and organizational structure (files 24-26)

- **Teacher assignments (24):** one primary teacher per (class section, subject); a second teacher only through a request approved by the general principal.
- **Users (25):** invitations go through the `invite-user` Edge Function (service role, rank rules, one general principal); list/deactivate via RPCs.
- **Organization (26):** optional buildings → floors → class sections; exclusive supervisors at class / floor / stage / building level (one per target) with unlimited assistants; per-level capabilities editable per school; building supervisors are limited to building administration. If a lower level has no owner, authority falls to the next higher one up to the general principal, and a higher level can act in place of a lower one.

## Import, reports, supplementary exam (files 27-32)

- **27/28:** exam lock/approval, grade entry and reassignment functions now check permissions themselves (scoped to the class); lock columns on `exams` change only through the lock functions; bulk-import commit enrolls new students and stores parent data; Arabic names are normalized before matching (hamza, ta marbuta, diacritics).
- **29:** grade reads are scoped (assigned teacher, class/stage supervisor, principal), and reports expose applied weights with their source.
- **30:** server-side (no user) writes to grades are allowed only while an exam is unlocked.
- **31:** supplementary exam sessions: admin-chosen subjects and eligible students (weak students suggested), one exam per class/subject writable only by eligible students, final subject score and promotion computed by the session policy (replace / higher of / capped at pass mark). It never changes term or year averages.

## Parent notifications (file 34)

Section "إشعارات أولياء الأمور" (capability `notifications.send`): choose an exam, compose a message from placeholders ({الطالب} {الولي} {المادة} {الامتحان} {العلامة} {الحد} {الصف} {المدرسة}) or a saved template, review the roster (everyone with a valid parent phone and a grade is ticked by default; untick anyone you do not want), then send. Each message is logged in `notifications_log` (batch, phone, status). Sending opens WhatsApp click-to-chat with the message prefilled, so the sender presses Send in WhatsApp; fully automatic sending requires a WhatsApp provider account and an Edge Function.

## Multiple schools, school settings, message review (files 36-38)

- Platform owner page `/platform` (rows in `platform_admins`) creates schools (account + first admin invite) and toggles add-ons per school (`account_features`).
- "معلومات المدرسة" (`school_settings`): name, principal, contact, country code, report footer, approval mode.
- Parent messages: per-school wording per message type (`notification_templates.message_type`), draft batches (`notification_batches`) that must be reviewed and approved (capability `notifications.approve`) before any send; enforced by DB triggers and the `send-whatsapp` function.

## Per-school WhatsApp (file 39)

Subscription (`account_features`) is set by the platform owner; each school can switch the service on/off (`account_whatsapp_config.enabled`) and enters its own WhatsApp Cloud API credentials, stored encrypted in Supabase Vault and readable only by Edge Functions (`whatsapp-admin`, `send-whatsapp`, `whatsapp-webhook?a=<account>`). No platform-level WhatsApp secrets are used.

## WhatsApp conversation ledger (files 40-41)

`whatsapp_messages` is an append-only ledger of every outbound/inbound message with the school number used at that moment; `whatsapp_number_history` keeps every number the school has used. Rows are immutable (only delivery status changes) and cannot be deleted without an explicit owner purge; deleting an account that has a ledger is blocked. Changing the school number never rewrites history.

## Message moderation (files 42-43)

`moderation_terms` (global + per-school block/allow lists), `mod_scan` (Arabic-normalizing whole-word matcher), `message_violations` (append-only violation log with reviewer workflow). Triggers mark template/message rows `blocked` and log a violation without raising (so the log survives); batch approval, sending and the `send-whatsapp` function all refuse blocked rows.
