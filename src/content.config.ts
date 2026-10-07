import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Schemas are deliberately forgiving (defaults everywhere): content is edited by
 * non-developers through /admin and one odd value must never break the build.
 */
const json = (base: string) => glob({ pattern: '*.json', base: `./src/content/${base}` });
const flag = z.boolean().default(true);

export const EXAMS = ['UPSC CSE', 'Punjab PSC (PCS)', 'Punjab One Day Exams', 'Other'] as const;

const settings = defineCollection({
  loader: json('settings'),
  schema: z.object({
    phone: z.string().default(''),
    whatsapp_number: z.string().default(''),
    email: z.string().default(''),
    address: z.string().default(''),
    map_url: z.string().default(''),
    youtube_url: z.string().default(''),
    instagram_url: z.string().default(''),
    telegram_url: z.string().default(''),
    attempt_years: z.array(z.string()).default(['2027', '2028', '2029']),
    show_free_tests: z.boolean().default(false),
  }),
});

const home = defineCollection({
  loader: json('home'),
  schema: z.object({
    hero_video_url: z.string().default(''),
    hero_poster: z.string().default(''),
    hero_kicker: z.string().default(''),
    hero_headline: z.string().default(''),
    hero_subtext: z.string().default(''),
    hero_btn1_label: z.string().default('Book free counselling'),
    hero_btn2_label: z.string().default('Explore courses'),
    hero_btn2_link: z.string().default('/courses'),
    hero_search_placeholder: z.string().default('Search resources, updates and results'),
    hero_search_popular: z
      .array(z.string())
      .default(['Patwari', 'PYQ', 'Admit card', 'Current affairs', 'Punjab GK']),
    stats: z.array(z.object({ value: z.string(), label: z.string() })).default([]),
    founder_name: z.string().default(''),
    founder_designation: z.string().default(''),
    founder_photo: z.string().default(''),
    founder_kicker: z.string().default('A message for students'),
    founder_headline: z.string().default(''),
    founder_message: z.string().default(''),
    featured_course_ids: z.array(z.string()).default([]),
    cta_headline: z.string().default(''),
    cta_subtext: z.string().default(''),
    cta_points: z.array(z.string()).default([]),
  }),
});

const courses = defineCollection({
  loader: json('courses'),
  schema: z.object({
    thumbnail: z.string().default(''),
    name: z.string(),
    price: z.string().default(''),
    category: z
      .enum(['UPSC CSE', 'Punjab PSC', 'Punjab One Day', 'Optional', 'Test series'])
      .default('UPSC CSE'),
    order: z.number().default(100),
    published: flag,
    dummy: z.boolean().optional(),
  }),
});

const teachers = defineCollection({
  loader: json('teachers'),
  schema: z.object({
    name: z.string(),
    subject: z.string().default(''),
    credential: z.string().default(''),
    bio: z.string().default(''),
    photo: z.string().default(''),
    intro_video_url: z.string().default(''),
    order: z.number().default(100),
    published: flag,
    dummy: z.boolean().optional(),
  }),
});

const results = defineCollection({
  loader: json('results'),
  schema: z.object({
    student_name: z.string(),
    exam: z.string().default(''),
    exam_year: z.string().default(''),
    rank_label: z.string().default(''),
    photo: z.string().default(''),
    quote: z.string().default(''),
    show_on_home: z.boolean().default(false),
    order: z.number().default(100),
    published: flag,
    dummy: z.boolean().optional(),
  }),
});

const resources = defineCollection({
  loader: json('resources'),
  schema: z.object({
    title: z.string(),
    subtitle: z.string().default(''),
    category: z
      .enum(['Notes & PDFs', 'PYQs', 'Current Affairs', 'Videos', 'Punjab GK'])
      .default('Notes & PDFs'),
    type: z.enum(['pdf', 'video', 'link']).default('pdf'),
    file: z.string().default(''),
    url: z.string().default(''),
    show_on_home: z.boolean().default(false),
    order: z.number().default(100),
    published: flag,
    dummy: z.boolean().optional(),
  }),
});

const examUpdates = defineCollection({
  loader: json('exam-updates'),
  schema: z.object({
    date: z.string(),
    exam_body: z.enum(['UPSC', 'PPSC', 'PSSSB', 'Punjab Police', 'Other']).default('Other'),
    category: z
      .enum(['Notification', 'Exam date', 'Admit card', 'Answer key', 'Result', 'Syllabus'])
      .default('Notification'),
    title: z.string(),
    link: z.string().default(''),
    published: flag,
    dummy: z.boolean().optional(),
  }),
});

const reels = defineCollection({
  loader: json('reels'),
  schema: z.object({
    instagram_url: z.string().default(''),
    student_name: z.string(),
    label: z.string().default(''),
    cover: z.string().default(''),
    order: z.number().default(100),
    published: flag,
    dummy: z.boolean().optional(),
  }),
});

const landingPages = defineCollection({
  loader: json('landing-pages'),
  schema: z.object({
    slug: z.string(),
    internal_name: z.string().default(''),
    published: z.boolean().default(false),
    show_on_main_site: z.boolean().default(false),
    seo_title: z.string().default(''),
    seo_description: z.string().default(''),
    hero_kicker: z.string().default(''),
    hero_headline: z.string().default(''),
    hero_subtext: z.string().default(''),
    hero_bullets: z.array(z.string()).default([]),
    countdown_date: z.string().default(''),
    default_exam: z.string().default('UPSC CSE'),
    benefits: z.array(z.object({ title: z.string(), text: z.string() })).default([]),
    show_toppers: z.boolean().default(false),
    faqs: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    cta_headline: z.string().default(''),
    cta_button_label: z.string().default('Book free counselling'),
    dummy: z.boolean().optional(),
  }),
});

const tests = defineCollection({
  loader: json('tests'),
  schema: z.object({
    title: z.string(),
    exam: z.string().default(''),
    question_count: z.number().default(0),
    duration_min: z.number().default(0),
    test_url: z.string().default(''),
    published: flag,
    dummy: z.boolean().optional(),
  }),
});

export const collections = {
  settings,
  home,
  courses,
  teachers,
  results,
  resources,
  reels,
  'exam-updates': examUpdates,
  'landing-pages': landingPages,
  tests,
};
