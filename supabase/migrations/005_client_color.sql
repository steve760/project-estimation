-- Add colour per client (same pattern as consultants); backfill existing clients
alter table public.clients add column if not exists color text;

-- Backfill: assign colours by creation order (cycle through palette)
with ordered as (
  select id, (row_number() over (order by created_at) - 1) % 10 as idx
  from public.clients
),
palette as (
  select (array['#6D5CBE','#B69AF2','#10b981','#ef4444','#f59e0b','#3b82f6','#ec4899','#14b8a6','#8b5cf6','#f97316'])[i] as color, (i - 1) as idx
  from generate_series(1, 10) i
)
update public.clients c
set color = p.color
from ordered o
join palette p on p.idx = o.idx
where c.id = o.id and (c.color is null or c.color = '');
