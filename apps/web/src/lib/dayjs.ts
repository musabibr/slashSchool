import dayjs from 'dayjs';
import ar from 'dayjs/locale/ar';

/**
 * Arabic month/day names with Western digits (as in the sketch). dayjs' stock `ar` locale converts
 * digits to Arabic-Indic, so register a variant without the digit conversion.
 */
export const DATES_LOCALE = 'ar-sd';

dayjs.locale({ ...ar, name: DATES_LOCALE, preparse: undefined, postformat: undefined } as ILocale, undefined, true);

export { dayjs };
