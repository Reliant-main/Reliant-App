-- Write screens for the App (audit items C1–C6 and C10), 2026-11-23.
-- Orders & Receiving (new orders, receiving, short shipments), Inventory (count, adjust, damage),
-- Book Info editor, and the PIN switch's lockout table.
-- Every function checks the caller's role itself; tables keep their existing row-level security.

-- ---------------------------------------------------------------- supplier file layouts
create table if not exists public.supplier_layouts (
  id text primary key,                 -- hash of the header row
  supplier_code text not null references public.suppliers(code) on update cascade,
  header_row int not null default 0,
  cols jsonb not null,                 -- {isbn: 0, title: 1, qty: 3, unit: 4, author: -1, orderNo: -1, orderDate: -1}
  sig text not null,
  saved_at timestamptz not null default now(),
  saved_by text default public.current_staff_name()
);
alter table public.supplier_layouts enable row level security;
drop policy if exists staff_read on public.supplier_layouts;
create policy staff_read on public.supplier_layouts for select to authenticated using ((select public.is_staff()));
drop policy if exists managers_all on public.supplier_layouts;
create policy managers_all on public.supplier_layouts for all to authenticated using ((select public.is_manager())) with check ((select public.is_manager()));

-- a box can arrive with none of a title in it (0 received), as long as a note says so
alter table public.receipts drop constraint if exists receipts_qty_check;
alter table public.receipts add constraint receipts_qty_check check (qty <> 0 or notes is not null);

-- ---------------------------------------------------------------- next house code for items with no ISBN
create or replace function public.next_house_code() returns text
language sql volatile security definer set search_path to 'public' as $$
  select 'RD-' || lpad((coalesce(max(substring(isbn from 4)::int), 0) + 1)::text, 4, '0')
  from books where isbn ~ '^RD-[0-9]+$'
$$;

-- ---------------------------------------------------------------- new supplier order
-- p: {order_number, supplier_code, supplier_name, order_date, shipping, invoice_total, file, notes,
--     lines: [{isbn, house, title, author, qty, unit, landed}]}
create or replace function public.order_create(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_order bigint; v_sup text := upper(trim(p->>'supplier_code')); l jsonb; v_isbn text;
  v_new int := 0; v_lines int := 0; v_units int := 0;
begin
  if not is_manager() then raise exception 'Only an owner or manager can add orders'; end if;
  if coalesce(trim(p->>'order_number'), '') = '' then raise exception 'The order needs an order number'; end if;
  if (p->>'order_date') is null then raise exception 'The order needs an order date'; end if;
  if v_sup is null or v_sup = '' then raise exception 'Pick a supplier'; end if;
  if exists (select 1 from orders where upper(order_number) = upper(trim(p->>'order_number'))) then
    raise exception 'Order #% is already recorded', trim(p->>'order_number'); end if;
  insert into suppliers (code, name) values (v_sup, coalesce(nullif(trim(p->>'supplier_name'), ''), v_sup))
    on conflict (code) do nothing;
  insert into orders (order_number, supplier_code, order_date, shipping_cost, invoice_total, order_file, notes)
  values (trim(p->>'order_number'), v_sup, (p->>'order_date')::date, coalesce((p->>'shipping')::numeric, 0),
          nullif(p->>'invoice_total', '')::numeric, nullif(p->>'file', ''), nullif(p->>'notes', ''))
  returning id into v_order;
  for l in select * from jsonb_array_elements(p->'lines') loop
    if coalesce((l->>'qty')::int, 0) <= 0 then continue; end if;
    v_isbn := case when coalesce((l->>'house')::boolean, false) then null else isbn13_norm(l->>'isbn') end;
    if v_isbn is null and coalesce((l->>'house')::boolean, false) then v_isbn := next_house_code();
    elsif v_isbn is null then raise exception 'Line "%" has no valid ISBN. Fix it, untick it, or give it a house code.', coalesce(l->>'title', l->>'isbn'); end if;
    if not exists (select 1 from books where isbn = v_isbn) then
      insert into books (isbn, title, author) values (v_isbn, coalesce(nullif(trim(l->>'title'), ''), 'Untitled ' || v_isbn), nullif(trim(l->>'author'), ''));
      v_new := v_new + 1;
    else
      update books set author = nullif(trim(l->>'author'), ''), updated_at = now() where isbn = v_isbn and author is null and nullif(trim(l->>'author'), '') is not null;
    end if;
    insert into order_lines (order_id, isbn, qty_ordered, item_cost, landed_cost_per_unit, notes)
    values (v_order, v_isbn, (l->>'qty')::int, round((l->>'unit')::numeric, 4), round((l->>'landed')::numeric, 4), 'Added in the App');
    v_lines := v_lines + 1; v_units := v_units + (l->>'qty')::int;
  end loop;
  if v_lines = 0 then raise exception 'Every line is unticked'; end if;
  return jsonb_build_object('order_id', v_order, 'lines', v_lines, 'units', v_units, 'new_titles', v_new);
end $$;

-- ---------------------------------------------------------------- receiving a box
-- p: {order_id, date, partial, lines: [{line_id, recv, front, dmg, bad, fate}]}   fate: 'gone' | 'wait'
create or replace function public.order_receive(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_order orders%rowtype; v_date date := coalesce((p->>'date')::date, current_date);
  v_partial boolean := coalesce((p->>'partial')::boolean, false);
  l jsonb; ol order_lines%rowtype; v_recv int; v_front int; v_keep int; v_exp int;
  v_units_ord int; v_units_recv int := 0; v_any_short boolean := false; v_split int := 0;
  v_short_wait int := 0; v_dmg int := 0; v_bad int := 0; v_books int := 0; v_fb boolean;
begin
  if not has_role('scanner') then raise exception 'Receiving is for owners, managers and receiving staff'; end if;
  if v_date > current_date then raise exception 'The date received can''t be in the future'; end if;
  select * into v_order from orders where id = (p->>'order_id')::bigint for update;
  if not found then raise exception 'That order wasn''t found'; end if;
  v_fb := upper(v_order.supplier_code) = 'FB';
  select coalesce(sum(qty_ordered), 0) into v_units_ord from order_lines where order_id = v_order.id;
  -- every line must still be waiting
  for l in select * from jsonb_array_elements(p->'lines') loop
    if exists (select 1 from receipts where order_line_id = (l->>'line_id')::bigint) then
      raise exception 'Part of this order was already received. Press Refresh and try again.'; end if;
    v_units_recv := v_units_recv + greatest(0, coalesce((l->>'recv')::int, 0));
  end loop;
  if v_partial and v_units_recv = 0 then raise exception 'Enter how many of each title arrived in this box'; end if;

  for l in select * from jsonb_array_elements(p->'lines') loop
    select * into ol from order_lines where id = (l->>'line_id')::bigint and order_id = v_order.id for update;
    if not found then raise exception 'A line on this order changed. Press Refresh and try again.'; end if;
    v_recv := greatest(0, coalesce((l->>'recv')::int, 0));
    v_front := nullif(l->>'front', '')::int;
    v_exp := ol.qty_ordered;
    if v_partial and v_recv = 0 then continue; end if;            -- not in this box: stays waiting
    if v_partial and v_recv < v_exp then                         -- the rest goes on its own waiting line
      insert into order_lines (order_id, isbn, qty_ordered, item_cost, landed_cost_per_unit, notes)
      values (ol.order_id, ol.isbn, v_exp - v_recv, ol.item_cost, ol.landed_cost_per_unit, 'Rest of partial delivery received ' || v_date);
      update order_lines set qty_ordered = v_recv where id = ol.id;
      v_exp := v_recv; v_split := v_split + 1;
    end if;
    if v_recv > v_exp then update order_lines set qty_ordered = v_recv where id = ol.id; v_exp := v_recv; end if;
    if v_fb then
      if v_front is null then raise exception 'Enter the front-end number for every First Book title'; end if;
      v_front := least(greatest(v_front, 0), v_recv);
      update order_lines set front_end_qty = v_front, notes = concat_ws(' · ', notes, 'front end ' || v_front || ' of ' || v_recv || ' arrived') where id = ol.id;
      v_keep := v_front;
    else
      v_keep := v_recv;
    end if;
    insert into receipts (order_line_id, received_on, qty, notes)
    values (ol.id, v_date, v_keep, case when v_keep = 0 then 'Nothing arrived' end);
    v_books := v_books + v_keep;
    if not v_fb and not v_partial and v_recv < v_exp then
      v_any_short := true;
      insert into short_followups (order_line_id, status, status_date, notes)
      values (ol.id, case when l->>'fate' = 'wait' then 'waiting' else 'written_off' end, v_date, 'Logged when receiving')
      on conflict (order_line_id) do update set status = excluded.status, status_date = excluded.status_date;
      if l->>'fate' = 'wait' then v_short_wait := v_short_wait + (v_exp - v_recv); end if;
    end if;
    if coalesce((l->>'dmg')::int, 0) > 0 then
      insert into damaged_stock (logged_on, isbn, qty, damage_type, order_number, notes)
      values (v_date, ol.isbn, (l->>'dmg')::int, 'Arrived damaged – sellable', v_order.order_number, 'Logged when receiving');
      v_dmg := v_dmg + (l->>'dmg')::int;
    end if;
    if coalesce((l->>'bad')::int, 0) > 0 then
      insert into damaged_stock (logged_on, isbn, qty, damage_type, order_number, notes)
      values (v_date, ol.isbn, (l->>'bad')::int, 'Arrived too damaged to sell', v_order.order_number, 'Logged when receiving');
      v_bad := v_bad + (l->>'bad')::int;
    end if;
  end loop;

  -- a short box spreads the order's shipping over the books that actually came
  if v_any_short and v_order.shipping_cost > 0 and v_units_ord > 0 and v_units_recv > 0 then
    update order_lines set landed_cost_per_unit = round(landed_cost_per_unit - v_order.shipping_cost / v_units_ord + v_order.shipping_cost / v_units_recv, 4)
    where order_id = v_order.id and landed_cost_per_unit - v_order.shipping_cost / v_units_ord >= 0;
  end if;
  return jsonb_build_object('books', v_books, 'arrived', v_units_recv, 'split', v_split, 'short_waiting', v_short_wait,
                            'damaged', v_dmg, 'cant_sell', v_bad, 'resplit', v_any_short and v_order.shipping_cost > 0);
end $$;

-- ---------------------------------------------------------------- short shipments that turn up later (or never)
create or replace function public.short_resolve(p_line bigint, p_action text, p_qty int default null, p_date date default current_date) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare s order_line_status%rowtype;
begin
  if not has_role('scanner') then raise exception 'Receiving is for owners, managers and receiving staff'; end if;
  select * into s from order_line_status where order_line_id = p_line;
  if not found or coalesce(s.short_status, '') <> 'waiting' or s.qty_short <= 0 then raise exception 'This short line isn''t waiting any more. Press Refresh.'; end if;
  if p_action = 'gone' then
    update short_followups set status = 'written_off', status_date = current_date, notes = concat_ws(' · ', notes, 'marked not coming ' || current_date) where order_line_id = p_line;
    return jsonb_build_object('gone', s.qty_short);
  elsif p_action = 'arrived' then
    if p_qty is null or p_qty < 1 or p_qty > s.qty_short then raise exception 'Enter between 1 and %', s.qty_short; end if;
    if p_date > current_date then raise exception 'Pick a date that isn''t in the future'; end if;
    insert into receipts (order_line_id, received_on, qty, notes) values (p_line, p_date, p_qty, 'Late arrival (short shipment)');
    update short_followups set status = case when p_qty >= s.qty_short then 'arrived' else 'waiting' end, status_date = p_date,
      notes = concat_ws(' · ', notes, p_qty || ' arrived ' || p_date) where order_line_id = p_line;
    return jsonb_build_object('arrived', p_qty, 'left', s.qty_short - p_qty);
  end if;
  raise exception 'Unknown action';
end $$;

-- ---------------------------------------------------------------- counting: undo your own entry
create or replace function public.count_undo(p_id bigint) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not has_role('operator', 'scanner') then raise exception 'Sign in to count'; end if;
  delete from stock_counts where id = p_id
    and (is_manager() or (counted_by = current_staff_name() and created_at > now() - interval '1 day'));
  if not found then raise exception 'That entry can''t be removed (only your own entries from today, or by a manager)'; end if;
end $$;

-- ---------------------------------------------------------------- adjustments and damage: remove a recent entry (managers)
create or replace function public.stock_entry_remove(p_kind text, p_id bigint) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_manager() then raise exception 'Only an owner or manager can remove entries'; end if;
  if p_kind = 'adjust' then delete from stock_adjustments where id = p_id;
  elsif p_kind = 'damage' then delete from damaged_stock where id = p_id and spotlight_ref is null;
  else raise exception 'Unknown entry'; end if;
  if not found then raise exception 'That entry wasn''t found (damage logged during a show is fixed in Fulfillment)'; end if;
end $$;

-- ---------------------------------------------------------------- book info (title, author, Goodreads, spice, genres, tropes, display text)
-- p: {isbn, house, title, author, gr, spice, release_date, genres:[id], tropes:[id], series, synopsis, notes, pronunciation, new}
create or replace function public.book_save(p jsonb) returns text
language plpgsql security definer set search_path to 'public' as $$
declare v_isbn text; v_new boolean := coalesce((p->>'new')::boolean, false); v_row int; g text; t text;
begin
  if not is_manager() then raise exception 'Only an owner or manager can edit book info'; end if;
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'The book needs a title'; end if;
  if coalesce((p->>'house')::boolean, false) then v_isbn := next_house_code();
  else v_isbn := coalesce(case when p->>'isbn' ~ '^RD-[0-9]+$' then p->>'isbn' end, isbn13_norm(p->>'isbn')); end if;
  if v_isbn is null then raise exception 'That isn''t a valid ISBN. Use a house code for items with no ISBN.'; end if;
  if v_new and exists (select 1 from books where isbn = v_isbn) then raise exception 'That ISBN is already in the book list'; end if;
  if not v_new and not exists (select 1 from books where isbn = v_isbn) then raise exception 'That book wasn''t found'; end if;
  insert into books (isbn, title, author, gr_score, gr_checked_on, spice, release_date)
  values (v_isbn, trim(p->>'title'), nullif(trim(p->>'author'), ''), nullif(p->>'gr', '')::numeric,
          case when nullif(p->>'gr', '') is not null then current_date end, nullif(p->>'spice', '')::smallint, nullif(p->>'release_date', '')::date)
  on conflict (isbn) do update set title = excluded.title, author = excluded.author,
    gr_checked_on = case when excluded.gr_score is distinct from books.gr_score then current_date else books.gr_checked_on end,
    gr_score = excluded.gr_score, spice = excluded.spice, release_date = excluded.release_date, updated_at = now();
  insert into book_display_info (isbn, series, synopsis, notes, pronunciation, updated_at)
  values (v_isbn, nullif(trim(p->>'series'), ''), nullif(trim(p->>'synopsis'), ''), nullif(trim(p->>'notes'), ''), nullif(trim(p->>'pronunciation'), ''), now())
  on conflict (isbn) do update set series = excluded.series, synopsis = excluded.synopsis, notes = excluded.notes, pronunciation = excluded.pronunciation, updated_at = now();
  delete from book_genres where isbn = v_isbn;
  insert into book_genres (isbn, genre_id) select v_isbn, x::smallint from jsonb_array_elements_text(coalesce(p->'genres', '[]')) x;
  delete from book_tropes where isbn = v_isbn;
  insert into book_tropes (isbn, trope_id) select v_isbn, x::smallint from jsonb_array_elements_text(coalesce(p->'tropes', '[]')) x;
  -- Book Spotlight reads the tele-prompter list: keep its row for this book in step
  select string_agg(gg.name, ', ' order by gg.sort_order, gg.name) into g from book_genres bg join genres gg on gg.id = bg.genre_id where bg.isbn = v_isbn;
  select string_agg(tt.name, ', ' order by tt.name) into t from book_tropes bt join tropes tt on tt.id = bt.trope_id where bt.isbn = v_isbn;
  if exists (select 1 from teleprompter) then
    select row_num into v_row from teleprompter where isbn13 = v_isbn or isbn = v_isbn order by row_num limit 1;
    if v_row is null then select coalesce(max(row_num), 1) + 1 into v_row from teleprompter;
      insert into teleprompter (row_num, isbn, isbn13) values (v_row, v_isbn, v_isbn); end if;
    update teleprompter set title = trim(p->>'title'), author = nullif(trim(p->>'author'), ''), gr = nullif(p->>'gr', ''),
      spice = nullif(p->>'spice', ''), genres = g, tropes = t, series = nullif(trim(p->>'series'), ''), synopsis = nullif(trim(p->>'synopsis'), ''),
      notes = nullif(trim(p->>'notes'), ''), pron = nullif(trim(p->>'pronunciation'), ''), synced_at = now()
    where row_num = v_row;
  end if;
  return v_isbn;
end $$;

-- books in stock or on order that are missing what the show screen needs
create or replace function public.book_info_list() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select case when is_staff() then (select coalesce(jsonb_agg(jsonb_build_array(
    b.isbn, b.title, coalesce(b.author, ''), b.gr_score, b.spice, b.release_date,
    (select coalesce(jsonb_agg(bg.genre_id), '[]') from book_genres bg where bg.isbn = b.isbn),
    (select coalesce(jsonb_agg(bt.trope_id), '[]') from book_tropes bt where bt.isbn = b.isbn),
    d.series, d.synopsis, d.notes, d.pronunciation,
    coalesce(i.on_hand, 0), coalesce(i.en_route, 0)) order by b.title), '[]')
    from books b left join book_display_info d on d.isbn = b.isbn left join inventory_status i on i.isbn = b.isbn) end
$$;

-- ---------------------------------------------------------------- PIN switch: failed tries (read only by the switch function)
create table if not exists public.pin_attempts (
  id bigserial primary key,
  staff_id uuid not null,
  ok boolean not null,
  at timestamptz not null default now(),
  by_user uuid
);
alter table public.pin_attempts enable row level security;   -- no policies: only the service role reads or writes it

-- who can be switched to on a shared device (names only; no emails)
create or replace function public.pin_people() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select case when is_staff() then (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', display_name, 'role', role) order by display_name), '[]')
    from staff where active and user_id is not null and pin_hash is not null) end
$$;

revoke execute on function public.next_house_code() from public, anon, authenticated;
revoke execute on function public.order_create(jsonb), public.order_receive(jsonb), public.short_resolve(bigint, text, int, date),
  public.count_undo(bigint), public.stock_entry_remove(text, bigint), public.book_save(jsonb), public.book_info_list(), public.pin_people() from public, anon;
grant execute on function public.order_create(jsonb), public.order_receive(jsonb), public.short_resolve(bigint, text, int, date),
  public.count_undo(bigint), public.stock_entry_remove(text, bigint), public.book_save(jsonb), public.book_info_list(), public.pin_people() to authenticated;

-- ---------------------------------------------------------------- applied separately the same day
-- orders_export: adds 'live' (switch-day flag), an "added in the App" flag per order, and line id + author per line.
-- app.analytics_meta: each R carries its used-book source (its load's source, else the main source of its show's sales),
--   so Analytics can show sell-through by source.
