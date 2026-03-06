-- If there are no admins, promote the first consultant who has a login (user_id) to admin.
-- Run this after 010/011 so the first user to sign up (or the only linked consultant) becomes admin.
update public.consultants c
set role = 'admin'
where c.user_id is not null
  and not exists (select 1 from public.consultants where role = 'admin')
  and c.id = (
    select id from public.consultants
    where user_id is not null
    order by created_at asc
    limit 1
  );
