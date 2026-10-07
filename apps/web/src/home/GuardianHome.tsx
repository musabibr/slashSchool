import { Anchor, Group, Text } from '@mantine/core';
import {
  IconBook,
  IconCalendarEvent,
  IconCalendarX,
  IconCash,
  IconFileCertificate,
  IconPencil,
  IconReportAnalytics,
  IconShieldCheck,
  IconSpeakerphone,
} from '@tabler/icons-react';
import { Link } from 'react-router';
import { BADGE_MODULE_LABELS, type BadgeModule } from '@slash/shared';
import { useMe, useStudentSummary } from '../api/hooks';
import { MobilePage } from '../components/MobilePage';
import { Tile, TileGrid } from '../components/Tiles';
import { useStudentId } from '../lib/params';

const TILES: Array<{ module: BadgeModule; path: string; icon: typeof IconBook }> = [
  { module: 'lessons', path: 'lessons', icon: IconBook },
  { module: 'homework', path: 'homework', icon: IconPencil },
  { module: 'attendance', path: 'attendance', icon: IconCalendarX },
  { module: 'fees', path: 'fees', icon: IconCash },
  { module: 'exams', path: 'exams', icon: IconFileCertificate },
  { module: 'results', path: 'results', icon: IconReportAnalytics },
  { module: 'behavior', path: 'behavior', icon: IconShieldCheck },
  { module: 'calendar', path: 'calendar', icon: IconCalendarEvent },
  { module: 'announcements', path: 'announcements', icon: IconSpeakerphone },
];

/** P3 — guardian home: nine tiles with unread badges. */
export function GuardianHome() {
  const studentId = useStudentId();
  const summary = useStudentSummary(studentId);
  const me = useMe();
  const multiple = (me.data?.children.length ?? 0) + (me.data?.schools.length ?? 0) > 1;
  const badges = summary.data?.badges;
  return (
    <MobilePage title={summary.data?.student.classLabel ?? 'القائمة'} back={false}>
      {multiple && (
        <Group justify="flex-end" mb="sm">
          <Anchor component={Link} to="/select?stay=1" size="sm">
            تبديل الطالب
          </Anchor>
        </Group>
      )}
      <TileGrid>
        {TILES.map((t) => (
          <Tile
            key={t.module}
            label={BADGE_MODULE_LABELS[t.module]}
            to={`/g/${studentId}/${t.path}`}
            icon={<t.icon size={30} stroke={1.5} color="var(--mantine-color-cyan-8)" />}
            badge={badges?.[t.module] ?? 0}
          />
        ))}
      </TileGrid>
      {summary.data?.student.status && summary.data.student.status !== 'active' && (
        <Text c="dimmed" size="sm" mt="md" ta="center">
          الطالب غير منتظم حالياً — تعرض البيانات السابقة فقط.
        </Text>
      )}
    </MobilePage>
  );
}
