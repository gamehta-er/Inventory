type Query = Record<string, string | undefined>;

export function appendRegistryFilters(
  query: Query,
  params: unknown[],
  where: string[],
  surface: 'filter' | 'report',
): void {
  const visibilityColumn = surface === 'filter' ? 'visible_filter' : 'visible_report';

  for (const [queryKey, rawValue] of Object.entries(query)) {
    if (!queryKey.startsWith('field_') || !rawValue?.trim()) continue;

    const fieldKey = queryKey.slice('field_'.length);
    if (!/^[a-z][a-z0-9_]*$/.test(fieldKey)) continue;

    params.push(fieldKey, rawValue.trim());
    const fieldParameter = `$${params.length - 1}`;
    const valueParameter = `$${params.length}`;
    const registryField = `EXISTS (
      SELECT 1
      FROM profile_fields registry_pf
      JOIN field_definitions registry_fd ON registry_fd.id = registry_pf.field_definition_id
      JOIN asset_profiles registry_ap ON registry_ap.id = registry_pf.profile_id
      WHERE registry_ap.category_id = am.category_id
        AND registry_ap.active
        AND registry_pf.active
        AND registry_fd.active
        AND registry_pf.${visibilityColumn}
        AND registry_fd.field_key = ${fieldParameter}
    )`;

    const coreConditions: Record<string, string> = {
      date_received: `a.date_received::text = ${valueParameter}`,
      model_number: `am.model_number ILIKE '%' || ${valueParameter} || '%'`,
      serial_number: `a.serial_number ILIKE '%' || ${valueParameter} || '%'`,
      milestone: `COALESCE(a.milestone, '') ILIKE '%' || ${valueParameter} || '%'`,
      product_name: `am.product_name ILIKE '%' || ${valueParameter} || '%'`,
      location: `(l.id::text = ${valueParameter} OR COALESCE(l.full_path, '') ILIKE '%' || ${valueParameter} || '%')`,
      asset_status: `(sv.id::text = ${valueParameter} OR sv.value_key ILIKE ${valueParameter} OR sv.display_value ILIKE ${valueParameter})`,
      board_sku: `COALESCE(am.board_sku, '') ILIKE '%' || ${valueParameter} || '%'`,
      gpu_sku: `COALESCE(am.gpu_sku, '') ILIKE '%' || ${valueParameter} || '%'`,
      board_architecture: `COALESCE(am.board_architecture, '') ILIKE '%' || ${valueParameter} || '%'`,
      gpu_class: `COALESCE(am.gpu_class, '') ILIKE '%' || ${valueParameter} || '%'`,
      gpu_chip: `COALESCE(am.gpu_chip, '') ILIKE '%' || ${valueParameter} || '%'`,
      gpu_name_vrl: `COALESCE(am.gpu_name_vrl, '') ILIKE '%' || ${valueParameter} || '%'`,
      gpu_name_market: `COALESCE(am.gpu_name_market, '') ILIKE '%' || ${valueParameter} || '%'`,
      pool_team: `COALESCE(a.pool_team, '') ILIKE '%' || ${valueParameter} || '%'`,
      project: `COALESCE(a.project, '') ILIKE '%' || ${valueParameter} || '%'`,
      asset_tag: `COALESCE(a.asset_tag, '') ILIKE '%' || ${valueParameter} || '%'`,
      owner: `(u.id::text = ${valueParameter} OR u.display_name ILIKE '%' || ${valueParameter} || '%')`,
      notes: `COALESCE(a.notes, '') ILIKE '%' || ${valueParameter} || '%'`,
      vendor: `(v.id::text = ${valueParameter} OR v.vendor_name ILIKE '%' || ${valueParameter} || '%')`,
      nvbugs: `EXISTS (
        SELECT 1 FROM asset_external_references core_ref
        JOIN external_reference_types core_type ON core_type.id = core_ref.reference_type_id
        WHERE core_ref.asset_id = a.id AND core_type.reference_type_key = 'NVBUG'
          AND core_ref.normalized_value ILIKE '%' || regexp_replace(${valueParameter}, '\\D', '', 'g') || '%'
      )`,
      mrs_order: `EXISTS (
        SELECT 1 FROM asset_external_references core_ref
        JOIN external_reference_types core_type ON core_type.id = core_ref.reference_type_id
        WHERE core_ref.asset_id = a.id AND core_type.reference_type_key = 'MRS_ORDER'
          AND core_ref.normalized_value ILIKE '%' || ${valueParameter} || '%'
      )`,
      capacity_request: `EXISTS (
        SELECT 1 FROM asset_external_references core_ref
        JOIN external_reference_types core_type ON core_type.id = core_ref.reference_type_id
        WHERE core_ref.asset_id = a.id AND core_type.reference_type_key = 'CAPACITY_REQUEST'
          AND core_ref.normalized_value ILIKE '%' || ${valueParameter} || '%'
      )`,
    };

    if (coreConditions[fieldKey]) {
      where.push(`(${registryField} AND ${coreConditions[fieldKey]})`);
      continue;
    }

    where.push(`(${registryField} AND EXISTS (
      SELECT 1
      FROM asset_field_values afv
      JOIN field_definitions fd ON fd.id = afv.field_definition_id AND fd.active
      JOIN profile_fields pf ON pf.field_definition_id = fd.id AND pf.active AND pf.${visibilityColumn}
      JOIN asset_profiles ap ON ap.id = pf.profile_id AND ap.category_id = am.category_id AND ap.active
      WHERE afv.asset_id = a.id
        AND fd.field_key = ${fieldParameter}
        AND COALESCE(
          afv.text_value,
          afv.number_value::text,
          afv.date_value::text,
          afv.boolean_value::text,
          afv.json_value::text,
          ''
        ) ILIKE '%' || ${valueParameter} || '%'
    ))`);
  }
}
