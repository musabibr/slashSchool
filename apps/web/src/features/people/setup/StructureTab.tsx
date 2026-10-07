import { useState } from 'react';
import { Alert, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconInfoCircle, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { EmptyState } from '../../../components/States';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { useStructureMutation, type GradeNode, type SectionNode, type StageNode, type Structure } from './api';
import { ConfirmModal, IconAction, NameModal, type NameValues } from './dialogs';

/** Section names offered by default, in order (أ، ب، ج …). */
const SECTION_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي'];

function nextSectionName(grade: GradeNode): string {
  const used = new Set(grade.classSections.map((c) => c.name));
  return SECTION_LETTERS.find((l) => !used.has(l)) ?? '';
}

type EditDialog =
  | { kind: 'addStage' }
  | { kind: 'renameStage'; stage: StageNode }
  | { kind: 'addGrade'; stage: StageNode }
  | { kind: 'renameGrade'; grade: GradeNode }
  | { kind: 'addSection'; grade: GradeNode }
  | { kind: 'renameSection'; section: SectionNode; grade: GradeNode };

type DeleteDialog = {
  entity: 'stages' | 'grade-levels' | 'class-sections';
  id: string;
  title: string;
  message: string;
  done: string;
};

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** "الفصول" tab: stage → grade level → section tree of the current year, with add / rename / delete. */
export function StructureTab({ schoolId, structure }: { schoolId: string; structure: Structure }) {
  const mutation = useStructureMutation(schoolId);
  const [dialog, setDialog] = useState<EditDialog | null>(null);
  const [toDelete, setToDelete] = useState<DeleteDialog | null>(null);
  const currentYear = structure.academicYears.find((y) => y.id === structure.currentAcademicYearId) ?? null;

  const open = (d: EditDialog) => {
    mutation.reset();
    setDialog(d);
  };

  const submit = (values: NameValues) => {
    if (!dialog) return;
    const done = (message: string) => ({
      onSuccess: () => {
        notifySuccess(message);
        setDialog(null);
      },
    });
    switch (dialog.kind) {
      case 'addStage':
        return mutation.mutate({ kind: 'create', entity: 'stages', body: values }, done('تمت إضافة المرحلة'));
      case 'renameStage':
        return mutation.mutate(
          { kind: 'update', entity: 'stages', id: dialog.stage.id, body: values },
          done('تم حفظ المرحلة'),
        );
      case 'addGrade':
        return mutation.mutate(
          { kind: 'create', entity: 'grade-levels', body: { ...values, stageId: dialog.stage.id } },
          done('تمت إضافة الصف'),
        );
      case 'renameGrade':
        return mutation.mutate(
          { kind: 'update', entity: 'grade-levels', id: dialog.grade.id, body: values },
          done('تم حفظ الصف'),
        );
      case 'addSection':
        return mutation.mutate(
          { kind: 'create', entity: 'class-sections', body: { name: values.name, gradeLevelId: dialog.grade.id } },
          done('تمت إضافة الفصل'),
        );
      case 'renameSection':
        return mutation.mutate(
          { kind: 'update', entity: 'class-sections', id: dialog.section.id, body: { name: values.name } },
          done('تم حفظ الفصل'),
        );
    }
  };

  const confirmDelete = () => {
    if (!toDelete) return;
    mutation.mutate(
      { kind: 'delete', entity: toDelete.entity, id: toDelete.id },
      {
        onSuccess: () => {
          notifySuccess(toDelete.done);
          setToDelete(null);
        },
        onError: (err) => {
          setToDelete(null);
          notifyError(err);
        },
      },
    );
  };

  const modal = dialog ? modalProps(dialog) : null;

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text c="dimmed" size="sm">
          {currentYear ? `فصول العام الدراسي ${currentYear.name}` : 'لم يتم إعداد العام الدراسي بعد'}
        </Text>
        <Button leftSection={<IconPlus size={16} />} onClick={() => open({ kind: 'addStage' })}>
          إضافة مرحلة
        </Button>
      </Group>

      {!currentYear && (
        <Alert color="yellow" icon={<IconInfoCircle />}>
          أضف العام الدراسي أولاً من تبويب «الأعوام الدراسية» حتى تتمكن من إضافة الفصول.
        </Alert>
      )}

      {structure.stages.length === 0 ? (
        <EmptyState message="لا توجد مراحل بعد. ابدأ بإضافة مرحلة (مثل: المرحلة المتوسطة)، ثم صفوفها وفصولها." />
      ) : (
        structure.stages.map((stage) => {
          const stageStudents = sum(stage.gradeLevels.flatMap((g) => g.classSections.map((c) => c.studentCount)));
          return (
            <Paper key={stage.id} withBorder radius="md" p="md">
              <Group justify="space-between" mb="sm" wrap="nowrap">
                <Group gap="xs" wrap="nowrap">
                  <Title order={4}>{stage.name}</Title>
                  <Badge variant="light" color="gray">
                    {stageStudents} طالب
                  </Badge>
                  <IconAction label="تعديل المرحلة" onClick={() => open({ kind: 'renameStage', stage })}>
                    <IconPencil size={16} />
                  </IconAction>
                  <IconAction
                    label="حذف المرحلة"
                    color="red"
                    onClick={() =>
                      setToDelete({
                        entity: 'stages',
                        id: stage.id,
                        title: 'حذف المرحلة',
                        message: `هل تريد حذف «${stage.name}»؟ يجب حذف صفوفها أولاً.`,
                        done: 'تم حذف المرحلة',
                      })
                    }
                  >
                    <IconTrash size={16} />
                  </IconAction>
                </Group>
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => open({ kind: 'addGrade', stage })}
                >
                  إضافة صف
                </Button>
              </Group>

              {stage.gradeLevels.length === 0 ? (
                <Text size="sm" c="dimmed">
                  لا توجد صفوف في هذه المرحلة.
                </Text>
              ) : (
                <Stack gap="sm">
                  {stage.gradeLevels.map((grade) => (
                    <Paper key={grade.id} radius="md" p="sm" bg="gray.0">
                      <Group justify="space-between" mb="xs" wrap="nowrap">
                        <Group gap="xs" wrap="nowrap">
                          <Text fw={700}>{grade.name}</Text>
                          <IconAction label="تعديل الصف" onClick={() => open({ kind: 'renameGrade', grade })}>
                            <IconPencil size={16} />
                          </IconAction>
                          <IconAction
                            label="حذف الصف"
                            color="red"
                            onClick={() =>
                              setToDelete({
                                entity: 'grade-levels',
                                id: grade.id,
                                title: 'حذف الصف',
                                message: `هل تريد حذف «${grade.name}»؟ لا يمكن حذف صف فيه فصول أو طلاب.`,
                                done: 'تم حذف الصف',
                              })
                            }
                          >
                            <IconTrash size={16} />
                          </IconAction>
                        </Group>
                        <Button
                          size="compact-sm"
                          variant="subtle"
                          leftSection={<IconPlus size={14} />}
                          disabled={!currentYear}
                          onClick={() => open({ kind: 'addSection', grade })}
                        >
                          فصل
                        </Button>
                      </Group>
                      {grade.classSections.length === 0 ? (
                        <Text size="sm" c="dimmed">
                          لا توجد فصول لهذا الصف في العام الحالي.
                        </Text>
                      ) : (
                        <SimpleGrid cols={{ base: 2, xs: 3, md: 5 }} spacing="xs">
                          {grade.classSections.map((section) => (
                            <Paper key={section.id} withBorder radius="md" px="sm" py={6}>
                              <Group justify="space-between" gap={4} wrap="nowrap">
                                <div>
                                  <Text fw={700} size="sm">
                                    {grade.name} - {section.name}
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    {section.studentCount} طالب
                                  </Text>
                                </div>
                                <Group gap={0} wrap="nowrap">
                                  <IconAction
                                    label="تعديل الفصل"
                                    onClick={() => open({ kind: 'renameSection', section, grade })}
                                  >
                                    <IconPencil size={14} />
                                  </IconAction>
                                  <IconAction
                                    label="حذف الفصل"
                                    color="red"
                                    onClick={() =>
                                      setToDelete({
                                        entity: 'class-sections',
                                        id: section.id,
                                        title: 'حذف الفصل',
                                        message: `هل تريد حذف فصل «${grade.name} - ${section.name}»؟ لا يمكن حذف فصل فيه طلاب أو دروس أو غياب مسجل.`,
                                        done: 'تم حذف الفصل',
                                      })
                                    }
                                  >
                                    <IconTrash size={14} />
                                  </IconAction>
                                </Group>
                              </Group>
                            </Paper>
                          ))}
                        </SimpleGrid>
                      )}
                    </Paper>
                  ))}
                </Stack>
              )}
            </Paper>
          );
        })
      )}

      {dialog && modal && (
        <NameModal
          key={modal.key}
          opened
          title={modal.title}
          label={modal.label}
          placeholder={modal.placeholder}
          initial={modal.initial}
          withSort={modal.withSort}
          submitLabel={modal.submitLabel}
          loading={mutation.isPending}
          error={mutation.error}
          onSubmit={submit}
          onClose={() => setDialog(null)}
        />
      )}
      <ConfirmModal
        opened={!!toDelete}
        title={toDelete?.title ?? ''}
        message={toDelete?.message}
        loading={mutation.isPending}
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </Stack>
  );
}

function modalProps(d: EditDialog) {
  switch (d.kind) {
    case 'addStage':
      return {
        key: 'addStage',
        title: 'إضافة مرحلة',
        label: 'اسم المرحلة',
        placeholder: 'مثال: المرحلة المتوسطة',
        initial: undefined,
        withSort: true,
        submitLabel: 'إضافة',
      };
    case 'renameStage':
      return {
        key: `stage:${d.stage.id}`,
        title: 'تعديل المرحلة',
        label: 'اسم المرحلة',
        placeholder: undefined,
        initial: { name: d.stage.name, sort: d.stage.sort },
        withSort: true,
        submitLabel: 'حفظ',
      };
    case 'addGrade':
      return {
        key: `addGrade:${d.stage.id}`,
        title: `إضافة صف — ${d.stage.name}`,
        label: 'اسم الصف',
        placeholder: 'مثال: الصف الخامس',
        initial: undefined,
        withSort: true,
        submitLabel: 'إضافة',
      };
    case 'renameGrade':
      return {
        key: `grade:${d.grade.id}`,
        title: 'تعديل الصف',
        label: 'اسم الصف',
        placeholder: undefined,
        initial: { name: d.grade.name, sort: d.grade.sort },
        withSort: true,
        submitLabel: 'حفظ',
      };
    case 'addSection':
      return {
        key: `addSection:${d.grade.id}`,
        title: `إضافة فصل — ${d.grade.name}`,
        label: 'اسم الفصل',
        placeholder: 'مثال: أ',
        initial: { name: nextSectionName(d.grade) },
        withSort: false,
        submitLabel: 'إضافة',
      };
    case 'renameSection':
      return {
        key: `section:${d.section.id}`,
        title: `تعديل فصل ${d.grade.name} - ${d.section.name}`,
        label: 'اسم الفصل',
        placeholder: undefined,
        initial: { name: d.section.name },
        withSort: false,
        submitLabel: 'حفظ',
      };
  }
}
