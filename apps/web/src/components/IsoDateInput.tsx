import { DateInput, type DateInputProps } from '@mantine/dates';

/** Date picker whose value is an ISO 'YYYY-MM-DD' string (Mantine 8 date values are strings). */
export function IsoDateInput({
  value,
  onChange,
  ...rest
}: Omit<DateInputProps, 'value' | 'onChange'> & {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <DateInput
      valueFormat="D/M/YYYY"
      value={value}
      onChange={(v) => onChange(v ? String(v).slice(0, 10) : null)}
      popoverProps={{ withinPortal: true }}
      {...rest}
    />
  );
}
