-- 51: install pg_trgm INSIDE the fastgrading schema (BusPulse shared project).
-- analyze_student_import_batch() calls similarity() and its search_path is pinned to fastgrading only, so the extension
-- must live there (isolated from public and from other products). Found missing by the 2026-10-10 parity audit.
create extension if not exists pg_trgm with schema fastgrading;
