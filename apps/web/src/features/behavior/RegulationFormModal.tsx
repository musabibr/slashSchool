import { Button, Group, Modal, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { ApiError } from '../../api/client';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useSaveRegulation, type Regulation } from './api';

interface FormValues {
  code: string;
  title: string;
  defaultPenalty: string;
}

/** Add / edit one regulation. `regulation` = edit; `onSaved` receives the saved row. */
export function RegulationFormModal({
  schoolId,
  opened,
  regulation,
  onClose,
  onSaved,
}: {
  schoolId: string;
  opened: boolean;
  regulation?: Regulation | null;
  onClose: () => void;
  onSaved?: (regulation: Regulation) => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title={regulation ? 'تعديل اللائحة' : 'إضافة لائحة'} centered size="md">
      {/* Remount per opening so the form starts from the edited row (or empty). */}
      {opened && (
        <RegulationForm schoolId={schoolId} regulation={regulation ?? null} onClose={onClose} onSaved={onSaved} />
      )}
    </Modal>
  );
}

function RegulationForm({
  schoolId,
  regulation,
  onClose,
  onSaved,
}: {
  schoolId: string;
  regulation: Regulation | null;
  onClose: () => void;
  onSaved?: (regulation: Regulation) => void;
}) {
  const save = useSaveRegulation(schoolId);
  const form = useForm<FormValues>({
    initialValues: {
      code: regulation?.code ?? '',
      title: regulation?.title ?? '',
      defaultPenalty: regulation?.defaultPenalty ?? '',
    },
    validate: {
      title: (v) => (v.trim() ? null : 'عنوان اللائحة مطلوب'),
    },
  });

  const submit = form.onSubmit((v) =>
    save.mutate(
      {
        id: regulation?.id,
        code: v.code.trim() || null,
        title: v.title.trim(),
        defaultPenalty: v.defaultPenalty.trim() || null,
      },
      {
        onSuccess: (saved) => {
          notifySuccess(regulation ? 'تم تعديل اللائحة' : 'تمت إضافة اللائحة');
          onSaved?.(saved);
          onClose();
        },
        onError: (err) => {
          if (err instanceof ApiError && err.details?.length) {
            const errors: Partial<Record<keyof FormValues, string>> = {};
            for (const d of err.details) {
              if (d.path === 'code' || d.path === 'title' || d.path === 'defaultPenalty') errors[d.path] = d.message;
            }
            form.setErrors(errors);
          }
          notifyError(err);
        },
      },
    ),
  );

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="sm">
        <TextInput label="رقم اللائحة" placeholder="اختياري، مثال: 4" maxLength={30} {...form.getInputProps('code')} />
        <TextInput
          label="اللائحة"
          placeholder="مثال: إحضار الهاتف الجوال إلى المدرسة"
          required
          maxLength={300}
          data-autofocus
          {...form.getInputProps('title')}
        />
        <TextInput
          label="العقوبة الافتراضية"
          placeholder="اختياري، مثال: إنذار كتابي"
          description="تظهر تلقائياً عند تسجيل مخالفة لهذه اللائحة ويمكن تعديلها"
          maxLength={300}
          {...form.getInputProps('defaultPenalty')}
        />
        <Group grow mt="xs">
          <Button type="submit" loading={save.isPending}>
            {regulation ? 'حفظ التعديل' : 'إضافة'}
          </Button>
          <Button variant="default" onClick={onClose} disabled={save.isPending}>
            إلغاء
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
