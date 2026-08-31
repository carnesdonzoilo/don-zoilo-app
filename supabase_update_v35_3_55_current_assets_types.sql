begin;

alter table public.current_assets
  drop constraint if exists current_assets_asset_type_check;

alter table public.current_assets
  add constraint current_assets_asset_type_check
  check (
    asset_type in (
      'cash',
      'checks',
      'bank',
      'personal_receivable',
      'investment',
      'fixed_asset',
      'opening_investment',
      'opening_fixed_asset'
    )
  );

commit;
