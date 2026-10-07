import { createTheme } from '@mantine/core';

const font = '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, system-ui, sans-serif';

export const theme = createTheme({
  primaryColor: 'cyan',
  primaryShade: { light: 8, dark: 7 },
  fontFamily: font,
  headings: { fontFamily: font, fontWeight: '700' },
  defaultRadius: 'md',
  cursorType: 'pointer',
});
