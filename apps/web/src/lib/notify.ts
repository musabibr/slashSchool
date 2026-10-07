import { notifications } from '@mantine/notifications';
import { ApiError } from '../api/client';

export function notifySuccess(message: string) {
  notifications.show({ color: 'teal', message, autoClose: 2500 });
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const first = err.details?.[0]?.message;
    return first && err.code === 'bad_request' ? `${err.message}: ${first}` : err.message;
  }
  return 'حدث خطأ غير متوقع';
}

export function notifyError(err: unknown) {
  notifications.show({ color: 'red', title: 'تعذر إتمام العملية', message: errorMessage(err), autoClose: 5000 });
}
