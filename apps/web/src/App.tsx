import { DirectionProvider, MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { Notifications } from '@mantine/notifications';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { ApiError } from './api/client';
import { DATES_LOCALE } from './lib/dayjs';
import { router } from './routes';
import { theme } from './theme';

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // Session expired somewhere → drop the cached user so RequireAuth sends us to /login.
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) queryClient.setQueryData(['me'], null);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

export function App() {
  return (
    <DirectionProvider initialDirection="rtl" detectDirection={false}>
      <MantineProvider theme={theme} forceColorScheme="light">
        <DatesProvider settings={{ locale: DATES_LOCALE, firstDayOfWeek: 0, weekendDays: [5, 6] }}>
          <Notifications position="top-center" />
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </DatesProvider>
      </MantineProvider>
    </DirectionProvider>
  );
}
