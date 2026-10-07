import { useState } from 'react';
import { Alert, Badge, Button, Chip, Group, Modal, Paper, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconBrandWhatsapp, IconCircleCheck, IconMessage, IconSend } from '@tabler/icons-react';
import { RELATION_LABELS, whatsappLink } from '@slash/shared';
import { useScope } from '../../api/hooks';
import { QueryState } from '../../components/States';
import { errorMessage, notifyError } from '../../lib/notify';
import { useCreateAnnouncement, useGuardianContacts } from './api';

interface MessageValues {
  title: string;
  body: string;
}

/** Ready-made messages, so the director only adjusts the text. */
function templates(studentName: string): Array<{ key: string; label: string; title: string; body: string }> {
  return [
    {
      key: 'visit',
      label: 'طلب حضور',
      title: 'الرجاء الحضور إلى المدرسة',
      body: `السيد ولي أمر الطالب ${studentName}، نرجو التكرم بالحضور إلى المدرسة في أقرب وقت لمقابلة الإدارة.`,
    },
    {
      key: 'absence',
      label: 'تكرار الغياب',
      title: 'تنبيه بخصوص الغياب',
      body: `السيد ولي أمر الطالب ${studentName}، نفيدكم بتكرر غياب الطالب عن المدرسة، نرجو متابعة الأمر مع إدارة المدرسة.`,
    },
    {
      key: 'behavior',
      label: 'السلوك',
      title: 'ملاحظة بخصوص السلوك',
      body: `السيد ولي أمر الطالب ${studentName}، نود إطلاعكم على ملاحظات بخصوص سلوك الطالب داخل الفصل، نرجو التواصل مع المشرف.`,
    },
    {
      key: 'praise',
      label: 'شكر وتقدير',
      title: 'شكر وتقدير',
      body: `السيد ولي أمر الطالب ${studentName}، يسعدنا إبلاغكم بتميز الطالب واجتهاده، مع خالص الشكر على متابعتكم.`,
    },
  ];
}

/** After sending: the guardians' numbers, each with a WhatsApp link carrying the same message. */
function WhatsAppShare({
  schoolId,
  studentId,
  text,
  onClose,
  onAnother,
}: {
  schoolId: string;
  studentId: string;
  text: string;
  onClose: () => void;
  onAnother: () => void;
}) {
  const contacts = useGuardianContacts(schoolId, studentId);
  return (
    <Stack gap="sm">
      <Alert color="teal" icon={<IconCircleCheck />} title="تم إرسال الرسالة">
        ستظهر في قسم الإعلانات في تطبيق ولي الأمر. يمكنك أيضاً إرسالها عبر واتساب:
      </Alert>
      <QueryState query={contacts} empty="لا توجد أرقام تواصل مسجلة لولي أمر هذا الطالب" isEmpty={(l) => l.length === 0}>
        {(list) => (
          <Stack gap="xs">
            {list.map((c) => (
              <Paper key={`${c.phone}:${c.relation}`} withBorder radius="md" p="sm">
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Stack gap={2} style={{ minWidth: 0 }}>
                    <Group gap={6} wrap="nowrap">
                      <Text fw={600} truncate>
                        {c.fullName}
                      </Text>
                      <Badge variant="light" color="gray" size="sm" style={{ flexShrink: 0 }}>
                        {RELATION_LABELS[c.relation]}
                      </Badge>
                    </Group>
                    <Text size="sm" c="dimmed" dir="ltr" ta="right">
                      {c.whatsapp ?? c.phone}
                    </Text>
                    {!c.activated && (
                      <Text size="xs" c="orange.8">
                        لم يفعّل التطبيق بعد — أرسلها عبر واتساب
                      </Text>
                    )}
                  </Stack>
                  <Button
                    component="a"
                    href={whatsappLink(c.whatsapp ?? c.phone, text)}
                    target="_blank"
                    rel="noopener noreferrer"
                    color="green"
                    variant="light"
                    leftSection={<IconBrandWhatsapp size={18} />}
                    style={{ flexShrink: 0 }}
                  >
                    واتساب
                  </Button>
                </Group>
              </Paper>
            ))}
          </Stack>
        )}
      </QueryState>
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onAnother}>
          رسالة أخرى
        </Button>
        <Button onClick={onClose}>إغلاق</Button>
      </Group>
    </Stack>
  );
}

function MessageForm({
  schoolId,
  studentId,
  studentName,
  onSent,
}: {
  schoolId: string;
  studentId: string;
  studentName: string;
  onSent: (message: MessageValues) => void;
}) {
  const create = useCreateAnnouncement(schoolId);
  const options = templates(studentName);
  const [template, setTemplate] = useState<string | null>(null);
  const form = useForm<MessageValues>({
    initialValues: { title: '', body: '' },
    validate: {
      title: (v) => (v.trim() ? null : 'عنوان الرسالة مطلوب'),
      body: (v) => (v.trim() ? null : 'نص الرسالة مطلوب'),
    },
  });
  const submit = form.onSubmit((v) => {
    const message = { title: v.title.trim(), body: v.body.trim() };
    create.mutate(
      { ...message, audienceType: 'student', audienceId: studentId },
      { onSuccess: () => onSent(message), onError: notifyError },
    );
  });
  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="sm">
        <div>
          <Text size="sm" fw={500} mb={6}>
            رسالة جاهزة
          </Text>
          <Chip.Group
            value={template}
            onChange={(key) => {
              const t = options.find((o) => o.key === key);
              setTemplate(typeof key === 'string' ? key : null);
              if (t) form.setValues({ title: t.title, body: t.body });
            }}
          >
            <Group gap="xs">
              {options.map((o) => (
                <Chip key={o.key} value={o.key} size="sm" variant="light">
                  {o.label}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        </div>
        <TextInput label="عنوان الرسالة" required maxLength={200} {...form.getInputProps('title')} />
        <Textarea label="نص الرسالة" required autosize minRows={4} maxRows={10} maxLength={5000} {...form.getInputProps('body')} />
        {create.error && (
          <Text c="red" size="sm">
            {errorMessage(create.error)}
          </Text>
        )}
        <Group justify="flex-end">
          <Button type="submit" leftSection={<IconSend size={18} />} loading={create.isPending}>
            إرسال
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/**
 * D4 "مراسلة ولي الأمر": composes an announcement for this student's guardians (audience 'student'),
 * then offers WhatsApp links to each guardian number with the same text.
 */
export function MessageGuardianButton({
  studentId,
  schoolId,
  studentName,
}: {
  studentId: string;
  schoolId: string;
  studentName: string;
}) {
  const [opened, setOpened] = useState(false);
  const [sent, setSent] = useState<MessageValues | null>(null);
  const schoolName = useScope(schoolId).data?.school.name ?? '';
  const close = () => {
    setOpened(false);
    setSent(null);
  };
  const shareText = sent ? [`*${sent.title}*`, sent.body, schoolName].filter(Boolean).join('\n\n') : '';
  return (
    <>
      <Button variant="light" leftSection={<IconMessage size={18} />} onClick={() => setOpened(true)}>
        إرسال رسالة لولي أمر الطالب
      </Button>
      <Modal opened={opened} onClose={close} title={`رسالة لولي أمر الطالب ${studentName}`} centered size="lg">
        {opened &&
          (sent ? (
            <WhatsAppShare
              schoolId={schoolId}
              studentId={studentId}
              text={shareText}
              onClose={close}
              onAnother={() => setSent(null)}
            />
          ) : (
            <MessageForm schoolId={schoolId} studentId={studentId} studentName={studentName} onSent={setSent} />
          ))}
      </Modal>
    </>
  );
}
