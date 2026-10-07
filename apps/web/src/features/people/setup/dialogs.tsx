import { useState, type ReactNode } from 'react';
import { ActionIcon, Button, Group, Modal, NumberInput, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { ApiError } from '../../../api/client';
import { errorMessage } from '../../../lib/notify';

/** Small icon button with a tooltip (edit / delete in tables and trees). */
export function IconAction({
  label,
  color = 'gray',
  disabled,
  onClick,
  children,
}: {
  label: string;
  color?: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip label={label} withArrow>
      <ActionIcon variant="subtle" color={color} size="sm" aria-label={label} disabled={disabled} onClick={onClick}>
        {children}
      </ActionIcon>
    </Tooltip>
  );
}

/** "Are you sure?" dialog for destructive actions. */
export function ConfirmModal({
  opened,
  title,
  message,
  confirmLabel = 'حذف',
  color = 'red',
  loading,
  onConfirm,
  onClose,
}: {
  opened: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  color?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      <Stack gap="md">
        <Text size="sm">{message}</Text>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            إلغاء
          </Button>
          <Button color={color} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export interface NameValues {
  name: string;
  sort?: number;
}

/** Field-level message from a 400 response (`details[].path`), if any. */
export function fieldError(err: unknown, path: string): string | null {
  if (err instanceof ApiError) return err.details?.find((d) => d.path === path)?.message ?? null;
  return null;
}

/**
 * Add / rename dialog with a single name field (and an optional display order).
 * The parent keys it per target so the form starts from `initial` each time it opens.
 */
export function NameModal({
  opened,
  title,
  label,
  placeholder,
  initial,
  withSort = false,
  submitLabel = 'حفظ',
  loading,
  error,
  onSubmit,
  onClose,
}: {
  opened: boolean;
  title: string;
  label: string;
  placeholder?: string;
  initial?: NameValues;
  withSort?: boolean;
  submitLabel?: string;
  loading?: boolean;
  /** The last server error, to show next to the field. */
  error?: unknown;
  onSubmit: (values: NameValues) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [sort, setSort] = useState<number | string>(initial?.sort ?? '');
  const [touched, setTouched] = useState(false);
  const empty = !name.trim();
  const serverError = fieldError(error, 'name') ?? (error && !fieldError(error, 'sort') ? errorMessage(error) : null);

  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (empty) return;
          onSubmit({ name: name.trim(), sort: typeof sort === 'number' ? sort : undefined });
        }}
      >
        <Stack gap="sm">
          <TextInput
            label={label}
            placeholder={placeholder}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            error={touched && empty ? 'هذا الحقل مطلوب' : serverError}
            maxLength={100}
            withAsterisk
            data-autofocus
          />
          {withSort && (
            <NumberInput
              label="الترتيب"
              description="يحدد ترتيب الظهور في القوائم (اتركه فارغاً ليُضاف في النهاية)"
              value={sort}
              onChange={setSort}
              min={0}
              max={10000}
              allowDecimal={false}
              allowNegative={false}
              error={fieldError(error, 'sort')}
            />
          )}
          <Group justify="flex-end" gap="xs" mt="xs">
            <Button variant="default" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" loading={loading}>
              {submitLabel}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
