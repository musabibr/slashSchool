import { Anchor, Group } from '@mantine/core';
import {
  IconBook,
  IconCalendarX,
  IconFileCertificate,
  IconListNumbers,
  IconShieldCheck,
  IconStars,
  IconTable,
} from '@tabler/icons-react';
import { Link } from 'react-router';
import { useMe, useScope } from '../api/hooks';
import { MobilePage } from '../components/MobilePage';
import { Tile, TileGrid } from '../components/Tiles';
import { useSchoolId } from '../lib/params';

interface StaffTile {
  path: string;
  label: string;
  icon: typeof IconBook;
}

/** S3 — supervisor menu (admins opening the staff app get the same). */
const SUPERVISOR_TILES: StaffTile[] = [
  { path: 'lessons', label: 'درس اليوم', icon: IconBook },
  { path: 'attendance', label: 'الغياب', icon: IconCalendarX },
  { path: 'exams', label: 'الإمتحانات', icon: IconFileCertificate },
  { path: 'grades', label: 'الدرجات', icon: IconListNumbers },
  { path: 'behavior', label: 'السلوك والإنضباط', icon: IconShieldCheck },
  { path: 'timetable', label: 'الجداول الدراسية', icon: IconTable },
  { path: 'evaluation', label: 'تقييم الطلاب', icon: IconStars },
];

/** T2 — teacher menu. */
const TEACHER_TILES: StaffTile[] = [
  { path: 'lessons', label: 'درس اليوم', icon: IconBook },
  { path: 'grades', label: 'الدرجات', icon: IconListNumbers },
  { path: 'timetable', label: 'جدول الحصص', icon: IconTable },
  { path: 'evaluation', label: 'تقييم الطلاب', icon: IconStars },
  { path: 'exams', label: 'الاختبارات', icon: IconFileCertificate },
];

export function StaffHome() {
  const schoolId = useSchoolId();
  const scope = useScope(schoolId);
  const me = useMe();
  const roles = scope.data?.school.roles ?? [];
  const tiles = roles.some((r) => r === 'supervisor' || r === 'admin') ? SUPERVISOR_TILES : TEACHER_TILES;
  const multiple = (me.data?.children.length ?? 0) + (me.data?.schools.length ?? 0) > 1;
  return (
    <MobilePage title="القائمة" back={false}>
      {multiple && (
        <Group justify="flex-end" mb="sm">
          <Anchor component={Link} to="/select?stay=1" size="sm">
            تبديل
          </Anchor>
        </Group>
      )}
      <TileGrid>
        {tiles.map((t) => (
          <Tile
            key={t.path}
            label={t.label}
            to={`/s/${schoolId}/${t.path}`}
            icon={<t.icon size={30} stroke={1.5} color="var(--mantine-color-cyan-8)" />}
          />
        ))}
      </TileGrid>
    </MobilePage>
  );
}
