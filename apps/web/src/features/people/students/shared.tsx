import { useState } from 'react';
import { Badge, Button, CopyButton, Group, Modal, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { IconBrandWhatsapp, IconCheck, IconCopy, IconKey } from '@tabler/icons-react';
import {
  formatDate,
  RELATION_LABELS,
  STUDENT_STATUS_LABELS,
  whatsappLink,
  type StudentStatus,
  type UserStatus,
} from '@slash/shared';
import { useScope } from '../../../api/hooks';
import { notifyError } from '../../../lib/notify';
import { useIssueActivationCode, type IssuedGuardian } from './api';
import { activationMessage, STUDENT_STATUS_COLORS, USER_STATUS_COLORS, USER_STATUS_LABELS } from './helpers';

/** The current school's name (for WhatsApp messages). */
export function useSchoolName(schoolId: string): string {
  return useScope(schoolId).data?.school.name ?? '';
}

export function StudentStatusBadge({ status }: { status: StudentStatus }) {
  return (
    <Badge color={STUDENT_STATUS_COLORS[status]} variant="light">
      {STUDENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return (
    <Badge color={USER_STATUS_COLORS[status]} variant="light">
      {USER_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Copy + WhatsApp buttons for a one-time code. */
export function CodeActions({ code, phone, message }: { code: string; phone: string; message: string }) {
  return (
    <Group gap="xs">
      <CopyButton value={code} timeout={2000}>
        {({ copied, copy }) => (
          <Button
            size="xs"
            variant="light"
            color={copied ? 'teal' : 'blue'}
            leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            onClick={copy}
          >
            {copied ? 'تم النسخ' : 'نسخ الرمز'}
          </Button>
        )}
      </CopyButton>
      <Button
        size="xs"
        color="green"
        component="a"
        href={whatsappLink(phone, message)}
        target="_blank"
        rel="noopener noreferrer"
        leftSection={<IconBrandWhatsapp size={14} />}
      >
        إرسال عبر واتساب
      </Button>
    </Group>
  );
}

/** A code shown large (read aloud or typed from paper) with copy and WhatsApp share. */
export function CodeCard({
  label = 'رمز التفعيل',
  code,
  phone,
  message,
  hint,
}: {
  label?: string;
  code: string;
  phone: string;
  message: string;
  hint?: string;
}) {
  return (
    <Paper withBorder radius="md" p="sm" bg="var(--mantine-color-gray-0)">
      <Group justify="space-between" align="center" gap="xs">
        <Stack gap={0}>
          <Text size="xs" c="dimmed">
            {label}
          </Text>
          <Text fw={700} fz="xl" ff="monospace" dir="ltr" style={{ letterSpacing: 1 }}>
            {code}
          </Text>
          {hint && (
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          )}
        </Stack>
        <CodeActions code={code} phone={phone} message={message} />
      </Group>
    </Paper>
  );
}

/**
 * A guardian account after admission / adding a guardian: its activation code, or why there is none.
 */
export function IssuedGuardianCard({
  guardian,
  students,
  schoolName,
}: {
  guardian: IssuedGuardian;
  students: string[];
  schoolName: string;
}) {
  const phone = guardian.whatsapp ?? guardian.phone;
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="xs">
        <Group justify="space-between" gap="xs">
          <Stack gap={0}>
            <Text fw={700}>{guardian.fullName}</Text>
            <Text size="sm" c="dimmed">
              {RELATION_LABELS[guardian.relation]} ·{' '}
              <Text span dir="ltr" inherit>
                {guardian.phone}
              </Text>
            </Text>
          </Stack>
          <UserStatusBadge status={guardian.status} />
        </Group>
        {guardian.activationCode ? (
          <CodeCard
            code={guardian.activationCode}
            phone={phone}
            message={activationMessage({
              guardianName: guardian.fullName,
              students,
              schoolName,
              code: guardian.activationCode,
            })}
            hint="صالح لمدة 14 يوماً، ويُستخدم مرة واحدة"
          />
        ) : guardian.status === 'active' ? (
          <Text size="sm" c="dimmed">
            الحساب مفعل مسبقاً — يدخل ولي الأمر برقم الهاتف والرقم السري وسيظهر الطالب في قائمة أبنائه.
          </Text>
        ) : guardian.otherSchool ? (
          <Text size="sm" c="dimmed">
            هذا الرقم مسجل لدى مدرسة أخرى — يستخدم ولي الأمر رمز التفعيل الذي استلمه منها.
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            لم يتم إصدار رمز تفعيل لهذا الحساب.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

/**
 * "رمز تفعيل" button: issues a fresh activation code (revoking older unused ones) and shows it with
 * copy + WhatsApp. Disabled for accounts this school may not reset.
 */
export function IssueCodeButton({
  schoolId,
  userId,
  guardianName,
  phone,
  students,
  canIssue,
  size = 'xs',
}: {
  schoolId: string;
  userId: string;
  guardianName: string;
  phone: string;
  students: string[];
  canIssue: boolean;
  size?: 'xs' | 'compact-xs' | 'sm';
}) {
  const schoolName = useSchoolName(schoolId);
  const issue = useIssueActivationCode(schoolId);
  const [result, setResult] = useState<{ code: string; expiresAt: string } | null>(null);
  const button = (
    <Button
      size={size}
      variant="light"
      leftSection={<IconKey size={14} />}
      disabled={!canIssue}
      loading={issue.isPending}
      onClick={() => issue.mutate(userId, { onSuccess: setResult, onError: notifyError })}
    >
      رمز تفعيل
    </Button>
  );
  return (
    <>
      {canIssue ? (
        button
      ) : (
        <Tooltip label="الحساب مستخدم في مدرسة أخرى أو حساب إدارة، لا يمكن إصدار رمز له من هنا" multiline w={240}>
          <span>{button}</span>
        </Tooltip>
      )}
      <Modal opened={!!result} onClose={() => setResult(null)} title={`رمز تفعيل ${guardianName}`} centered>
        {result && (
          <Stack gap="sm">
            <CodeCard
              code={result.code}
              phone={phone}
              message={activationMessage({ guardianName, students, schoolName, code: result.code })}
              hint={`صالح حتى ${formatDate(result.expiresAt)}، ويُستخدم مرة واحدة. الرموز السابقة لم تعد صالحة.`}
            />
            <Text size="sm" c="dimmed">
              يفتح ولي الأمر صفحة التفعيل، يدخل الرمز ثم يختار رقماً سرياً من 4 إلى 6 أرقام.
            </Text>
          </Stack>
        )}
      </Modal>
    </>
  );
}
