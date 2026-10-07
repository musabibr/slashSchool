import { Fragment, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  FileButton,
  Group,
  List,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCircleCheck,
  IconDownload,
  IconFileSpreadsheet,
  IconListCheck,
  IconUpload,
  IconWand,
} from '@tabler/icons-react';
import Papa from 'papaparse';
import { Link } from 'react-router';
import { GENDER_LABELS, joinName, RELATION_LABELS, whatsappLink } from '@slash/shared';
import { usePublicConfig, useScope } from '../../../api/hooks';
import { AdminPage } from '../../../components/AdminPage';
import { notifyError } from '../../../lib/notify';
import { useSchoolId } from '../../../lib/params';
import { useImportStudents, type ImportCode, type ImportResult, type ImportRow } from './api';
import { activationMessage, demoPerson, downloadCsv } from './helpers';
import { CodeActions, useSchoolName } from './shared';

const MAX_ROWS = 2000;
/** Rows shown in the preview table (the whole file is still validated and imported). */
const PREVIEW_ROWS = 200;

type Field = keyof ImportRow;

/** Template columns, in order. `*` marks the required ones (stripped when reading headers back). */
const COLUMNS: Array<{ field: Field; header: string; required?: boolean; aliases?: string[] }> = [
  { field: 'studentFirstName', header: 'الاسم الاول', required: true, aliases: ['اسم الطالب', 'studentFirstName'] },
  { field: 'studentFatherName', header: 'الاسم الثاني', required: true, aliases: ['studentFatherName'] },
  { field: 'studentGrandfatherName', header: 'الاسم الثالث', required: true, aliases: ['studentGrandfatherName'] },
  { field: 'studentGreatGrandfatherName', header: 'الاسم الرابع', aliases: ['studentGreatGrandfatherName'] },
  { field: 'gender', header: 'الجنس', required: true, aliases: ['النوع', 'gender'] },
  { field: 'gradeLevel', header: 'السنة الدراسية', required: true, aliases: ['الصف', 'gradeLevel'] },
  { field: 'classSection', header: 'الفصل', aliases: ['الشعبة', 'classSection'] },
  { field: 'birthDate', header: 'تاريخ الميلاد', aliases: ['birthDate'] },
  { field: 'guardianName', header: 'اسم ولي الامر', required: true, aliases: ['guardianName'] },
  {
    field: 'guardianPhone',
    header: 'رقم ولي الامر',
    required: true,
    aliases: ['هاتف ولي الامر', 'جوال ولي الامر', 'guardianPhone'],
  },
  { field: 'relation', header: 'صلة القرابة', aliases: ['relation'] },
  { field: 'motherName', header: 'اسم الوالدة', aliases: ['motherName'] },
  { field: 'motherPhone', header: 'رقم الوالدة', aliases: ['هاتف الوالدة', 'motherPhone'] },
];

/** Header key: no BOM, '*', extra spaces or alef/taa-marbuta variants; lower-case. */
const headerKey = (h: string) =>
  h
    .replace(/^﻿/, '')
    .replace(/\*/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const HEADER_TO_FIELD = new Map<string, Field>();
for (const c of COLUMNS) {
  for (const h of [c.header, ...(c.aliases ?? [])]) HEADER_TO_FIELD.set(headerKey(h), c.field);
}

interface ParsedFile {
  name: string;
  rows: ImportRow[];
  unknownHeaders: string[];
  missingColumns: string[];
  garbled: boolean;
  tooMany: boolean;
}

function toImportRows(records: Array<Record<string, string>>, headers: string[]): ParsedFile['rows'] {
  const fieldOf = new Map(headers.map((h) => [h, HEADER_TO_FIELD.get(headerKey(h))]));
  return records.map((rec) => {
    const row: Partial<Record<Field, string>> = {};
    for (const [h, value] of Object.entries(rec)) {
      const field = fieldOf.get(h);
      const v = (value ?? '').trim();
      if (field && v) row[field] = v;
    }
    return {
      studentFirstName: row.studentFirstName ?? '',
      studentFatherName: row.studentFatherName ?? '',
      studentGrandfatherName: row.studentGrandfatherName ?? '',
      gender: row.gender ?? '',
      gradeLevel: row.gradeLevel ?? '',
      guardianName: row.guardianName ?? '',
      guardianPhone: row.guardianPhone ?? '',
      ...row,
    };
  });
}

function parseCsv(file: File): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.replace(/^﻿/, '').trim(),
      complete: (result) => {
        const headers = (result.meta.fields ?? []).filter(Boolean);
        const known = new Set(headers.map((h) => HEADER_TO_FIELD.get(headerKey(h))).filter(Boolean));
        const rows = toImportRows(result.data, headers);
        resolve({
          name: file.name,
          rows,
          unknownHeaders: headers.filter((h) => !HEADER_TO_FIELD.has(headerKey(h))),
          missingColumns: COLUMNS.filter((c) => c.required && !known.has(c.field)).map((c) => c.header),
          garbled: [...headers, ...result.data.slice(0, 20).flatMap((r) => Object.values(r))].some((v) =>
            String(v ?? '').includes('�'),
          ),
          tooMany: rows.length > MAX_ROWS,
        });
      },
      error: (err) => reject(err),
    });
  });
}

/** Demo mode: a ready-made file of random students for the school's grade levels. */
function demoRows(classes: Array<{ gradeLevelName: string; name: string }>, count = 12): ImportRow[] {
  return Array.from({ length: count }, (_, i) => {
    const p = demoPerson();
    const cls = classes.length ? classes[i % classes.length] : null;
    return {
      studentFirstName: p.firstName,
      studentFatherName: p.fatherName,
      studentGrandfatherName: p.grandfatherName,
      studentGreatGrandfatherName: p.greatGrandfatherName,
      gender: GENDER_LABELS[p.gender],
      gradeLevel: cls?.gradeLevelName ?? 'الصف الخامس',
      classSection: cls?.name ?? '',
      birthDate: p.birthDate,
      guardianName: joinName(p.guardian.firstName, p.guardian.fatherName, p.guardian.grandfatherName),
      guardianPhone: p.guardian.phone,
      relation: RELATION_LABELS.father,
      motherName: joinName(p.mother.firstName, p.mother.fatherName, p.mother.grandfatherName),
      motherPhone: p.mother.phone,
    };
  });
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Group gap="xs" mb="sm">
        <Badge circle size="lg">
          {n}
        </Badge>
        <Title order={4}>{title}</Title>
      </Group>
      {children}
    </Paper>
  );
}

function ImportDone({
  result,
  schoolName,
  onAnother,
}: {
  result: ImportResult & { created: number; codes: ImportCode[] };
  schoolName: string;
  onAnother: () => void;
}) {
  const message = (c: ImportCode) =>
    activationMessage({ guardianName: c.guardianName, students: c.students, schoolName, code: c.code });
  const downloadCodes = () =>
    downloadCsv(
      'رموز-تفعيل-أولياء-الأمور.csv',
      ['اسم ولي الامر', 'رقم ولي الامر', 'رمز التفعيل', 'الطلاب', 'رابط واتساب'],
      result.codes.map((c) => [c.guardianName, c.phone, c.code, c.students.join('، '), whatsappLink(c.phone, message(c))]),
    );
  return (
    <Stack gap="md">
      <Alert color="teal" icon={<IconCircleCheck />} title={`تم استيراد ${result.created} طالب`}>
        {result.codes.length
          ? `تم إصدار ${result.codes.length} رمز تفعيل لأولياء الأمور الجدد. حمّل الملف الآن — لن تظهر الرموز مرة أخرى (يمكن إصدار رمز جديد من صفحة أولياء الأمور).`
          : 'كل أولياء الأمور لديهم حسابات مفعلة مسبقاً، لا توجد رموز تفعيل جديدة.'}
      </Alert>
      <Group>
        {result.codes.length > 0 && (
          <Button leftSection={<IconDownload size={16} />} onClick={downloadCodes}>
            تحميل رموز التفعيل (CSV)
          </Button>
        )}
        <Button variant="default" onClick={onAnother}>
          استيراد ملف آخر
        </Button>
      </Group>
      {result.codes.length > 0 && (
        <div className="table-scroll">
          <Table verticalSpacing="xs" miw={720}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>ولي الأمر</Table.Th>
                <Table.Th>رقم الهاتف</Table.Th>
                <Table.Th>الطلاب</Table.Th>
                <Table.Th>رمز التفعيل</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {result.codes.slice(0, PREVIEW_ROWS).map((c) => (
                <Table.Tr key={c.phone}>
                  <Table.Td>{c.guardianName}</Table.Td>
                  <Table.Td dir="ltr" style={{ textAlign: 'right' }}>
                    {c.phone}
                  </Table.Td>
                  <Table.Td>{c.students.join('، ')}</Table.Td>
                  <Table.Td ff="monospace" dir="ltr" style={{ textAlign: 'right' }}>
                    {c.code}
                  </Table.Td>
                  <Table.Td>
                    <CodeActions code={c.code} phone={c.phone} message={message(c)} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {result.codes.length > PREVIEW_ROWS && (
            <Text size="sm" c="dimmed" mt="xs">
              يعرض أول {PREVIEW_ROWS} رمز من {result.codes.length} — كل الرموز في ملف CSV.
            </Text>
          )}
        </div>
      )}
    </Stack>
  );
}

/** CSV import of students and their guardians: template → upload → validate (dry run) → import → codes. */
export function StudentImportPage() {
  const schoolId = useSchoolId();
  const scope = useScope(schoolId);
  const schoolName = useSchoolName(schoolId);
  const demoMode = usePublicConfig().data?.demoMode ?? false;
  const run = useImportStudents(schoolId);
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [check, setCheck] = useState<{ rows: ImportRow[]; result: ImportResult } | null>(null);
  const [done, setDone] = useState<(ImportResult & { created: number; codes: ImportCode[] }) | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const classes = scope.data?.classes ?? [];
  const checked = check && file && check.rows === file.rows ? check.result : null;
  const errorsByRow = useMemo(() => new Map((checked?.errors ?? []).map((e) => [e.row, e.messages])), [checked]);
  const blocking = !file || !file.rows.length || file.tooMany || file.missingColumns.length > 0;

  const downloadTemplate = () =>
    downloadCsv(
      'نموذج-استيراد-الطلاب.csv',
      COLUMNS.map((c) => (c.required ? `${c.header} *` : c.header)),
      [],
    );

  const onFile = async (f: File | null) => {
    if (!f) return;
    try {
      setFile(await parseCsv(f));
      setCheck(null);
    } catch (err) {
      notifyError(err);
    }
  };

  const validate = () => {
    if (!file) return;
    const rows = file.rows;
    run.mutate({ rows, dryRun: true }, { onSuccess: (result) => setCheck({ rows, result }), onError: notifyError });
  };

  const doImport = () => {
    if (!file) return;
    const rows = file.rows;
    run.mutate(
      { rows, dryRun: false },
      {
        onSuccess: (result) => {
          if (result.valid && result.created !== undefined) {
            setDone({ ...result, created: result.created, codes: result.codes ?? [] });
          } else setCheck({ rows, result });
        },
        onError: notifyError,
      },
    );
  };

  const reset = () => {
    setFile(null);
    setCheck(null);
    setDone(null);
    setResetKey((k) => k + 1);
  };

  const example = classes[0];

  return (
    <AdminPage
      title="استيراد الطلاب"
      subtitle="تسجيل عدد كبير من الطلاب وأولياء أمورهم من ملف CSV"
      actions={
        <Button variant="default" component={Link} to={`/a/${schoolId}/students`} leftSection={<IconArrowRight size={16} />}>
          الرجوع
        </Button>
      }
    >
      {done ? (
        <ImportDone result={done} schoolName={schoolName} onAnother={reset} />
      ) : (
        <Stack gap="md">
          <Step n={1} title="تحميل النموذج">
            <Stack gap="sm">
              <Text size="sm">
                حمّل النموذج واملأه في Excel أو Google Sheets — صف لكل طالب — ثم احفظه بصيغة{' '}
                <Text span fw={700} inherit>
                  CSV UTF-8
                </Text>
                . الأعمدة المميزة بـ * مطلوبة.
              </Text>
              <List size="sm" spacing={2}>
                <List.Item>الجنس: ذكر أو أنثى.</List.Item>
                <List.Item>
                  السنة الدراسية والفصل كما في صفحة الفصول والمواد{example ? ` (مثال: ${example.gradeLevelName} / ${example.name})` : ''}
                  ، والفصل اختياري.
                </List.Item>
                <List.Item>تاريخ الميلاد اختياري بصيغة 2015-03-04 أو 4/3/2015.</List.Item>
                <List.Item>
                  صلة القرابة اختيارية (والد، والدة، أخ، أخت، عم / خال، جد / جدة، أخرى) — والافتراضي والد.
                </List.Item>
                <List.Item>الأبناء الذين لهم نفس رقم ولي الأمر يُربطون بحساب واحد.</List.Item>
              </List>
              <Group>
                <Button variant="light" leftSection={<IconFileSpreadsheet size={16} />} onClick={downloadTemplate}>
                  تحميل نموذج CSV
                </Button>
                {demoMode && (
                  <Button
                    variant="light"
                    color="grape"
                    leftSection={<IconWand size={16} />}
                    onClick={() => {
                      setFile({
                        name: 'ملف تجريبي',
                        rows: demoRows(classes),
                        unknownHeaders: [],
                        missingColumns: [],
                        garbled: false,
                        tooMany: false,
                      });
                      setCheck(null);
                    }}
                  >
                    تجربة ببيانات تجريبية
                  </Button>
                )}
              </Group>
            </Stack>
          </Step>

          <Step n={2} title="رفع الملف">
            <Stack gap="sm">
              <Group>
                <FileButton key={resetKey} onChange={onFile} accept=".csv,text/csv">
                  {(props) => (
                    <Button {...props} leftSection={<IconUpload size={16} />}>
                      اختيار ملف CSV
                    </Button>
                  )}
                </FileButton>
                {file && (
                  <Text size="sm" c="dimmed">
                    {file.name} — {file.rows.length} صف
                  </Text>
                )}
              </Group>
              {file?.garbled && (
                <Alert color="orange" icon={<IconAlertTriangle />}>
                  يبدو أن الحروف العربية في الملف غير مقروءة. احفظ الملف من Excel بصيغة «CSV UTF-8» ثم ارفعه مرة أخرى.
                </Alert>
              )}
              {file && file.missingColumns.length > 0 && (
                <Alert color="red" icon={<IconAlertTriangle />} title="أعمدة مطلوبة غير موجودة">
                  {file.missingColumns.join('، ')} — استخدم النموذج بنفس عناوين الأعمدة.
                </Alert>
              )}
              {file && file.unknownHeaders.length > 0 && (
                <Text size="sm" c="orange.8">
                  أعمدة غير معروفة سيتم تجاهلها: {file.unknownHeaders.join('، ')}
                </Text>
              )}
              {file?.tooMany && (
                <Alert color="red" icon={<IconAlertTriangle />}>
                  الملف يحتوي على {file.rows.length} صف، والحد الأقصى {MAX_ROWS} طالب في المرة الواحدة — قسّم الملف.
                </Alert>
              )}
              {file && !file.rows.length && (
                <Alert color="orange" icon={<IconAlertTriangle />}>
                  الملف لا يحتوي على صفوف.
                </Alert>
              )}
            </Stack>
          </Step>

          {file && file.rows.length > 0 && (
            <Step n={3} title="مراجعة البيانات والاستيراد">
              <Stack gap="sm">
                {checked &&
                  (checked.valid ? (
                    <Alert color="teal" icon={<IconCircleCheck />}>
                      جميع الصفوف ({checked.rowCount}) صالحة — يمكنك الاستيراد الآن.
                    </Alert>
                  ) : (
                    <Alert color="red" icon={<IconAlertTriangle />} title={`${checked.errors.length} صف به أخطاء`}>
                      <Text size="sm" mb="xs">
                        صحح الأخطاء في الملف ثم ارفعه مرة أخرى. لن يتم استيراد أي طالب حتى تصبح كل الصفوف صالحة.
                      </Text>
                      <ScrollArea.Autosize mah={220}>
                        <Stack gap={4}>
                          {checked.errors.map((e) => (
                            <Text key={e.row} size="sm">
                              <Text span fw={700} inherit>
                                الصف {e.row}:
                              </Text>{' '}
                              {e.messages.join('، ')}
                            </Text>
                          ))}
                        </Stack>
                      </ScrollArea.Autosize>
                    </Alert>
                  ))}

                <ScrollArea.Autosize mah={460} type="auto">
                  <Table verticalSpacing={6} miw={900} stickyHeader>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>#</Table.Th>
                        <Table.Th>إسم الطالب</Table.Th>
                        <Table.Th>الجنس</Table.Th>
                        <Table.Th>السنة الدراسية</Table.Th>
                        <Table.Th>الفصل</Table.Th>
                        <Table.Th>تاريخ الميلاد</Table.Th>
                        <Table.Th>ولي الأمر</Table.Th>
                        <Table.Th>رقم ولي الأمر</Table.Th>
                        <Table.Th>صلة القرابة</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {file.rows.slice(0, PREVIEW_ROWS).map((r, i) => {
                        const errors = errorsByRow.get(i + 1);
                        return (
                          <Fragment key={i}>
                            <Table.Tr bg={errors ? 'red.0' : undefined}>
                            <Table.Td>{i + 1}</Table.Td>
                            <Table.Td>
                              {joinName(
                                r.studentFirstName,
                                r.studentFatherName,
                                r.studentGrandfatherName,
                                r.studentGreatGrandfatherName,
                              )}
                            </Table.Td>
                            <Table.Td>{r.gender}</Table.Td>
                            <Table.Td>{r.gradeLevel}</Table.Td>
                            <Table.Td>{r.classSection}</Table.Td>
                            <Table.Td dir="ltr" style={{ textAlign: 'right' }}>
                              {r.birthDate}
                            </Table.Td>
                            <Table.Td>{r.guardianName}</Table.Td>
                            <Table.Td dir="ltr" style={{ textAlign: 'right' }}>
                              {r.guardianPhone}
                            </Table.Td>
                            <Table.Td>{r.relation}</Table.Td>
                          </Table.Tr>
                          {errors && (
                            <Table.Tr bg="red.0">
                              <Table.Td />
                              <Table.Td colSpan={8}>
                                <Text size="xs" c="red.8">
                                  {errors.join('، ')}
                                </Text>
                              </Table.Td>
                            </Table.Tr>
                          )}
                          </Fragment>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
                {file.rows.length > PREVIEW_ROWS && (
                  <Text size="sm" c="dimmed">
                    يعرض أول {PREVIEW_ROWS} صف من {file.rows.length} — يتم التحقق من كل الصفوف واستيرادها.
                  </Text>
                )}

                <Group>
                  <Button
                    variant="light"
                    leftSection={<IconListCheck size={16} />}
                    onClick={validate}
                    loading={run.isPending && run.variables?.dryRun}
                    disabled={blocking}
                  >
                    التحقق من البيانات
                  </Button>
                  <Button
                    leftSection={<IconUpload size={16} />}
                    onClick={doImport}
                    loading={run.isPending && run.variables?.dryRun === false}
                    disabled={blocking || !checked?.valid}
                  >
                    استيراد {file.rows.length} طالب
                  </Button>
                  {!checked && (
                    <Text size="sm" c="dimmed">
                      تحقق من البيانات أولاً.
                    </Text>
                  )}
                </Group>
              </Stack>
            </Step>
          )}
        </Stack>
      )}
    </AdminPage>
  );
}
