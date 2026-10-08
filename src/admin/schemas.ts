/** Field and table definitions that drive every content tab in /admin. */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'date'
  | 'datetime'
  | 'image'
  | 'file'
  | 'url'
  | 'video'
  | 'strings'
  | 'objects'
  | 'coursePick';

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  help?: string;
  max?: number; // character limit (shows a counter)
  placeholder?: string;
  folder?: string; // upload folder for image / file
  maxWidth?: number; // image: longest side in px after compression
  addOnly?: boolean; // only editable while adding (e.g. a course's category)
  maxItems?: number; // strings / objects / coursePick
  fixed?: boolean; // objects: exactly maxItems rows, no add/remove
  sub?: Field[]; // objects: row fields
  suggestions?: string[];
  /** The value (or every item of a `strings` list) must match this expression. */
  pattern?: string;
  patternFlags?: string;
  /** Shown when the pattern does not match. */
  patternHelp?: string;
  showIf?: (d: Record<string, any>) => boolean;
};

export type Column = {
  key: string;
  label: string;
  kind?: 'text' | 'image' | 'bool' | 'mono' | 'date';
  width?: string;
};

export type CollectionDef = {
  folder: string;
  label: string;
  singular: string;
  titleKey: string;
  fields: Field[];
  columns: Column[];
  order: boolean;
  published: boolean;
  sitePath: string;
  intro?: string;
  defaults: () => Record<string, any>;
};

export const EXAMS = ['UPSC CSE', 'Punjab PSC (PCS)', 'Punjab One Day Exams', 'Other'];
export const STATUSES = ['Open', 'Contacted', 'Resolved', 'Enrolled'] as const;
const url = (key: string, label: string, extra: Partial<Field> = {}): Field => ({
  key,
  label,
  type: 'url',
  placeholder: 'https://…',
  ...extra,
});

export const COURSES: CollectionDef = {
  folder: 'courses',
  label: 'Courses',
  singular: 'course',
  titleKey: 'name',
  order: true,
  published: true,
  sitePath: '/courses/',
  intro:
    'Staff can change a course’s thumbnail, name and price. The category is chosen when the course is added.',
  fields: [
    {
      key: 'thumbnail',
      label: 'Thumbnail',
      type: 'image',
      folder: 'courses',
      maxWidth: 900,
      help: '16:10 picture works best.',
    },
    { key: 'name', label: 'Course name', type: 'text', required: true, max: 70 },
    {
      key: 'price',
      label: 'Price',
      type: 'text',
      required: true,
      max: 20,
      placeholder: '₹1,20,000',
      help: 'Typed as text so you can write ₹1,20,000 or "From ₹9,999".',
    },
    {
      key: 'category',
      label: 'Category',
      type: 'select',
      required: true,
      addOnly: true,
      options: ['UPSC CSE', 'Punjab PSC', 'Punjab One Day', 'Optional', 'Test series'],
      help: 'Set when adding; cannot be changed afterwards.',
    },
  ],
  columns: [
    { key: 'thumbnail', label: 'Thumbnail', kind: 'image' },
    { key: 'name', label: 'Name' },
    { key: 'price', label: 'Price', kind: 'mono' },
    { key: 'category', label: 'Category' },
  ],
  defaults: () => ({ thumbnail: '', name: '', price: '', category: 'UPSC CSE', published: true }),
};

export const TEACHERS: CollectionDef = {
  folder: 'teachers',
  label: 'Teachers',
  singular: 'teacher',
  titleKey: 'name',
  order: true,
  published: true,
  sitePath: '/about-teachers/',
  fields: [
    {
      key: 'photo',
      label: 'Photo',
      type: 'image',
      folder: 'teachers',
      maxWidth: 900,
      help: 'Portrait (4:5) works best.',
    },
    { key: 'name', label: 'Name', type: 'text', required: true, max: 60 },
    { key: 'subject', label: 'Subject', type: 'text', required: true, max: 60 },
    {
      key: 'credential',
      label: 'Credential',
      type: 'text',
      max: 70,
      placeholder: 'PhD, Political Science · 15 yrs',
    },
    { key: 'bio', label: 'Short bio', type: 'textarea', max: 240 },
    url('intro_video_url', 'Intro video link (optional)', {
      help: 'YouTube link. Shows a “Watch intro” button.',
    }),
  ],
  columns: [
    { key: 'photo', label: 'Photo', kind: 'image' },
    { key: 'name', label: 'Name' },
    { key: 'subject', label: 'Subject' },
    { key: 'credential', label: 'Credential' },
  ],
  defaults: () => ({
    photo: '',
    name: '',
    subject: '',
    credential: '',
    bio: '',
    intro_video_url: '',
    published: true,
  }),
};

export const RESULTS: CollectionDef = {
  folder: 'results',
  label: 'Results',
  singular: 'result',
  titleKey: 'student_name',
  order: true,
  published: true,
  sitePath: '/results/',
  fields: [
    {
      key: 'photo',
      label: 'Photo',
      type: 'image',
      folder: 'results',
      maxWidth: 900,
      help: 'Portrait (4:5) works best.',
    },
    { key: 'student_name', label: 'Student name', type: 'text', required: true, max: 60 },
    {
      key: 'exam',
      label: 'Exam',
      type: 'text',
      required: true,
      max: 40,
      suggestions: [
        'UPSC CSE',
        'Punjab PCS',
        'Naib Tehsildar',
        'PSSSB Patwari',
        'PSSSB Clerk',
        'Punjab Police',
        'Excise & Taxation',
      ],
      help: 'These become the filter buttons on the Results page.',
    },
    { key: 'exam_year', label: 'Year', type: 'text', required: true, max: 4, placeholder: '2025' },
    {
      key: 'rank_label',
      label: 'Rank label',
      type: 'text',
      required: true,
      max: 20,
      placeholder: 'AIR 07',
    },
    { key: 'quote', label: 'Quote (optional)', type: 'textarea', max: 200 },
    {
      key: 'show_on_home',
      label: 'Show on the Home page (and landing-page topper strips)',
      type: 'checkbox',
    },
  ],
  columns: [
    { key: 'photo', label: 'Photo', kind: 'image' },
    { key: 'student_name', label: 'Student' },
    { key: 'rank_label', label: 'Rank', kind: 'mono' },
    { key: 'exam', label: 'Exam' },
    { key: 'exam_year', label: 'Year', kind: 'mono' },
    { key: 'show_on_home', label: 'On Home', kind: 'bool' },
  ],
  defaults: () => ({
    photo: '',
    student_name: '',
    exam: '',
    exam_year: String(new Date().getFullYear()),
    rank_label: '',
    quote: '',
    show_on_home: false,
    published: true,
  }),
};

export const REELS: CollectionDef = {
  folder: 'reels',
  label: 'Reels',
  singular: 'reel',
  titleKey: 'student_name',
  order: true,
  published: true,
  sitePath: '/',
  intro:
    'Instagram reels shown as a swipeable carousel in the middle of the Home page and on the Results page (topper testimonials). Visitors tap a card to watch it from Instagram.',
  fields: [
    {
      key: 'instagram_url',
      label: 'Instagram reel link',
      type: 'url',
      required: true,
      placeholder: 'https://www.instagram.com/reel/XXXXXXXXXXX/',
      help: 'Open the reel on Instagram, tap the three dots, then Copy link. The Instagram account must be public.',
      pattern:
        '^https?:\\/\\/(www\\.)?instagram\\.com\\/([A-Za-z0-9_.]+\\/)?(reels?|p|tv)\\/[A-Za-z0-9_-]{5,20}([/?#]|$)',
      patternFlags: 'i',
      patternHelp:
        'Paste an Instagram reel link, for example https://www.instagram.com/reel/AbCdEfGh123/',
    },
    { key: 'student_name', label: 'Student name', type: 'text', required: true, max: 40 },
    {
      key: 'label',
      label: 'Rank and exam',
      type: 'text',
      max: 50,
      placeholder: 'AIR 07 · UPSC CSE 2025',
      help: 'Shown on the card. Put the rank first, then a dot, then the exam.',
    },
    {
      key: 'cover',
      label: 'Cover picture',
      type: 'image',
      folder: 'reels',
      maxWidth: 720,
      help: 'Tall (9:16) picture, for example a screenshot of the reel. Without one a coloured card is shown.',
    },
  ],
  columns: [
    { key: 'cover', label: 'Cover', kind: 'image' },
    { key: 'student_name', label: 'Student' },
    { key: 'label', label: 'Rank and exam' },
  ],
  defaults: () => ({ instagram_url: '', student_name: '', label: '', cover: '', published: true }),
};

export const RESOURCES: CollectionDef = {
  folder: 'resources',
  label: 'Free Resources',
  singular: 'resource',
  titleKey: 'title',
  order: true,
  published: true,
  sitePath: '/free-resources/',
  intro:
    'Each resource is either an uploaded PDF (under 5 MB) or a link (Google Drive, YouTube or any website).',
  fields: [
    { key: 'title', label: 'Title', type: 'text', required: true, max: 70 },
    { key: 'subtitle', label: 'Subtitle', type: 'text', max: 90 },
    {
      key: 'category',
      label: 'Category',
      type: 'select',
      required: true,
      options: ['Notes & PDFs', 'PYQs', 'Current Affairs', 'Videos', 'Punjab GK'],
    },
    {
      key: 'type',
      label: 'Type',
      type: 'select',
      required: true,
      options: ['pdf', 'video', 'link'],
      help: 'PDF shows “Download”, video shows “Watch”, link shows “Open”.',
    },
    {
      key: 'file',
      label: 'Upload a PDF',
      type: 'file',
      folder: 'resources',
      help: 'Use this OR the link below, not both.',
      showIf: (d) => d.type === 'pdf',
    },
    url('url', 'Link', {
      help: 'Google Drive or YouTube link (or any web page). Leave empty if you uploaded a PDF.',
    }),
    { key: 'show_on_home', label: 'Show in the Home page carousel', type: 'checkbox' },
  ],
  columns: [
    { key: 'title', label: 'Title' },
    { key: 'category', label: 'Category' },
    { key: 'type', label: 'Type', kind: 'mono' },
    { key: 'show_on_home', label: 'On Home', kind: 'bool' },
  ],
  defaults: () => ({
    title: '',
    subtitle: '',
    category: 'Notes & PDFs',
    type: 'pdf',
    file: '',
    url: '',
    show_on_home: false,
    published: true,
  }),
};

export const EXAM_UPDATES: CollectionDef = {
  folder: 'exam-updates',
  label: 'Exam Updates',
  singular: 'update',
  titleKey: 'title',
  order: false,
  published: true,
  sitePath: '/exam-updates/',
  intro: 'Newest first (sorted by date). The latest three also appear on the Home page.',
  fields: [
    { key: 'date', label: 'Date', type: 'date', required: true },
    {
      key: 'exam_body',
      label: 'Exam body',
      type: 'select',
      required: true,
      options: ['UPSC', 'PPSC', 'PSSSB', 'Punjab Police', 'Other'],
    },
    {
      key: 'category',
      label: 'Category',
      type: 'select',
      required: true,
      options: ['Notification', 'Exam date', 'Admit card', 'Answer key', 'Result', 'Syllabus'],
    },
    { key: 'title', label: 'Title', type: 'text', required: true, max: 120 },
    url('link', 'Official link', { help: 'Link to the official notice.' }),
  ],
  columns: [
    { key: 'date', label: 'Date', kind: 'date' },
    { key: 'exam_body', label: 'Body' },
    { key: 'category', label: 'Category' },
    { key: 'title', label: 'Title' },
  ],
  defaults: () => ({
    date: new Date().toLocaleDateString('sv-SE'),
    exam_body: 'UPSC',
    category: 'Notification',
    title: '',
    link: '',
    published: true,
  }),
};

export const TESTS: CollectionDef = {
  folder: 'tests',
  label: 'Free Tests',
  singular: 'test',
  titleKey: 'title',
  order: false,
  published: true,
  sitePath: '/free-tests/',
  fields: [
    { key: 'title', label: 'Title', type: 'text', required: true, max: 80 },
    { key: 'exam', label: 'Exam', type: 'select', required: true, options: EXAMS },
    { key: 'question_count', label: 'Questions', type: 'number', required: true },
    { key: 'duration_min', label: 'Duration (minutes)', type: 'number', required: true },
    url('test_url', 'Test link', { required: true, help: 'For example a Google Form link.' }),
  ],
  columns: [
    { key: 'title', label: 'Title' },
    { key: 'exam', label: 'Exam' },
    { key: 'question_count', label: 'Questions', kind: 'mono' },
    { key: 'duration_min', label: 'Minutes', kind: 'mono' },
  ],
  defaults: () => ({
    title: '',
    exam: 'UPSC CSE',
    question_count: 100,
    duration_min: 120,
    test_url: '',
    published: true,
  }),
};

export const LANDING_FIELDS: Field[] = [
  {
    key: 'slug',
    label: 'Page address',
    type: 'text',
    required: true,
    max: 60,
    addOnly: true,
    placeholder: 'upsc-scholarship-test-2027',
    help: 'Lowercase letters, numbers and hyphens. Cannot be changed later. Becomes /lp/<address>/',
    pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    patternHelp: 'Page address may only use lowercase letters, numbers and single hyphens.',
  },
  {
    key: 'internal_name',
    label: 'Internal name',
    type: 'text',
    required: true,
    max: 80,
    help: 'Only staff see this.',
  },
  {
    key: 'published',
    label: 'Published (unchecked = removed from the live site and sitemap)',
    type: 'checkbox',
  },
  {
    key: 'show_on_main_site',
    label: 'Show link in the footer “Programs” column',
    type: 'checkbox',
  },
  { key: 'seo_title', label: 'Browser / Google title', type: 'text', max: 70 },
  { key: 'seo_description', label: 'Google description', type: 'textarea', max: 160 },
  { key: 'hero_kicker', label: 'Small label above the headline', type: 'text', max: 50 },
  { key: 'hero_headline', label: 'Headline', type: 'text', required: true, max: 70 },
  { key: 'hero_subtext', label: 'Sub-text', type: 'textarea', max: 220 },
  { key: 'hero_bullets', label: 'Tick points (up to 3)', type: 'strings', maxItems: 3, max: 80 },
  {
    key: 'countdown_date',
    label: 'Countdown to (optional)',
    type: 'datetime',
    help: 'Indian time. Leave empty for no countdown.',
  },
  {
    key: 'default_exam',
    label: 'Exam pre-selected in the form',
    type: 'select',
    required: true,
    options: EXAMS,
  },
  {
    key: 'benefits',
    label: 'Benefits (3 blocks)',
    type: 'objects',
    maxItems: 3,
    fixed: true,
    sub: [
      { key: 'title', label: 'Title', type: 'text', max: 40 },
      { key: 'text', label: 'One line', type: 'text', max: 100 },
    ],
  },
  { key: 'show_toppers', label: 'Show the toppers strip', type: 'checkbox' },
  {
    key: 'faqs',
    label: 'FAQs (up to 8)',
    type: 'objects',
    maxItems: 8,
    sub: [
      { key: 'q', label: 'Question', type: 'text', max: 120 },
      { key: 'a', label: 'Answer', type: 'textarea', max: 400 },
    ],
  },
  { key: 'cta_headline', label: 'Closing headline', type: 'text', max: 80 },
  { key: 'cta_button_label', label: 'Button label', type: 'text', max: 30 },
];

export const LANDING_DEFAULTS = () => ({
  slug: '',
  internal_name: '',
  published: false,
  show_on_main_site: false,
  seo_title: '',
  seo_description: '',
  hero_kicker: '',
  hero_headline: '',
  hero_subtext: '',
  hero_bullets: [''],
  countdown_date: '',
  default_exam: 'UPSC CSE',
  benefits: [
    { title: '', text: '' },
    { title: '', text: '' },
    { title: '', text: '' },
  ],
  show_toppers: false,
  faqs: [],
  cta_headline: '',
  cta_button_label: 'Book free counselling',
});

export const SETTINGS_FIELDS: Field[] = [
  {
    key: 'phone',
    label: 'Phone number (shown on the site)',
    type: 'text',
    required: true,
    max: 20,
    placeholder: '+91 98765 43210',
  },
  {
    key: 'whatsapp_number',
    label: 'WhatsApp number (digits with country code)',
    type: 'text',
    required: true,
    max: 15,
    placeholder: '919876543210',
  },
  { key: 'email', label: 'Email', type: 'text', required: true, max: 80 },
  { key: 'address', label: 'Address', type: 'textarea', required: true, max: 200 },
  url('map_url', 'Google Maps link'),
  url('youtube_url', 'YouTube channel link'),
  url('instagram_url', 'Instagram link'),
  url('telegram_url', 'Telegram link'),
  {
    key: 'attempt_years',
    label: 'Year-of-attempt choices in the enquiry form',
    type: 'strings',
    maxItems: 8,
    max: 4,
    help: 'Four-digit years, for example 2027.',
    pattern: '^\\d{4}$',
    patternHelp: 'Each year must be four digits, for example 2027.',
  },
];

/**
 * Switches that change what the website DOES (not what it says). They are deliberately not in any admin
 * form, and the backend ignores whatever the admin panel sends for them: the stored value is kept.
 * Only the developer changes them, by editing the file in git. `show_free_tests` adds the Free Tests
 * page and menu link; leave it false until the tests are ready.
 */
export const DEVELOPER_ONLY: Record<string, Record<string, boolean | string | number>> = {
  settings: { show_free_tests: false },
};

export const HOME_SECTIONS: { title: string; note?: string; fields: Field[] }[] = [
  {
    title: 'Hero',
    note: 'A video plays clean: full width, with no text or buttons on top of it. If there is only a poster picture (no video), the welcome line, headline, sub-text and buttons are shown on top of it. "Text on the hero" lets you override that. The text below is always saved, even while it is hidden. The search bar and the four stat tiles are always shown.',
    fields: [
      {
        key: 'hero_video_url',
        label: 'Video link',
        type: 'video',
        help: 'Plays behind the headline. YouTube link or a direct .mp4 link. On phones it shows the poster with a Play button to save data.',
      },
      {
        key: 'hero_poster',
        label: 'Poster image (shown before the video loads, and on phones)',
        type: 'image',
        folder: 'home',
        maxWidth: 1600,
        help: 'Wide (16:9) picture. Also used when there is no video.',
      },
      {
        key: 'hero_text',
        label: 'Text on the hero (welcome line, headline, sub-text and buttons)',
        type: 'select',
        options: ['Automatic', 'Always show', 'Always hide'],
        help: 'Automatic: hidden while a video is set (so the video is clean), shown when there is only a poster picture. Always show: put the text over the video or picture too. Always hide: show only the video or picture.',
      },
      {
        key: 'hero_kicker',
        label: 'Welcome line (small text above the headline)',
        type: 'text',
        max: 60,
        placeholder: 'Welcome to Chandigarh Civil Services,',
      },
      { key: 'hero_headline', label: 'Headline', type: 'text', required: true, max: 70 },
      { key: 'hero_subtext', label: 'Sub-text', type: 'textarea', max: 200 },
      {
        key: 'hero_btn1_label',
        label: 'Button 1 label (opens the enquiry form)',
        type: 'text',
        required: true,
        max: 30,
      },
      { key: 'hero_btn2_label', label: 'Button 2 label', type: 'text', required: true, max: 30 },
      {
        key: 'hero_btn2_link',
        label: 'Button 2 link',
        type: 'url',
        required: true,
        placeholder: '/courses',
      },
      {
        key: 'hero_search_placeholder',
        label: 'Search bar hint text',
        type: 'text',
        max: 60,
        placeholder: 'Search resources, updates and results',
        help: 'The search bar sits at the bottom of the hero. It searches free resources, exam updates and results.',
      },
      {
        key: 'hero_search_popular',
        label: 'Popular searches (up to 6)',
        type: 'strings',
        maxItems: 6,
        max: 24,
        help: 'Quick-tap words shown when someone clicks the search bar, for example Patwari or PYQ.',
      },
      {
        key: 'stats',
        label: 'Four stat tiles (shown under the search bar)',
        type: 'objects',
        maxItems: 4,
        fixed: true,
        sub: [
          { key: 'value', label: 'Value', type: 'text', max: 10 },
          { key: 'label', label: 'Label', type: 'text', max: 40 },
        ],
      },
    ],
  },
  {
    title: 'Founder & message',
    fields: [
      {
        key: 'founder_photo',
        label: 'Founder photo',
        type: 'image',
        folder: 'founder',
        maxWidth: 900,
      },
      { key: 'founder_name', label: 'Name', type: 'text', required: true, max: 50 },
      { key: 'founder_designation', label: 'Designation', type: 'text', max: 50 },
      { key: 'founder_kicker', label: 'Small label', type: 'text', max: 40 },
      { key: 'founder_headline', label: 'Headline', type: 'text', required: true, max: 60 },
      { key: 'founder_message', label: 'Message', type: 'textarea', max: 600 },
    ],
  },
  {
    title: 'Featured courses',
    fields: [
      {
        key: 'featured_course_ids',
        label: 'Three courses shown on the Home page',
        type: 'coursePick',
        maxItems: 3,
      },
    ],
  },
  {
    title: 'Call to action',
    fields: [
      { key: 'cta_headline', label: 'Headline', type: 'text', required: true, max: 70 },
      { key: 'cta_subtext', label: 'Sub-text', type: 'textarea', max: 160 },
      { key: 'cta_points', label: 'Three bullet points', type: 'strings', maxItems: 3, max: 90 },
    ],
  },
];

/** Validation shared by the drawer form and the single-file forms. Returns an error message or ''. */
export function validateFields(
  fields: Field[],
  data: Record<string, any>,
  adding: boolean,
): string {
  const urlOk = (v: string) => !v || /^(https?:\/\/|\/|#|mailto:|tel:)/i.test(v.trim());
  for (const f of fields) {
    if (f.showIf && !f.showIf(data)) continue;
    if (f.addOnly && !adding) continue;
    const v = data[f.key];
    if (f.required && (v === undefined || v === null || String(v).trim() === ''))
      return `${f.label} is required.`;
    if ((f.type === 'url' || f.type === 'video') && !urlOk(String(v ?? '')))
      return `${f.label} must start with https:// (or / for a page on this site).`;
    if (f.type === 'number' && v !== '' && v !== undefined && Number.isNaN(Number(v)))
      return `${f.label} must be a number.`;
    if (f.pattern) {
      const re = new RegExp(f.pattern, f.patternFlags);
      const mismatch =
        f.type === 'strings'
          ? ((v as string[]) ?? []).some((x) => !re.test(x))
          : String(v ?? '') !== '' && !re.test(String(v));
      if (mismatch) return f.patternHelp ?? `${f.label} is not in the expected format.`;
    }
    if (f.type === 'objects' && f.sub) {
      for (const row of (v as any[]) ?? [])
        for (const s of f.sub)
          if (s.type === 'url' && !urlOk(String(row[s.key] ?? '')))
            return `${s.label} must be a valid link.`;
    }
  }
  return '';
}
