import type { ChangeEvent } from 'react';
import type { FieldDefinition, Lookups } from '../types';

function optionsFor(field: FieldDefinition, lookups: Lookups | null) {
  if (field.fieldKey === 'location') return lookups?.locations.map((item) => ({ id: item.id, label: item.full_path })) ?? [];
  if (field.fieldKey === 'owner') return lookups?.users.map((item) => ({ id: item.id, label: item.display_name })) ?? [];
  if (field.fieldKey === 'vendor') return lookups?.vendors.map((item) => ({ id: item.id, label: item.vendor_name })) ?? [];
  return field.options.map((item) => ({ id: item.id, label: item.label }));
}

export function DynamicForm({ fields, values, onChange, errors = {}, surface = 'add', lookups, compact = false }: { fields: FieldDefinition[]; values: Record<string, unknown>; onChange(key: string, value: unknown): void; errors?: Record<string, string>; surface?: 'add' | 'update' | 'filter'; lookups: Lookups | null; compact?: boolean }) {
  const visible = fields.filter((field) => field.surfaces[surface] !== false);
  return <div className={`form-grid ${compact ? 'form-grid--compact' : ''}`}>
    {visible.map((field) => {
      const id = `${surface}-${field.fieldKey}`; const value = values[field.fieldKey] ?? '';
      const common = { id, name: field.fieldKey, value: String(value), onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange(field.fieldKey, event.target.value), 'aria-invalid': Boolean(errors[field.fieldKey]), 'aria-describedby': `${id}-help` };
      const options = optionsFor(field, lookups);
      const isSelect = options.length > 0 || field.dataType === 'lookup' || field.dataType === 'entity';
      const isLongText = field.dataType === 'long_text' || field.dataType === 'multi_reference';
      const help = field.dataType === 'multi_reference'
        ? `${field.helpText}${field.helpText ? ' ' : ''}Enter multiple values separated by commas, semicolons, or new lines. The newest value is shown first after saving.`
        : field.helpText;
      return <label className={`field ${isLongText ? 'field--wide' : ''}`} key={field.id} htmlFor={id}>
        <span className="field__label">{field.label}{field.required && surface !== 'filter' && <b aria-hidden="true"> *</b>}</span>
        {isSelect ? <select {...common}><option value="">{surface === 'filter' ? `Any ${field.label}` : `Select ${field.label}`}</option>{options.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select>
          : isLongText ? <textarea {...common} rows={3}/>
          : field.dataType === 'boolean' ? <input id={id} name={field.fieldKey} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(field.fieldKey, event.target.checked)} aria-invalid={Boolean(errors[field.fieldKey])}/>
          : <input {...common} type={field.dataType === 'date' ? 'date' : field.dataType === 'number' ? 'number' : 'text'} />}
        <span id={`${id}-help`} className={errors[field.fieldKey] ? 'field__error' : 'field__help'}>{errors[field.fieldKey] ?? help}</span>
      </label>;
    })}
  </div>;
}
