// تبدیل و قالب‌بندی تاریخ شمسی (جلالی) — پیاده‌سازی داخلی الگوریتم استاندارد
// تبدیل تاریخ میلادی ⇄ جلالی، بدون نیاز به وابستگی خارجی؛ در پایگاه‌داده
// تاریخ‌ها همیشه به‌صورت میلادی (DATE/TIMESTAMPTZ) ذخیره می‌شوند و فقط در
// رابط کاربری به شمسی نمایش داده می‌شوند.

export const FA_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function toFaDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

function div(a: number, b: number): number { return Math.floor(a / b); }

// تبدیل میلادی به جلالی (خروجی: [سال، ماه(1..12)، روز])
export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) - 80 +
    gd + g_d_m[gm - 1];
  jy += 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) { jy += div(days - 1, 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

// تبدیل جلالی به میلادی (خروجی: [سال، ماه(1..12)، روز])
export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  let gy = jy <= 979 ? 621 : 1600;
  jy -= jy <= 979 ? 0 : 979;
  let days =
    365 * jy + div(jy, 33) * 8 + div((jy % 33) + 3, 4) + 78 + jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  gy += 400 * div(days, 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * div(--days, 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) { gy += div(days - 1, 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const sal_a = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 1; gm <= 12 && gd > sal_a[gm]; gm++) gd -= sal_a[gm];
  return [gy, gm, gd];
}

// «امروز» به وقت تهران به‌صورت رشته ISO میلادی YYYY-MM-DD
export function todayISO(): string {
  const now = new Date();
  const tehran = new Date(now.getTime() + (3.5 * 60 + now.getTimezoneOffset()) * 60000);
  const y = tehran.getFullYear();
  const m = String(tehran.getMonth() + 1).padStart(2, '0');
  const d = String(tehran.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ساعت محلی (تهران) به شکل HH:MM
export function tehranTime(value?: string): string {
  const date = value ? new Date(value) : new Date();
  const tehran = new Date(date.getTime() + (3.5 * 60 + date.getTimezoneOffset()) * 60000);
  return `${String(tehran.getHours()).padStart(2, '0')}:${String(tehran.getMinutes()).padStart(2, '0')}`;
}

// تاریخ ISO میلادی (YYYY-MM-DD یا TIMESTAMP) به «۱۴۰۳/۰۵/۱۲» شمسی
export function faDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [jy, jm, jd] = gregorianToJalali(Number(m[1]), Number(m[2]), Number(m[3]));
  return toFaDigits(`${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`);
}

// تاریخ و ساعت ثبت به‌صورت «۱۴۰۳/۰۵/۱۲ - ۱۴:۳۰»
export function faDateTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  return `${faDate(ts)} - ${toFaDigits(tehranTime(ts))}`;
}

// تاریخ کامل شمسی «۱۲ مرداد ۱۴۰۳»
export function faDateLong(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [jy, jm, jd] = gregorianToJalali(Number(m[1]), Number(m[2]), Number(m[3]));
  return toFaDigits(`${jd} ${FA_MONTHS[jm - 1]} ${jy}`);
}

// روز هفته یک تاریخ میلادی ISO؛ 5 = جمعه (getDay: 0 یکشنبه ... 6 شنبه)
export function isoWeekday(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

// ورودی تاریخ شمسی کاربر «۱۴۰۳/۰۵/۱۲» به ISO میلادی؛ خروجی null اگر نامعتبر
export function jalaliInputToISO(input: string): string | null {
  const clean = input.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d))).replace(/[^\d]/g, '/');
  const parts = clean.split('/').filter(Boolean).map(Number);
  if (parts.length !== 3) return null;
  const [jy, jm, jd] = parts;
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd)) return null;
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  // اعتبارسنجی برگشتی: روز ۳۰/۳۱ اسفند در سال کبیسه ممکن نیست
  const [ry, rm, rd] = gregorianToJalali(gy, gm, gd);
  if (ry !== jy || rm !== jm || rd !== jd) return null;
  return `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
}

// ISO میلادی به متن ورودی شمسی «۱۴۰۳/۰۵/۱۲» برای پرکردن فرم
export function isoToJalaliInput(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  const [jy, jm, jd] = gregorianToJalali(Number(m[1]), Number(m[2]), Number(m[3]));
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}
