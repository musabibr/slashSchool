import type { ReactNode } from 'react';
import {
  Anchor,
  Badge,
  Box,
  Button,
  Divider,
  Grid,
  Group,
  Paper,
  Progress,
  RingProgress,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconBuildingCommunity,
  IconCalendarEvent,
  IconCalendarX,
  IconCash,
  IconChalkboard,
  IconSpeakerphone,
  IconUserPlus,
  IconUsers,
  IconUserShield,
  IconUsersGroup,
} from '@tabler/icons-react';
import { Link } from 'react-router';
import { CALENDAR_KIND_LABELS, formatDate, formatMoney, WEEKDAY_LABELS, weekdayOf } from '@slash/shared';
import { AdminPage } from '../../../components/AdminPage';
import { QueryState } from '../../../components/States';
import { dayjs } from '../../../lib/dayjs';
import { useSchoolId } from '../../../lib/params';
import { useDashboard, type Dashboard } from './api';

/** Categorical slots 1 and 2 of the validated chart palette (blue / orange). */
const GENDER_COLORS = { male: '#2a78d6', female: '#eb6834' } as const;

const count = (n: number) => n.toLocaleString('en-US');
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function StatCard({ value, unit, icon, to }: { value: number; unit: string; icon: ReactNode; to: string }) {
  return (
    <Paper component={Link} to={to} withBorder radius="md" p="md" style={{ textDecoration: 'none', color: 'inherit' }}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Box>
          <Text fw={700} lh={1.1} style={{ fontSize: 30 }}>
            {count(value)}
          </Text>
          <Text c="dimmed" fw={600} mt={4}>
            {unit}
          </Text>
        </Box>
        <ThemeIcon size={40} radius="md" variant="light">
          {icon}
        </ThemeIcon>
      </Group>
    </Paper>
  );
}

function Swatch({ color }: { color: string }) {
  return <Box w={10} h={10} style={{ borderRadius: 3, background: color, flexShrink: 0 }} />;
}

function GenderCard({ gender }: { gender: Dashboard['gender'] }) {
  const total = gender.male + gender.female;
  const female = percent(gender.female, total);
  const male = total > 0 ? 100 - female : 0;
  return (
    <Paper withBorder radius="md" p="md" h="100%">
      <Title order={4} mb="sm">
        الطلاب حسب النوع
      </Title>
      {total === 0 ? (
        <Text c="dimmed" size="sm">
          لا يوجد طلاب منتظمون بعد
        </Text>
      ) : (
        <Group wrap="nowrap" gap="lg" justify="center">
          <RingProgress
            size={140}
            thickness={14}
            roundCaps={false}
            aria-label={`${female}% إناث / ${male}% ذكور`}
            sections={[
              { value: female, color: GENDER_COLORS.female, tooltip: `إناث: ${count(gender.female)}` },
              { value: male, color: GENDER_COLORS.male, tooltip: `ذكور: ${count(gender.male)}` },
            ]}
            label={
              <Text ta="center" fw={700} size="lg">
                {count(total)}
              </Text>
            }
          />
          <Stack gap="xs">
            <Text fw={700}>
              {female}% إناث / {male}% ذكور
            </Text>
            <Group gap={6} wrap="nowrap">
              <Swatch color={GENDER_COLORS.female} />
              <Text size="sm">إناث: {count(gender.female)}</Text>
            </Group>
            <Group gap={6} wrap="nowrap">
              <Swatch color={GENDER_COLORS.male} />
              <Text size="sm">ذكور: {count(gender.male)}</Text>
            </Group>
          </Stack>
        </Group>
      )}
    </Paper>
  );
}

/** A labelled ratio meter on a same-hue track. */
function Meter({ label, value, max, caption }: { label: string; value: number; max: number; caption: ReactNode }) {
  const pct = percent(Math.min(value, max), max);
  return (
    <Box>
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={600}>
          {label}
        </Text>
        <Text size="sm" fw={700}>
          {pct}%
        </Text>
      </Group>
      <Progress value={pct} size="lg" radius="sm" aria-label={label} styles={{ root: { background: 'var(--mantine-color-cyan-1)' } }} />
      <Text size="xs" c="dimmed" mt={4}>
        {caption}
      </Text>
    </Box>
  );
}

function StatsCard({ data, base }: { data: Dashboard; base: string }) {
  const { today, fees, byStage } = data;
  return (
    <Paper withBorder radius="md" p="md" h="100%">
      <Title order={4} mb="sm">
        إحصائيات
      </Title>
      <Stack gap="md">
        <Box>
          <Group justify="space-between" mb={6}>
            <Text size="sm" c="dimmed">
              غياب اليوم — {WEEKDAY_LABELS[weekdayOf(today.date)]} {formatDate(today.date)}
            </Text>
            <Anchor component={Link} to={`${base}/attendance`} size="sm">
              تسجيل الغياب
            </Anchor>
          </Group>
          {today.classes === 0 ? (
            <Text size="sm" c="dimmed">
              لا توجد فصول في العام الدراسي الحالي
            </Text>
          ) : (
            <Meter
              label="الفصول التي سُجّل غيابها"
              value={today.recorded}
              max={today.classes}
              caption={`${today.recorded} من ${today.classes} فصل · ${today.absent} غائب`}
            />
          )}
        </Box>
        <Divider />
        <Box>
          <Group justify="space-between" mb={6}>
            <Text size="sm" c="dimmed">
              الرسوم الدراسية — العام الحالي
            </Text>
            <Anchor component={Link} to={`${base}/fees`} size="sm">
              الرسوم الدراسية
            </Anchor>
          </Group>
          {fees.expected === 0 ? (
            <Text size="sm" c="dimmed">
              لم تُسجّل رسوم للطلاب بعد
            </Text>
          ) : (
            <>
              <Meter
                label="نسبة التحصيل"
                value={fees.collected}
                max={fees.expected}
                caption={`تم تحصيل ${formatMoney(fees.collected, true)} من ${formatMoney(fees.expected, true)}`}
              />
              {fees.overdue > 0 && (
                <Text size="sm" mt={6}>
                  <Text span c="red.8" fw={700}>
                    متأخرات:
                  </Text>{' '}
                  {formatMoney(fees.overdue, true)}
                </Text>
              )}
            </>
          )}
        </Box>
        {byStage.length > 0 && (
          <>
            <Divider />
            <Box>
              <Text size="sm" c="dimmed" mb={6}>
                الطلاب حسب المرحلة
              </Text>
              <Stack gap={4}>
                {byStage.map((st) => (
                  <Group key={st.stageName} justify="space-between">
                    <Text size="sm">{st.stageName}</Text>
                    <Text size="sm" fw={700}>
                      {count(st.count)} طالب
                    </Text>
                  </Group>
                ))}
              </Stack>
            </Box>
          </>
        )}
      </Stack>
    </Paper>
  );
}

function eventWhen(startsOn: string, endsOn: string, today: string): string {
  if (startsOn <= today && today <= endsOn) return 'جارٍ الآن';
  const days = dayjs(startsOn).diff(dayjs(today), 'day');
  if (days === 1) return 'غداً';
  return `بعد ${days} يوم`;
}

function EventsSection({ data, base }: { data: Dashboard; base: string }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" mb="sm">
        <Title order={4}>الأحداث القادمة</Title>
        <Anchor component={Link} to={`${base}/calendar`} size="sm">
          التقويم الدراسي
        </Anchor>
      </Group>
      {data.upcomingEvents.length === 0 ? (
        <Text size="sm" c="dimmed">
          لا توجد أحداث قادمة في التقويم
        </Text>
      ) : (
        <SimpleGrid cols={{ base: 1, xs: 2, md: 3, xl: 5 }} spacing="sm">
          {data.upcomingEvents.map((e) => (
            <Paper key={e.id} withBorder radius="md" p="sm" bg="gray.0">
              <Group justify="space-between" gap={4} mb={6} wrap="nowrap">
                <Text size="xs" c="dimmed" fw={600}>
                  حدث
                </Text>
                <Badge size="sm" variant="light" color="gray" radius="sm">
                  {CALENDAR_KIND_LABELS[e.kind]}
                </Badge>
              </Group>
              <Text fw={700} lineClamp={2}>
                {e.title}
              </Text>
              <Text size="sm" c="dimmed" mt={4}>
                {e.startsOn === e.endsOn
                  ? formatDate(e.startsOn)
                  : `${formatDate(e.startsOn)} – ${formatDate(e.endsOn)}`}
              </Text>
              <Text size="xs" fw={600} mt={2}>
                {eventWhen(e.startsOn, e.endsOn, data.today.date)}
              </Text>
            </Paper>
          ))}
        </SimpleGrid>
      )}
    </Paper>
  );
}

function AnnouncementsCard({ data, base }: { data: Dashboard; base: string }) {
  return (
    <Paper withBorder radius="md" p="md" h="100%">
      <Group justify="space-between" mb="sm">
        <Title order={4}>آخر الإعلانات</Title>
        <Anchor component={Link} to={`${base}/announcements`} size="sm">
          كل الإعلانات
        </Anchor>
      </Group>
      {data.recentAnnouncements.length === 0 ? (
        <Text size="sm" c="dimmed">
          لم تُرسل إعلانات بعد
        </Text>
      ) : (
        <Stack gap="xs">
          {data.recentAnnouncements.map((a) => (
            <Group key={a.id} justify="space-between" wrap="nowrap" gap="sm">
              <Text size="sm" fw={600} truncate>
                {a.title}
              </Text>
              <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                {dayjs(a.publishedAt).format('D/M/YYYY')}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

const QUICK_LINKS = [
  { to: 'students/new', label: 'تسجيل طالب جديد', icon: IconUserPlus },
  { to: 'attendance', label: 'تسجيل الغياب', icon: IconCalendarX },
  { to: 'announcements', label: 'إرسال إعلان', icon: IconSpeakerphone },
  { to: 'fees', label: 'الرسوم الدراسية', icon: IconCash },
  { to: 'calendar', label: 'التقويم', icon: IconCalendarEvent },
  { to: 'classes', label: 'الفصول والمواد', icon: IconBuildingCommunity },
];

function QuickLinks({ base }: { base: string }) {
  return (
    <Paper withBorder radius="md" p="md" h="100%">
      <Title order={4} mb="sm">
        روابط سريعة
      </Title>
      <SimpleGrid cols={2} spacing="xs">
        {QUICK_LINKS.map((l) => (
          <Button
            key={l.to}
            component={Link}
            to={`${base}/${l.to}`}
            variant="light"
            justify="flex-start"
            leftSection={<l.icon size={16} />}
          >
            {l.label}
          </Button>
        ))}
      </SimpleGrid>
    </Paper>
  );
}

/** D1 — director home: counters, gender split, today's statistics, events, announcements, quick links. */
export function AdminDashboardPage() {
  const schoolId = useSchoolId();
  const q = useDashboard(schoolId);
  const base = `/a/${schoolId}`;
  return (
    <AdminPage title="الرئيسية">
      <QueryState query={q}>
        {(data) => (
          <Stack gap="md">
            <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
              <StatCard value={data.counts.students} unit="طالب" icon={<IconUsers size={22} />} to={`${base}/students`} />
              <StatCard
                value={data.counts.supervisors}
                unit="مشرف"
                icon={<IconUserShield size={22} />}
                to={`${base}/supervisors`}
              />
              <StatCard
                value={data.counts.teachers}
                unit="استاذ"
                icon={<IconChalkboard size={22} />}
                to={`${base}/teachers`}
              />
              <StatCard
                value={data.counts.guardians}
                unit="ولي أمر"
                icon={<IconUsersGroup size={22} />}
                to={`${base}/guardians`}
              />
            </SimpleGrid>
            <Grid gutter="md" align="stretch">
              <Grid.Col span={{ base: 12, md: 5, lg: 4 }}>
                <GenderCard gender={data.gender} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 7, lg: 8 }}>
                <StatsCard data={data} base={base} />
              </Grid.Col>
            </Grid>
            <EventsSection data={data} base={base} />
            <Grid gutter="md" align="stretch">
              <Grid.Col span={{ base: 12, md: 7 }}>
                <AnnouncementsCard data={data} base={base} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 5 }}>
                <QuickLinks base={base} />
              </Grid.Col>
            </Grid>
          </Stack>
        )}
      </QueryState>
    </AdminPage>
  );
}
