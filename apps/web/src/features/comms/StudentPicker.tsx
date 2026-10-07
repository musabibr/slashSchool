import { useState } from 'react';
import { Loader, Select } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useStudentSearch, type StudentOption } from './api';

const optionLabel = (s: StudentOption) => `${s.fullName} — ${s.classLabel ?? 'بدون فصل'} (${s.code})`;

/** Searchable student select backed by the server search (name or code). */
export function StudentPicker({
  schoolId,
  value,
  onChange,
  error,
  required,
}: {
  schoolId: string;
  value: StudentOption | null;
  onChange: (student: StudentOption | null) => void;
  error?: string;
  required?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  // Once a student is picked the input shows its label; don't search for that text.
  const query = value && debounced === optionLabel(value) ? '' : debounced;
  const results = useStudentSearch(schoolId, query);
  const options = [...(results.data?.items ?? [])];
  if (value && !options.some((o) => o.id === value.id)) options.unshift(value);

  return (
    <Select
      label="الطالب"
      placeholder="ابحث باسم الطالب أو رمزه"
      searchable
      clearable
      required={required}
      error={error}
      searchValue={search}
      onSearchChange={setSearch}
      data={options.map((o) => ({ value: o.id, label: optionLabel(o) }))}
      value={value?.id ?? null}
      onChange={(id) => onChange(options.find((o) => o.id === id) ?? null)}
      // The server already filtered by the search text.
      filter={({ options: items }) => items}
      nothingFoundMessage={results.isFetching ? 'جارٍ البحث…' : results.error ? 'تعذر البحث' : 'لا يوجد طلاب'}
      rightSection={results.isFetching ? <Loader size="xs" /> : undefined}
      comboboxProps={{ withinPortal: true }}
    />
  );
}
