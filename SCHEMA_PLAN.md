# Cashflow App Schema Plan v1

## Core Tables

### productions
- id (uuid, pk)
- title (text)
- currency (text)
- region (text, nullable)
- status (text)
- start_date (date, nullable)
- end_date (date, nullable)
- notes (text, nullable)
- created_at (timestamptz)
- updated_at (timestamptz)

### import_batches
- id (uuid, pk)
- production_id (fk productions.id)
- source_type (text) -- cashflow_xlsx | hotcost_xls
- original_filename (text)
- file_storage_key (text)
- import_status (text)
- parser_version (text)
- started_at (timestamptz, nullable)
- completed_at (timestamptz, nullable)
- error_summary (text, nullable)
- metadata_json (jsonb, nullable)
- created_at (timestamptz)

### cash_flow_periods
- id (uuid, pk)
- production_id (fk productions.id)
- sequence (int)
- label (text)
- period_type (text)
- week_ending_date (date, nullable)
- source_column_key (text)
- created_at (timestamptz)

Constraints:
- unique(production_id, sequence)

### cash_flow_sections
- id (uuid, pk)
- production_id (fk productions.id)
- code (text, nullable)
- name (text)
- display_order (int)
- included_in_grand_total (boolean default true)
- source_start_row (int, nullable)
- source_end_row (int, nullable)
- created_at (timestamptz)
- updated_at (timestamptz)

Constraints:
- unique(production_id, display_order)

### cash_flow_line_items
- id (uuid, pk)
- production_id (fk productions.id)
- section_id (fk cash_flow_sections.id, nullable)
- import_batch_id (fk import_batches.id, nullable)
- account_code (text, nullable)
- description (text)
- line_type (text)
- source_row_number (int, nullable)
- ctd_amount (numeric(14,2), nullable)
- commitments_amount (numeric(14,2), nullable)
- imported_total (numeric(14,2), nullable)
- formula_json (jsonb, nullable)
- created_at (timestamptz)
- updated_at (timestamptz)

Indexes:
- (production_id)
- (section_id)
- (account_code)

### cash_flow_allocations
- id (uuid, pk)
- line_item_id (fk cash_flow_line_items.id)
- period_id (fk cash_flow_periods.id)
- amount (numeric(14,2))
- imported_value (numeric(14,2), nullable)
- source_formula (text, nullable)
- is_manual_override (boolean default false)
- created_at (timestamptz)
- updated_at (timestamptz)

Constraints:
- unique(line_item_id, period_id)

### forecast_snapshots
- id (uuid, pk)
- production_id (fk productions.id)
- name (text)
- snapshot_type (text)
- total_ctd (numeric(14,2), nullable)
- total_commitments (numeric(14,2), nullable)
- weekly_totals_json (jsonb)
- cumulative_totals_json (jsonb)
- created_by (text, nullable)
- created_at (timestamptz)

## Deferred to v2
These should wait until hot cost integration starts:
- hot_cost_days
- hot_cost_line_items
- mapping_rules

## Notes
- Use decimal-safe numeric types for all money fields.
- Preserve source row/column metadata whenever possible.
- Treat workbook formulas as metadata, not the execution engine.
