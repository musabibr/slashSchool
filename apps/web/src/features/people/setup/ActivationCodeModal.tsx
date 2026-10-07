import { Alert, Button, CopyButton, Group, Modal, Paper, Stack, Text } from '@mantine/core';
import { IconBrandWhatsapp, IconCheck, IconCopy, IconInfoCircle } from '@tabler/icons-react';
import { formatDate, whatsappLink } from '@slash/shared';
import { dayjs } from '../../../lib/dayjs';

export interface IssuedCode {
  fullName: string;
  phone: string;
  code: string;
  /** ISO timestamp */
  expiresAt: string;
}

/** The message sent with the code (WhatsApp share / copy). */
export function activationMessage(fullName: string, schoolName: string, code: string): string {
  return `مرحباً ${fullName}، تم إنشاء حسابك في سلاش سكول (${schoolName}). رمز التفعيل: ${code} — للتفعيل افتح ${window.location.origin}/activate`;
}

/** Shows a freshly issued activation code once, with copy and WhatsApp share buttons. */
export function ActivationCodeModal({
  issued,
  schoolName,
  onClose,
}: {
  issued: IssuedCode | null;
  schoolName: string;
  onClose: () => void;
}) {
  const message = issued ? activationMessage(issued.fullName, schoolName, issued.code) : '';
  return (
    <Modal opened={!!issued} onClose={onClose} title="رمز التفعيل" centered>
      {issued && (
        <Stack gap="md">
          <div>
            <Text fw={700}>{issued.fullName}</Text>
            <Text size="sm" c="dimmed" dir="ltr" ta="right">
              {issued.phone}
            </Text>
          </div>
          <Paper withBorder radius="md" p="md" bg="gray.0">
            <Text
              ta="center"
              fw={700}
              ff="monospace"
              dir="ltr"
              style={{ fontSize: 28, letterSpacing: 4 }}
              aria-label="رمز التفعيل"
            >
              {issued.code}
            </Text>
            <Text ta="center" size="xs" c="dimmed" mt={4}>
              صالح حتى {formatDate(dayjs(issued.expiresAt).format('YYYY-MM-DD'))} — يُستخدم مرة واحدة
            </Text>
          </Paper>
          <Group grow>
            <CopyButton value={issued.code}>
              {({ copied, copy }) => (
                <Button
                  variant="default"
                  onClick={copy}
                  leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                >
                  {copied ? 'تم النسخ' : 'نسخ الرمز'}
                </Button>
              )}
            </CopyButton>
            <Button
              component="a"
              href={whatsappLink(issued.phone, message)}
              target="_blank"
              rel="noopener noreferrer"
              color="green"
              leftSection={<IconBrandWhatsapp size={18} />}
            >
              إرسال عبر واتساب
            </Button>
          </Group>
          <CopyButton value={message}>
            {({ copied, copy }) => (
              <Button variant="subtle" size="xs" onClick={copy}>
                {copied ? 'تم نسخ الرسالة' : 'نسخ الرسالة كاملة'}
              </Button>
            )}
          </CopyButton>
          <Alert color="blue" variant="light" icon={<IconInfoCircle />} py="xs">
            لن يظهر هذا الرمز مرة أخرى. إن فُقد، أصدر رمزاً جديداً وسيُلغى الرمز السابق.
          </Alert>
          <Button onClick={onClose}>تم</Button>
        </Stack>
      )}
    </Modal>
  );
}
