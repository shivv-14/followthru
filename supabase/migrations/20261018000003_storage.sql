-- Private bucket for task attachments. No public URLs: downloads need a signed-in user who can
-- read the file's task (app.can_read_file), or a short-lived signed URL made by the server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments', 'task-attachments', false, 10485760,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv', 'application/json',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip', 'application/x-zip-compressed'
  ]
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Uploads go only under the caller's own organization folder: <org_id>/<random>/<name>.
-- The organization comes from the caller's profile, never from the request.
create policy attachments_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'task-attachments'
  and app.org_id() is not null
  and (storage.foldername(name))[1] = app.org_id()::text
);

create policy attachments_select on storage.objects for select to authenticated using (
  bucket_id = 'task-attachments' and app.can_read_file(name)
);
-- No update or delete policies: replacing or deleting files goes through the server.
