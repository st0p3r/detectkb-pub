// Builds the DetectKB lab setup guide (Persian, RTL) as a .docx.
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType, LevelFormat,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, PageBreak, Footer, Header,
  PageNumber, TabStopType,
} = require('docx');

const IMG = path.join(__dirname, 'img');
const sizes = { topology: [1640, 1080], flow: [1640, 1064] };

// ── Look ────────────────────────────────────────────────────────────────
const FONT_FA = 'Tahoma';
const FONT_EN = 'Segoe UI';
const FONT_CODE = 'Consolas';
const INK = '1B2533';
const MUTED = '5B6878';
const ACCENT = '0B6E79';
const NOTE_BG = 'E6F2F3';
const WARN_BG = 'FBEFE3';
const WARN = 'A2520C';
const TEXT_W = 9638; // A4 minus 2 cm margins, in DXA
const MAX_IMG_W = 610; // px

const font = { ascii: FONT_EN, hAnsi: FONT_EN, cs: FONT_FA, eastAsia: FONT_EN };

// ── Inline markup: **bold**, `code` ─────────────────────────────────────
function runs(text, base = {}) {
  const out = [];
  for (const part of String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
    if (!part) continue;
    if (part.startsWith('**')) {
      const t = part.slice(2, -2);
      const latin = !/[؀-ۿ]/.test(t);
      out.push(new TextRun({ text: t, bold: true, boldComplexScript: true, rightToLeft: !latin, font, ...base }));
    } else if (part.startsWith('`')) {
      out.push(new TextRun({ text: `\u200E${part.slice(1, -1)}\u200E`, font: { ascii: FONT_CODE, hAnsi: FONT_CODE, cs: FONT_CODE }, size: 19, color: ACCENT, rightToLeft: false }));
    } else {
      out.push(new TextRun({ text: part, rightToLeft: true, font, ...base }));
    }
  }
  return out;
}

const P = (text, opts = {}) =>
  new Paragraph({ bidirectional: true, alignment: AlignmentType.BOTH, spacing: { after: 120 }, ...opts, children: runs(text, opts.run) });

const H1 = (text, first = false) =>
  new Paragraph({ heading: HeadingLevel.HEADING_1, bidirectional: true, pageBreakBefore: !first, children: runs(text) });
const H2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, bidirectional: true, children: runs(text) });
const H3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, bidirectional: true, children: runs(text) });

const UL = (items) => items.map((t) => new Paragraph({ bidirectional: true, numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: runs(t) }));
let olCount = 0;
const OL = (items) => {
  const ref = `steps-${olCount++}`;
  numberingConfigs.push({
    reference: ref,
    levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 560, hanging: 360 } }, run: { font, bold: true, color: ACCENT } } }],
  });
  return items.map((t) => new Paragraph({ bidirectional: true, numbering: { reference: ref, level: 0 }, spacing: { after: 80 }, children: runs(t) }));
};

let figNo = 0;
function IMGP(name, caption, maxW = MAX_IMG_W, maxH = 560) {
  const [w0, h0] = sizes[name];
  const scale = Math.min(maxW / w0, maxH / h0, 1);
  figNo++;
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 60, line: 240, lineRule: 'auto' },
      keepNext: true,
      children: [new ImageRun({ type: 'jpg', data: fs.readFileSync(path.join(IMG, `${name}.jpg`)), transformation: { width: Math.round(w0 * scale), height: Math.round(h0 * scale) } })],
    }),
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 220 },
      children: runs(`شکل ${figNo.toLocaleString('fa-IR')} — ${caption}`, { size: 18, sizeComplexScript: 18, color: MUTED }),
    }),
  ];
}

function box(lines, { title, bg = NOTE_BG, edge = ACCENT } = {}) {
  const paras = [];
  if (title) paras.push(new Paragraph({ bidirectional: true, spacing: { after: 60 }, children: runs(`**${title}**`, { color: edge }) }));
  for (const l of lines) paras.push(new Paragraph({ bidirectional: true, alignment: AlignmentType.BOTH, spacing: { after: 60 }, children: runs(l) }));
  return new Table({
    visuallyRightToLeft: true,
    width: { size: TEXT_W, type: WidthType.DXA },
    columnWidths: [TEXT_W],
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: TEXT_W, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: bg },
            margins: { top: 120, bottom: 80, left: 200, right: 200 },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              right: { style: BorderStyle.SINGLE, size: 24, color: edge },
            },
            children: paras,
          }),
        ],
      }),
    ],
  });
}
const NOTE = (lines, title = 'نکته') => [box([].concat(lines), { title }), new Paragraph({ spacing: { after: 120 }, children: [] })];
const WARNBOX = (lines, title = 'توجه') => [box([].concat(lines), { title, bg: WARN_BG, edge: WARN }), new Paragraph({ spacing: { after: 120 }, children: [] })];

function TABLE(head, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cols = widths.map((w) => Math.round((w / total) * TEXT_W));
  cols[cols.length - 1] += TEXT_W - cols.reduce((a, b) => a + b, 0);
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D5DCE4' };
  const cell = (text, i, isHead) =>
    new TableCell({
      width: { size: cols[i], type: WidthType.DXA },
      shading: isHead ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF2F6' } : undefined,
      margins: { top: 70, bottom: 70, left: 120, right: 120 },
      borders: { top: border, bottom: border, left: border, right: border },
      children: [new Paragraph({ bidirectional: true, children: runs(isHead ? `**${text}**` : text, { size: 19, sizeComplexScript: 19 }) })],
    });
  return [
    new Table({
      visuallyRightToLeft: true,
      width: { size: TEXT_W, type: WidthType.DXA },
      columnWidths: cols,
      rows: [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, i, true)) }), ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, i, false)) }))],
    }),
    new Paragraph({ spacing: { after: 160 }, children: [] }),
  ];
}

const numberingConfigs = [
  {
    reference: 'bullets',
    levels: [{ level: 0, format: LevelFormat.BULLET, text: '●', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 560, hanging: 320 } }, run: { color: ACCENT, size: 14 } } }],
  },
];

// ── Content ─────────────────────────────────────────────────────────────

/** A code block: left-to-right, monospace, shaded. */
function CODE(text) {
  const lines = text.replace(/\n$/, '').split('\n');
  return [
    new Table({
      width: { size: TEXT_W, type: WidthType.DXA },
      columnWidths: [TEXT_W],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: TEXT_W, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F3F5F8' },
              margins: { top: 100, bottom: 100, left: 160, right: 160 },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: 'D5DCE4' },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D5DCE4' },
                left: { style: BorderStyle.SINGLE, size: 16, color: ACCENT },
                right: { style: BorderStyle.SINGLE, size: 4, color: 'D5DCE4' },
              },
              children: lines.map(
                (l) =>
                  new Paragraph({
                    alignment: AlignmentType.LEFT,
                    spacing: { after: 0, line: 260, lineRule: 'auto' },
                    children: [new TextRun({ text: l || ' ', font: { ascii: FONT_CODE, hAnsi: FONT_CODE, cs: FONT_CODE }, size: 17, color: '1B2533' })],
                  })
              ),
            }),
          ],
        }),
      ],
    }),
    new Paragraph({ spacing: { after: 140 }, children: [] }),
  ];
}

/** A checklist item line: ☐ text */
const CHECK = (items) =>
  items.map((t) => new Paragraph({ bidirectional: true, spacing: { after: 60 }, indent: { right: 200 }, children: [new TextRun({ text: '☐  ', font, color: ACCENT }), ...runs(t)] }));

const body = [];
const add = (...items) => body.push(...items.flat());

const chapters = [
  'چه می‌سازیم و چرا',
  'آماده‌سازی vSphere و شبکه',
  'ماشین‌ها (VMها) و منابع',
  'راه‌اندازی SPLUNK-LAB و بارگذاری قانون‌ها',
  'راه‌اندازی WIN-VICTIM',
  'DC-LAB و LNX-VICTIM (اختیاری)',
  'نصب Atomic Red Team و اجرای اولین تست',
  'بررسی سلامت لب',
  'اتصال DetectKB به لب',
  'قواعد امنیتی لب',
  'چک‌لیست تحویل',
];
add(
  new Paragraph({ bidirectional: true, spacing: { after: 200 }, children: runs('**فهرست**', { size: 30, sizeComplexScript: 30, color: INK }) }),
  chapters.map(
    (c, i) =>
      new Paragraph({
        bidirectional: true,
        spacing: { after: 90 },
        border: { bottom: { style: BorderStyle.DOTTED, size: 4, color: 'C9D2DC', space: 4 } },
        children: runs(`**${(i + 1).toLocaleString('fa-IR')}.**    ${c}`, { size: 23, sizeComplexScript: 23 }),
      })
  ),
  P(''),
  P('**مخاطب این سند:** تیم زیرساخت (vSphere، شبکه، ویندوز) و تیم مهندسی تشخیص. هر فصل یک بخش مستقل است و آخر سند یک چک‌لیست تحویل آمده تا مشخص باشد چه چیزی آماده شده و چه چیزی مانده.'),
  P('مقادیری مثل نام ماشین‌ها، IPها و نام indexها پیشنهادی‌اند؛ اگر عوضشان کردید، فقط در جدول فصل ۱۱ ثبت کنید تا در DetectKB همان‌ها تنظیم شود.', { run: { color: MUTED } }),
);

// ── 1
add(
  H1('۱. چه می‌سازیم و چرا'),
  P('DetectKB برای هر قانون تشخیص نشان می‌دهد کدام تست‌های **Atomic Red Team** باید آن را فعال کنند. برای اینکه مطمئن شویم قانون واقعاً کار می‌کند، باید آن تست‌ها را در یک محیط امن اجرا کنیم و ببینیم Splunk هشدار می‌دهد یا نه. این سند همان محیط امن («لب») را روی **vSphere** شرح می‌دهد.'),
  NOTE([
    'Splunk Attack Range در نسخه‌ی فعلی (v5) فقط روی ابر (AWS، Azure، GCP) نصب می‌شود و روی vSphere اجرا نمی‌شود. به همین دلیل همان محتوای Attack Range را — یعنی Splunk، ویندوز با Sysmon و Forwarder، و Atomic Red Team — مستقیماً روی vSphere می‌سازیم. نتیجه همان لب است، فقط نصبش خودکار نیست.',
  ], 'چرا خود Attack Range را نصب نمی‌کنیم؟'),
  IMGP('topology', 'نمای کلی لب روی vSphere و ارتباطش با DetectKB', 620),
  H2('سه قطعه‌ی اصلی'),
  TABLE(
    ['قطعه', 'کارش'],
    [
      ['**SPLUNK-LAB**', 'لاگ همه‌ی ماشین‌های لب را جمع می‌کند و قانون‌ها روی آن اجرا می‌شوند.'],
      ['**WIN-VICTIM**', 'ماشین قربانی: حمله‌های آزمایشی روی آن اجرا می‌شود. Sysmon و لاگ‌های ویندوز را به Splunk می‌فرستد.'],
      ['**DetectKB**', 'می‌گوید کدام تست را اجرا کنیم و نتیجه را ثبت می‌کند. داخل لب نیست؛ فقط به Splunk وصل می‌شود.'],
    ],
    [1.5, 6]
  ),
);

// ── 2
add(
  H1('۲. آماده‌سازی vSphere و شبکه'),
  H2('کارهای vSphere'),
  CHECK([
    'یک **Folder** و یک **Resource Pool** جدا به نام `LAB-ATTACK` بسازید و برایش سقف منابع بگذارید (مثلاً ۲۰ vCPU و ۴۸ گیگابایت RAM) تا لب روی سرویس‌های دیگر اثر نگذارد.',
    'یک **Port Group** (یا VLAN) جدید به نام `LAB-ATTACK` روی Distributed Switch بسازید. هیچ ماشین دیگری نباید روی آن باشد.',
    'ISO‌ها را در Datastore بگذارید: Ubuntu Server 22.04، Windows Server 2022 (Evaluation)، Windows 11 Enterprise (Evaluation).',
    'روی همه‌ی VMها **VMware Tools** نصب شود.',
    'برای هر VM بعد از راه‌اندازی کامل یک Snapshot به نام `clean-baseline` بگیرید (فصل ۷).',
  ]),
  H2('شبکه و فایروال'),
  P('لب باید **از شبکه‌ی production جدا** باشد. فقط این ارتباط‌ها مجاز است:'),
  TABLE(
    ['از', 'به', 'پورت', 'برای چه'],
    [
      ['ماشین‌های لب', 'SPLUNK-LAB', '`9997/tcp`', 'ارسال لاگ با Universal Forwarder (داخل لب)'],
      ['DetectKB', 'SPLUNK-LAB', '`8089/tcp`', 'اجرای کوئری قانون‌ها با REST API (فاز ۳)'],
      ['WIN-VICTIM / LNX-VICTIM', 'DetectKB', '`443/tcp`', 'Runner: گرفتن تست از صف و گزارش نتیجه (فاز ۳)'],
      ['ادمین / تحلیلگر', 'SPLUNK-LAB', '`8000/tcp`', 'وب Splunk'],
      ['ادمین', 'ماشین‌های لب', '`3389` / `22`', 'RDP و SSH، ترجیحاً از جامپ‌سرور'],
      ['ماشین‌های لب', 'اینترنت', '`443/tcp`', 'فقط زمان نصب (دانلود Splunk، Sysmon، Atomic)؛ بعد می‌توانید ببندید'],
    ],
    [2, 1.6, 1.2, 4]
  ),
  WARNBOX([
    'هیچ مسیری از لب به شبکه‌ی production، Active Directory سازمان یا سرورهای واقعی نباید وجود داشته باشد. حمله‌های آزمایشی واقعی‌اند و ممکن است اسکن شبکه یا حرکت جانبی انجام دهند.',
    'ساعت همه‌ی ماشین‌ها (NTP) باید درست باشد؛ DetectKB نتیجه را بر اساس بازه‌ی زمانی اجرای تست جستجو می‌کند.',
  ]),
  H2('IP و DNS پیشنهادی'),
  TABLE(
    ['ماشین', 'IP نمونه', 'نام DNS'],
    [
      ['SPLUNK-LAB', '`10.50.0.10`', '`splunk-lab.lab.local`'],
      ['WIN-VICTIM', '`10.50.0.21`', '`win-victim.lab.local`'],
      ['DC-LAB', '`10.50.0.20`', '`dc-lab.lab.local`'],
      ['LNX-VICTIM', '`10.50.0.31`', '`lnx-victim.lab.local`'],
    ],
    [2, 2, 3]
  ),
);

// ── 3
add(
  H1('۳. ماشین‌ها (VMها) و منابع'),
  TABLE(
    ['ماشین', 'سیستم‌عامل', 'vCPU', 'RAM', 'دیسک', 'لازم؟'],
    [
      ['**SPLUNK-LAB**', 'Ubuntu Server 22.04', '8', '16 GB', '200 GB', 'بله'],
      ['**WIN-VICTIM**', 'Windows 11 Ent. یا Server 2022', '4', '8 GB', '80 GB', 'بله'],
      ['**DC-LAB**', 'Windows Server 2022 + AD DS', '2', '6 GB', '80 GB', 'برای تکنیک‌های AD'],
      ['**LNX-VICTIM**', 'Ubuntu Server 22.04', '2', '4 GB', '40 GB', 'برای قانون‌های لینوکسی'],
      ['**جمع (همه)**', '', '16', '34 GB', '400 GB', ''],
    ],
    [1.8, 2.6, 0.8, 1, 1, 1.6]
  ),
  NOTE(['برای شروع فقط **SPLUNK-LAB** و **WIN-VICTIM** کافی است (۱۲ vCPU، ۲۴ گیگابایت). DC و لینوکس را بعداً اضافه کنید.'], 'حداقل'),
  H2('لایسنس‌ها'),
  TABLE(
    ['نرم‌افزار', 'لایسنس پیشنهادی', 'نکته'],
    [
      ['Splunk Enterprise', '**Developer License** (رایگان، ۱۰ گیگابایت در روز، قابل تمدید)', 'Trial ۶۰ روزه هم هست. نسخه‌ی Free هشدار (Alert) و کاربر ندارد؛ برای ما مناسب نیست.'],
      ['Windows 11 / Server 2022', 'Evaluation (۹۰ تا ۱۸۰ روز)', 'یا لایسنس‌های داخلی سازمان'],
      ['Sysmon، Atomic Red Team', 'رایگان', ''],
    ],
    [2, 3, 4]
  ),
);

// ── 4
add(
  H1('۴. راه‌اندازی SPLUNK-LAB'),
  H2('۴-۱. نصب Splunk'),
  P('فایل نصب Splunk Enterprise برای لینوکس (`.tgz`) را از سایت Splunk دانلود و روی ماشین کپی کنید. سپس:'),
  CODE(`sudo useradd -m -r splunk
sudo tar xzf splunk-*-linux-amd64.tgz -C /opt
sudo chown -R splunk:splunk /opt/splunk
sudo -u splunk /opt/splunk/bin/splunk start --accept-license --answer-yes --seed-passwd 'CHANGE-ME-Strong-Pass'
sudo /opt/splunk/bin/splunk enable boot-start -user splunk --accept-license`),
  H2('۴-۲. دریافت لاگ و indexها'),
  CODE(`sudo -u splunk /opt/splunk/bin/splunk enable listen 9997 -auth admin:'CHANGE-ME-Strong-Pass'
sudo -u splunk /opt/splunk/bin/splunk add index win -auth admin:'CHANGE-ME-Strong-Pass'
sudo -u splunk /opt/splunk/bin/splunk add index sysmon -auth admin:'CHANGE-ME-Strong-Pass'
sudo -u splunk /opt/splunk/bin/splunk add index linux -auth admin:'CHANGE-ME-Strong-Pass'`),
  H2('۴-۳. اپ‌های لازم (از Splunkbase)'),
  TABLE(
    ['اپ', 'چرا'],
    [
      ['**Splunk Add-on for Microsoft Windows** (`Splunk_TA_windows`)', 'تجزیه‌ی Event Logهای ویندوز (4688، 4104 و …)'],
      ['**Splunk Add-on for Sysmon** (`Splunk_TA_microsoft_sysmon`)', 'تجزیه‌ی رویدادهای Sysmon'],
      ['**Splunk Common Information Model** (`Splunk_SA_CIM`)', 'بسیاری از قانون‌های ESCU با `tstats` روی دیتامدل‌ها (مثل `Endpoint.Processes`) کار می‌کنند'],
      ['**ES Content Update** (`DA-ESS-ContentUpdate`)', 'ماکروهایی که قانون‌های ESCU استفاده می‌کنند، مثل ماکروی sysmon و ماکروهای filter هر قانون'],
      ['**Splunk Add-on for Unix and Linux** (اختیاری)', 'فقط اگر LNX-VICTIM دارید'],
    ],
    [4, 4]
  ),
  H2('۴-۴. تنظیم‌های مهم بعد از نصب اپ‌ها'),
  CHECK([
    'در **Settings → Roles → admin** (و نقشی که DetectKB استفاده می‌کند) indexهای `win`، `sysmon` و `linux` را به **Indexes searched by default** اضافه کنید. ماکروهای ESCU index مشخص نمی‌کنند و بدون این کار چیزی پیدا نمی‌کنند.',
    'در CIM، دیتامدل **Endpoint** را برای indexهای لب تنظیم کنید و **Acceleration** را روشن کنید؛ یا ماکروی `security_content_summariesonly` را روی `summariesonly=false` بگذارید تا قانون‌های `tstats` بدون شتاب‌دهی هم نتیجه بدهند.',
    'رمز پیش‌فرض admin را عوض کنید و برای DetectKB یک کاربر جدا بسازید (فصل ۹).',
  ]),
  H2('۴-۵. بارگذاری قانون‌ها از DetectKB'),
  P('قانون‌ها باید در Splunk لب تعریف شوند تا هنگام تست هشدار بدهند. در DetectKB، صفحه‌ی **Atomic Red Team** → **Export rules for Splunk** را بزنید (مثلاً قانون‌های Production که تکنیکشان تست Atomic دارد). فایل `savedsearches.conf` دانلود می‌شود؛ هر قانون یک جستجوی ذخیره‌شده است که هر ۵ دقیقه اجرا می‌شود و اگر نتیجه داشته باشد هشدار می‌دهد.'),
  CODE(`sudo mkdir -p /opt/splunk/etc/apps/detectkb_lab/local
sudo cp savedsearches.conf /opt/splunk/etc/apps/detectkb_lab/local/
sudo chown -R splunk:splunk /opt/splunk/etc/apps/detectkb_lab
sudo -u splunk /opt/splunk/bin/splunk restart`),
  NOTE(['هشدارهای فعال‌شده در Splunk در **Activity → Triggered Alerts** دیده می‌شوند. هر بار قانون‌ها در DetectKB تغییر کردند، فایل را دوباره خروجی بگیرید و جایگزین کنید.'], 'دیدن هشدارها'),
);

// ── 5
add(
  H1('۵. راه‌اندازی WIN-VICTIM'),
  P('این مراحل را روی WIN-VICTIM (و بعداً DC-LAB) با PowerShell در حالت **Administrator** اجرا کنید.'),
  H2('۵-۱. Sysmon'),
  P('Sysmon را از سایت Microsoft Sysinternals و فایل پیکربندی را از پروژه‌ی **sysmon-modular** (olafhartong) دانلود کنید. این پیکربندی رویدادهای مهم مثل دسترسی به lsass (EID 10) را ثبت می‌کند.'),
  CODE(`.\\Sysmon64.exe -accepteula -i .\\sysmonconfig.xml
# Check:
Get-WinEvent -LogName 'Microsoft-Windows-Sysmon/Operational' -MaxEvents 5`),
  H2('۵-۲. Audit ویندوز'),
  P('بدون این تنظیم‌ها رویدادهایی مثل 4688 (ساخت پروسه با خط فرمان) و 4104 (اسکریپت PowerShell) ثبت نمی‌شوند و بسیاری از قانون‌ها هیچ‌وقت فعال نمی‌شوند.'),
  CODE(`# Process creation (4688) with the command line
auditpol /set /subcategory:"Process Creation" /success:enable /failure:enable
reg add "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\Audit" /v ProcessCreationIncludeCmdLine_Enabled /t REG_DWORD /d 1 /f

# Other events the rules use
auditpol /set /subcategory:"Logon" /success:enable /failure:enable
auditpol /set /subcategory:"Special Logon" /success:enable
auditpol /set /subcategory:"User Account Management" /success:enable /failure:enable
auditpol /set /subcategory:"Security Group Management" /success:enable
auditpol /set /subcategory:"Other Object Access Events" /success:enable /failure:enable
auditpol /set /subcategory:"Security System Extension" /success:enable
auditpol /set /subcategory:"File Share" /success:enable /failure:enable
auditpol /set /subcategory:"Audit Policy Change" /success:enable

# PowerShell: Script Block (4104) and Module Logging (4103)
reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging" /v EnableScriptBlockLogging /t REG_DWORD /d 1 /f
reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ModuleLogging" /v EnableModuleLogging /t REG_DWORD /d 1 /f
reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ModuleLogging\\ModuleNames" /v "*" /t REG_SZ /d "*" /f`),
  NOTE(['روی DC-LAB علاوه بر این‌ها `Kerberos Service Ticket Operations`، `Kerberos Authentication Service` و `Directory Service Changes` را هم فعال کنید (برای 4769، 4768 و 5136).'], 'برای DC'),
  H2('۵-۳. Splunk Universal Forwarder'),
  CODE(`msiexec.exe /i splunkforwarder-<version>-x64-release.msi AGREETOLICENSE=Yes RECEIVING_INDEXER="10.50.0.10:9997" SPLUNKUSERNAME=admin SPLUNKPASSWORD="CHANGE-ME-UF" /quiet`),
  P('سپس فایل `C:\\Program Files\\SplunkUniversalForwarder\\etc\\system\\local\\inputs.conf` را با این محتوا بسازید و سرویس SplunkForwarder را ری‌استارت کنید:'),
  CODE(`[WinEventLog://Security]
disabled = 0
renderXml = true
index = win

[WinEventLog://System]
disabled = 0
renderXml = true
index = win

[WinEventLog://Microsoft-Windows-PowerShell/Operational]
disabled = 0
renderXml = true
index = win

[WinEventLog://Microsoft-Windows-Sysmon/Operational]
disabled = 0
renderXml = true
index = sysmon

[WinEventLog://Microsoft-Windows-TaskScheduler/Operational]
disabled = 0
renderXml = true
index = win`),
  CODE(`Restart-Service SplunkForwarder`),
  H2('۵-۴. آنتی‌ویروس (Defender)'),
  P('خیلی از تست‌های Atomic را Defender قبل از اجرا متوقف می‌کند. دو حالت هر دو مفیدند، ولی باید مشخص باشد در کدام حالت تست کرده‌اید:'),
  UL([
    '**حالت تست قانون (پیشنهادی برای شروع):** برای پوشه‌ی `C:\\AtomicRedTeam` استثنا (Exclusion) تعریف کنید تا حمله اجرا شود و ببینیم قانون SIEM آن را می‌گیرد یا نه.',
    '**حالت واقعی:** Defender کامل روشن؛ نشان می‌دهد در عمل چه چیزی جلوی حمله را می‌گیرد.',
  ]),
  CODE(`Add-MpPreference -ExclusionPath 'C:\\AtomicRedTeam'`),
);

// ── 6
add(
  H1('۶. DC-LAB و LNX-VICTIM (اختیاری)'),
  H2('DC-LAB'),
  CHECK([
    'Windows Server 2022 نصب و نقش **AD DS** با دامنه‌ی جدا (مثلاً `lab.local`) راه‌اندازی شود — هیچ Trust با دامنه‌ی سازمان.',
    'WIN-VICTIM عضو دامنه‌ی `lab.local` شود.',
    'همان مراحل فصل ۵ (Sysmon، Audit، Forwarder) روی DC هم انجام شود.',
    'چند کاربر و گروه آزمایشی و یک حساب سرویس با SPN بسازید تا تست‌هایی مثل Kerberoasting معنی داشته باشند.',
  ]),
  H2('LNX-VICTIM'),
  CHECK([
    'نصب **auditd** و **Sysmon for Linux** (از مخزن بسته‌های Microsoft).',
    'نصب Splunk Universal Forwarder برای لینوکس، فرستادن `/var/log/audit/audit.log`، `/var/log/syslog` و لاگ Sysmon به index `linux`.',
    'نصب **PowerShell 7** (`pwsh`) تا Invoke-AtomicRedTeam روی لینوکس هم کار کند.',
  ]),
);

// ── 7
add(
  H1('۷. نصب Atomic Red Team و اجرای اولین تست'),
  H2('۷-۱. نصب روی WIN-VICTIM'),
  CODE(`Set-ExecutionPolicy Bypass -Scope Process -Force
IEX (IWR 'https://raw.githubusercontent.com/redcanaryco/invoke-atomicredteam/master/install-atomicredteam.ps1' -UseBasicParsing)
Install-AtomicRedTeam -getAtomics -Force`),
  NOTE([
    'اگر ماشین اینترنت ندارد: دو مخزن `redcanaryco/invoke-atomicredteam` و `redcanaryco/atomic-red-team` را جای دیگری به‌صورت ZIP دانلود کنید، در `C:\\AtomicRedTeam` باز کنید و ماژول `powershell-yaml` را هم نصب کنید.',
  ], 'بدون اینترنت'),
  H2('۷-۲. اجرای یک تست'),
  P('در DetectKB، صفحه‌ی **Atomic Red Team** یا بخش **Lab validation · Atomic Red Team** صفحه‌ی قانون را باز کنید و خط `Invoke-AtomicTest` را کپی کنید. روی WIN-VICTIM:'),
  CODE(`Import-Module 'C:\\AtomicRedTeam\\invoke-atomicredteam\\Invoke-AtomicRedTeam.psd1' -Force

# 1. Prerequisites (downloads the test's tools)
Invoke-AtomicTest T1003.001 -TestGuids 2536dee2-12fb-459a-8c37-971844fa73be -GetPrereqs

# 2. Run the attack
Invoke-AtomicTest T1003.001 -TestGuids 2536dee2-12fb-459a-8c37-971844fa73be

# 3. Clean up
Invoke-AtomicTest T1003.001 -TestGuids 2536dee2-12fb-459a-8c37-971844fa73be -Cleanup`),
  H2('۷-۳. دیدن نتیجه و ثبت آن در DetectKB'),
  OL([
    '۵ تا ۱۰ دقیقه صبر کنید تا لاگ‌ها به Splunk برسند و جستجوهای ذخیره‌شده اجرا شوند.',
    'در Splunk، **Activity → Triggered Alerts** را ببینید، یا کوئری قانون را برای **۱۵ دقیقه‌ی اخیر** دستی اجرا کنید.',
    'در DetectKB، در جزئیات همان تست **Record a run** را بزنید و برای هر قانون نتیجه را ثبت کنید: **Detected**، **Not detected**، یا اگر حمله اجرا نشد **Blocked** / **Test error**.',
    'بعد از چند تست، ماشین را به Snapshot `clean-baseline` برگردانید.',
  ]),
  P('قانون‌هایی که هشدار دادند در DetectKB وضعیت **Validated** می‌گیرند و در ماتریس ATT&CK با گزینه‌ی **Proven in lab only** به‌عنوان پوشش اثبات‌شده دیده می‌شوند.'),
  WARNBOX(['اگر قانونی هشدار نداد، قبل از اصلاح آن بررسی کنید حمله واقعاً اجرا شده و لاگش به Splunk رسیده است (فصل ۸). فقط وقتی لاگ هست ولی قانون آن را نمی‌گیرد، قانون نیاز به بازبینی دارد.'], 'قبل از اصلاح قانون'),
);

// ── 8
add(
  H1('۸. بررسی سلامت لب'),
  P('قبل از اولین تست، این جستجوها را در Splunk اجرا کنید. هر کدام باید نتیجه داشته باشد:'),
  TABLE(
    ['چه چیزی', 'جستجو'],
    [
      ['رویداد Sysmon می‌رسد', '`index=sysmon | stats count by EventCode`'],
      ['4688 همراه با خط فرمان', '`index=win EventCode=4688 | table _time Process_Command_Line`'],
      ['اسکریپت PowerShell (4104)', '`index=win EventCode=4104 | head 5`'],
      ['دیتامدل Endpoint پر است', '`| tstats count from datamodel=Endpoint.Processes by Processes.dest`'],
    ],
    [2.5, 5]
  ),
  P('و برای اینکه مطمئن شوید ماکروهای ESCU کار می‌کنند (نام ماکرو بین دو backtick است):'),
  CODE('`sysmon` | head 5'),
  NOTE(['اگر ماکروی `sysmon` نتیجه نمی‌دهد ولی `index=sysmon` نتیجه دارد، indexها در «Indexes searched by default» نقش شما نیستند (بخش ۴-۴).'], 'عیب‌یابی رایج'),
);

// ── 9
add(
  H1('۹. اتصال DetectKB به لب'),
  P('اصل مهم: **DetectKB هیچ‌وقت وارد ماشین‌های قربانی نمی‌شود و روی آن‌ها دستور اجرا نمی‌کند.** اگر DetectKB رمز ادمین ماشین‌ها را داشت و خودش دستور اجرا می‌کرد، نفوذ به DetectKB یعنی نفوذ به لب. پس ارتباط‌ها این‌طور طراحی شده‌اند:'),
  TABLE(
    ['ارتباط', 'جهت', 'چطور', 'در کدام فاز'],
    [
      ['DetectKB → Splunk', 'DetectKB وصل می‌شود', 'REST API روی `8089` با **توکن فقط‌خواندنی**؛ کوئری قانون را در بازه‌ی زمانی تست اجرا می‌کند', 'فاز ۳'],
      ['Runner → DetectKB', 'ماشین قربانی وصل می‌شود', 'یک اسکریپت کوچک PowerShell روی WIN-VICTIM که هر ۳۰ ثانیه از DetectKB می‌پرسد «تستی در صف هست؟»، اجرا می‌کند و زمان را گزارش می‌دهد', 'فاز ۳'],
      ['DetectKB → ماشین‌های قربانی', '—', '**هیچ ارتباطی** (نه RDP، نه WinRM، نه SSH)', 'هیچ‌وقت'],
    ],
    [2, 1.8, 5, 1]
  ),
  H2('در فاز ۲ (دستی)'),
  P('هیچ اتصالی لازم نیست و این حالت همین الان در DetectKB آماده است: قانون‌ها را با **Export rules for Splunk** به Splunk لب می‌برید (بخش ۴-۵)، تست را طبق فصل ۷ دستی اجرا می‌کنید، نتیجه را در Splunk می‌بینید و با **Record a run** در DetectKB ثبت می‌کنید.'),
  H2('در فاز ۳ (خودکار)'),
  IMGP('flow', 'مسیر یک تست خودکار: از دکمه در DetectKB تا ثبت نتیجه', 620),
  H2('حساب‌ها و دسترسی‌ها'),
  TABLE(
    ['حساب', 'کجا', 'دسترسی'],
    [
      ['`detectkb_svc`', 'Splunk لب', 'نقش جدید `detectkb_reader`: فقط `search` روی indexهای `win`، `sysmon`، `linux`؛ بدون دسترسی ادمین. برایش یک **Authentication Token** بسازید.'],
      ['توکن Runner', 'DetectKB', 'در DetectKB ساخته می‌شود و فقط اجازه‌ی «گرفتن تست از صف و گزارش نتیجه» دارد — نه خواندن یا تغییر قانون‌ها.'],
      ['حساب اجرای Runner', 'WIN-VICTIM', 'کاربر محلی ادمین لب (بسیاری از تست‌ها دسترسی ادمین می‌خواهند). هیچ ربطی به حساب‌های سازمان ندارد.'],
    ],
    [1.6, 1.4, 6]
  ),
);

// ── 10
add(
  H1('۱۰. قواعد امنیتی لب'),
  UL([
    'لب در شبکه‌ی جدا؛ **بدون مسیر به production** و بدون Trust با Active Directory سازمان.',
    'هیچ رمز، کلید یا داده‌ی واقعی سازمان داخل لب نباشد.',
    'رمزهای لب (Splunk، ادمین ویندوز) با رمزهای سازمان فرق داشته باشد.',
    'استثنای آنتی‌ویروس فقط روی ماشین‌های لب.',
    'بعد از هر دوره‌ی تست، ماشین‌ها به Snapshot تمیز برگردند.',
    'دسترسی RDP و SSH فقط از جامپ‌سرور و برای افراد مشخص.',
    'بعد از نصب، دسترسی اینترنت ماشین‌های لب را ببندید یا محدود کنید.',
  ]),
);

// ── 11
add(
  H1('۱۱. چک‌لیست تحویل'),
  H2('زیرساخت'),
  CHECK([
    'Port Group و Resource Pool `LAB-ATTACK` ساخته و از production جدا شده است.',
    'فایروال طبق جدول فصل ۲ تنظیم شده است.',
    'SPLUNK-LAB نصب، اپ‌ها نصب، indexها ساخته و دریافت روی 9997 فعال است.',
    'WIN-VICTIM: Sysmon، Audit، Forwarder، Atomic Red Team نصب و Snapshot `clean-baseline` گرفته شده است.',
    'همه‌ی جستجوهای فصل ۸ نتیجه دارند.',
    'قانون‌ها از DetectKB خروجی گرفته و در Splunk لب بارگذاری شده‌اند (بخش ۴-۵).',
    'یک تست نمونه (T1003.001) اجرا، در Splunk دیده و نتیجه‌اش در DetectKB ثبت شده است.',
  ]),
  H2('اطلاعاتی که برای تنظیم DetectKB لازم است'),
  TABLE(
    ['مورد', 'مقدار'],
    [
      ['آدرس REST API اسپلانک', '`https://splunk-lab.lab.local:8089`'],
      ['توکن حساب `detectkb_svc`', '(به‌صورت امن تحویل داده شود — نه در ایمیل یا چت)'],
      ['نام indexها', '`win`، `sysmon`، `linux`'],
      ['نام ماشین‌های قربانی', '`WIN-VICTIM`، …'],
      ['آیا Defender در حالت استثنا است؟', 'بله / خیر'],
      ['باز بودن مسیر DetectKB → 8089 و Runner → DetectKB:443', 'بله / خیر'],
    ],
    [3.5, 4.5]
  ),
);

const cover = [
  new Paragraph({ spacing: { before: 2600 }, children: [] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'DetectKB', font: { ascii: FONT_CODE, hAnsi: FONT_CODE }, size: 72, color: INK })] }),
  new Paragraph({ bidirectional: true, alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: runs('**راه‌اندازی لب تست تشخیص روی vSphere**', { size: 40, sizeComplexScript: 40, color: ACCENT }) }),
  new Paragraph({ bidirectional: true, alignment: AlignmentType.CENTER, spacing: { before: 120 }, children: runs('Splunk · Sysmon · Atomic Red Team · اتصال به DetectKB', { size: 26, sizeComplexScript: 26, color: MUTED }) }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600 }, border: { top: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 12 } }, children: [] }),
  new Paragraph({ bidirectional: true, alignment: AlignmentType.CENTER, children: runs('ویرایش ۲ · مهر ۱۴۰۵', { size: 22, sizeComplexScript: 22, color: MUTED }) }),
  new Paragraph({ children: [new PageBreak()] }),
];

const doc = new Document({
  creator: 'DetectKB',
  title: 'راه‌اندازی لب تست تشخیص روی vSphere',
  description: 'DetectKB detection lab on vSphere (Persian)',
  styles: {
    default: { document: { run: { font, size: 21, sizeComplexScript: 21, color: INK }, paragraph: { spacing: { line: 312, lineRule: 'auto' } } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font, size: 34, sizeComplexScript: 34, bold: true, boldComplexScript: true, color: INK }, paragraph: { spacing: { before: 120, after: 240 }, outlineLevel: 0, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 6 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font, size: 26, sizeComplexScript: 26, bold: true, boldComplexScript: true, color: ACCENT }, paragraph: { spacing: { before: 300, after: 120 }, outlineLevel: 1, keepNext: true } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font, size: 23, sizeComplexScript: 23, bold: true, boldComplexScript: true, color: INK }, paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 2, keepNext: true } },
    ],
  },
  numbering: { config: numberingConfigs },
  sections: [
    {
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, header: 560, footer: 560 } }, titlePage: true },
      headers: {
        default: new Header({ children: [new Paragraph({ bidirectional: true, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D5DCE4', space: 4 } }, children: runs('راه‌اندازی لب تست تشخیص — DetectKB', { size: 17, sizeComplexScript: 17, color: MUTED }) })] }),
        first: new Header({ children: [new Paragraph({ children: [] })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: MUTED })] })] }),
        first: new Footer({ children: [new Paragraph({ children: [] })] }),
      },
      children: [...cover, ...body],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, 'DetectKB-Lab-Setup.docx'), buf);
  console.log('written', buf.length, 'bytes,', figNo, 'figures');
});
