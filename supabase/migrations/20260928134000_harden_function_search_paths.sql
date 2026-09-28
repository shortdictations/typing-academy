-- Fix mutable search_path warnings on trigger/helper functions.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_sessions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.compute_effective_price(
  p_price numeric,
  p_discount_enabled boolean,
  p_discount_type text,
  p_discount_value numeric,
  p_discount_start_at timestamp with time zone,
  p_discount_end_at timestamp with time zone
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
declare
  v_discount_active boolean;
  v_final numeric;
begin
  v_discount_active := coalesce(p_discount_enabled, false)
    and p_discount_type is not null
    and p_discount_value is not null
    and (p_discount_start_at is null or now() >= p_discount_start_at)
    and (p_discount_end_at is null or now() <= p_discount_end_at);

  if not v_discount_active then return p_price; end if;
  if p_discount_type = 'PERCENTAGE' then
    v_final := p_price - (p_price * p_discount_value / 100);
  else
    v_final := p_price - p_discount_value;
  end if;
  if v_final < 0 then v_final := 0; end if;
  if v_final > p_price then v_final := p_price; end if;
  return round(v_final, 2);
end;
$function$;