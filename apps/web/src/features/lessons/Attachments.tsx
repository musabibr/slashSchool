import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ActionIcon,
  Anchor,
  Button,
  FileButton,
  Group,
  Image,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconFile, IconFileTypePdf, IconMovie, IconMusic, IconPaperclip, IconTrash } from '@tabler/icons-react';
import { api } from '../../api/client';
import { notifyError } from '../../lib/notify';
import { MAX_UPLOAD_BYTES, prepareUpload } from './compressImage';
import { formatSize, isImage } from './format';
import type { LessonAttachment } from './types';

/** Same limit as the API (lessons.schemas MAX_ATTACHMENTS). */
export const MAX_ATTACHMENTS = 10;
const ACCEPT = 'image/*,application/pdf,audio/*,video/mp4';

function FileTypeIcon({ mimeType, size = 18 }: { mimeType: string; size?: number }) {
  if (mimeType === 'application/pdf') return <IconFileTypePdf size={size} />;
  if (mimeType.startsWith('audio/')) return <IconMusic size={size} />;
  if (mimeType.startsWith('video/')) return <IconMovie size={size} />;
  return <IconFile size={size} />;
}

/** Read-only attachments of a lesson: image thumbnails (tap → full size), audio players, file links. */
export function AttachmentGallery({ attachments }: { attachments: LessonAttachment[] }) {
  const [preview, setPreview] = useState<LessonAttachment | null>(null);
  if (!attachments.length) return null;
  const images = attachments.filter((a) => isImage(a.mimeType));
  const audio = attachments.filter((a) => a.mimeType.startsWith('audio/'));
  const files = attachments.filter((a) => !isImage(a.mimeType) && !a.mimeType.startsWith('audio/'));
  return (
    <Stack gap="xs">
      {images.length > 0 && (
        <Group gap="xs">
          {images.map((img) => (
            <UnstyledButton key={img.id} onClick={() => setPreview(img)} aria-label={`عرض ${img.fileName}`}>
              <Image
                src={img.url}
                alt={img.fileName}
                w={76}
                h={76}
                radius="sm"
                fit="cover"
                loading="lazy"
                style={{ border: '1px solid var(--mantine-color-gray-3)' }}
              />
            </UnstyledButton>
          ))}
        </Group>
      )}
      {audio.map((a) => (
        <Stack key={a.id} gap={2}>
          <Text size="xs" c="dimmed" truncate>
            {a.fileName}
          </Text>
          <audio controls preload="none" src={a.url} style={{ width: '100%' }} />
        </Stack>
      ))}
      {files.map((f) => (
        <Anchor key={f.id} href={f.url} target="_blank" rel="noopener" size="sm">
          <Group gap={6} wrap="nowrap">
            <FileTypeIcon mimeType={f.mimeType} size={18} />
            <Text span size="sm" truncate>
              {f.fileName}
            </Text>
            <Text span size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              ({formatSize(f.size)})
            </Text>
          </Group>
        </Anchor>
      ))}
      <Modal opened={!!preview} onClose={() => setPreview(null)} title={preview?.fileName} size="lg" centered>
        {preview && (
          <Stack gap="xs">
            <Image src={preview.url} alt={preview.fileName} fit="contain" mah="75dvh" radius="sm" />
            <Anchor href={preview.url} target="_blank" rel="noopener" size="sm" ta="center">
              فتح الصورة بالحجم الكامل
            </Anchor>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

interface PendingUpload {
  key: number;
  fileName: string;
}

/**
 * "المرفقات" on the lesson form: pick files (images are compressed first), upload each to the school's
 * file store and list them with a remove button. Reports `busy` while uploads are running.
 */
export function AttachmentEditor({
  schoolId,
  value,
  setValue,
  onBusyChange,
}: {
  schoolId: string;
  value: LessonAttachment[];
  setValue: Dispatch<SetStateAction<LessonAttachment[]>>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const nextKey = useRef(0);
  const resetRef = useRef<() => void>(null);
  const remaining = MAX_ATTACHMENTS - value.length - pending.length;

  useEffect(() => onBusyChange(pending.length > 0), [pending.length, onBusyChange]);

  async function uploadOne(file: File, key: number) {
    try {
      const prepared = await prepareUpload(file);
      if (prepared.blob.size > MAX_UPLOAD_BYTES) {
        notifications.show({
          color: 'red',
          title: 'تعذر رفع الملف',
          message: `${file.name}: حجم الملف أكبر من 5 ميجابايت`,
          autoClose: 5000,
        });
        return;
      }
      const uploaded = await api.upload(schoolId, prepared.blob, prepared.fileName);
      setValue((list) => [...list, uploaded]);
    } catch (err) {
      notifyError(err);
    } finally {
      setPending((list) => list.filter((p) => p.key !== key));
    }
  }

  async function add(files: File[]) {
    resetRef.current?.();
    if (!files.length) return;
    const batch = files.slice(0, Math.max(0, remaining));
    if (batch.length < files.length) {
      notifications.show({ color: 'orange', message: `الحد الأقصى ${MAX_ATTACHMENTS} مرفقات للدرس الواحد` });
    }
    const queued = batch.map((file) => ({ file, key: nextKey.current++ }));
    setPending((list) => [...list, ...queued.map(({ file, key }) => ({ key, fileName: file.name }))]);
    // One at a time: decoding several large photos at once can exhaust memory on low-end phones.
    for (const { file, key } of queued) await uploadOne(file, key);
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text fw={500} size="sm">
          المرفقات
        </Text>
        <Text size="xs" c="dimmed">
          {value.length} / {MAX_ATTACHMENTS}
        </Text>
      </Group>
      {value.map((a) => (
        <Paper key={a.id} withBorder p="xs" radius="sm">
          <Group wrap="nowrap" gap="sm">
            {isImage(a.mimeType) ? (
              <Image src={a.url} alt={a.fileName} w={44} h={44} radius="sm" fit="cover" />
            ) : (
              <ThemeIcon variant="light" size={44} radius="sm">
                <FileTypeIcon mimeType={a.mimeType} size={22} />
              </ThemeIcon>
            )}
            <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
              <Anchor href={a.url} target="_blank" rel="noopener" size="sm" truncate>
                {a.fileName}
              </Anchor>
              <Text size="xs" c="dimmed">
                {formatSize(a.size)}
              </Text>
            </Stack>
            <ActionIcon
              variant="subtle"
              color="red"
              size="lg"
              aria-label={`إزالة ${a.fileName}`}
              onClick={() => setValue((list) => list.filter((x) => x.id !== a.id))}
            >
              <IconTrash size={18} />
            </ActionIcon>
          </Group>
        </Paper>
      ))}
      {pending.map((p) => (
        <Paper key={p.key} withBorder p="xs" radius="sm">
          <Group wrap="nowrap" gap="sm">
            <Loader size="sm" />
            <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
              {p.fileName}
            </Text>
            <Text size="xs" c="dimmed">
              جاري الرفع…
            </Text>
          </Group>
        </Paper>
      ))}
      <FileButton onChange={add} accept={ACCEPT} multiple resetRef={resetRef}>
        {(props) => (
          <Button {...props} variant="default" leftSection={<IconPaperclip size={18} />} disabled={remaining <= 0}>
            إضافة مرفقات (صور، PDF، صوت)
          </Button>
        )}
      </FileButton>
    </Stack>
  );
}
