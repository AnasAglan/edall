

# خطة تطوير منصة ED MASTER

## ملخص
تحويل المنصة من localStorage إلى قاعدة بيانات Supabase حقيقية، إصلاح اللغة، إضافة خيار "يجب النجاح للمتابعة"، وإضافة روابط URL لكل صفحة.

---

## المتطلبات

### 1. إصلاح اللغة (لا تطبق على كامل الصفحة)
المشكلة: `updateLanguageUI` تغير `dir` و `lang` لكنها لا تُعيد عرض النصوص الثابتة في HTML مثل عناوين البطاقات والأزرار والنصوص الثابتة في كورسات المنضمة/المفضلة.

**الحل:**
- توسيع `updateLanguageUI` لتشمل جميع النصوص الثابتة في HTML (labels, stat labels, filter tabs, breadcrumbs, placeholders, page titles)
- إضافة `data-i18n` attributes على العناصر الثابتة مع قاموس ترجمة
- إعادة render لكل الصفحات المرئية عند تغيير اللغة (enrolled, favorites, manage courses, profile, settings, notifications)

### 2. خيار "يجب النجاح للمتابعة" في صفحة إنشاء الامتحان
**الحل:**
- إضافة checkbox في `showAddExamModal` و `showEditExamModal`: `<input type="checkbox" id="examRequiredToPass">`
- حفظ الحقل `requiredToProgress: true/false` مع بيانات الامتحان في `saveExam`
- في `openLesson`، قبل عرض المحاضرات التالية: فحص إذا كانت المحاضرة السابقة تحتوي على امتحان إجباري ولم ينجح فيه الطالب، نعرض رسالة تحذيرية ونمنع الفتح
- في `showCourseDetails` عند عرض قائمة المحاضرات: إضافة قفل (lock icon) على المحاضرات المقفلة

### 3. روابط URL لكل صفحة وكورس (باستخدام معاملات URL)
**الحل:**
- إضافة نظام routing يعتمد على `URLSearchParams`:
  - `/ed_master.html` → الصفحة الرئيسية
  - `/ed_master.html?page=course&id=xxx` → صفحة كورس
  - `/ed_master.html?page=admin` → لوحة الإدارة (محمية)
  - `/ed_master.html?page=login` → تسجيل الدخول
  - `/ed_master.html?page=profile` → الملف الشخصي
  - `/ed_master.html?page=enrolled` → كورساتي
  - `/ed_master.html?page=favorites` → المفضلة
- تعديل `showPage` لاستخدام `history.pushState` لتحديث URL
- إضافة listener لـ `popstate` للتنقل بزر الرجوع
- حماية صفحة admin: عند فتح `?page=admin` بدون تسجيل دخول كمدير → إعادة توجيه لتسجيل الدخول

### 4. قاعدة بيانات Supabase (Lovable Cloud)
**الهيكل:**

```text
الجداول:
├── profiles (id, name, email, avatar_url, phone, joined_at)
├── user_roles (id, user_id FK→auth.users, role ENUM[admin,teacher,student])
├── courses (id, title, description, image_url, created_by FK→auth.users, created_at)
├── lessons (id, course_id FK→courses, title, content, sort_order, created_at)
├── lesson_videos (id, lesson_id FK→lessons, video_url, sort_order)
├── exams (id, lesson_id FK→lessons, title, passing_grade, time_limit, allow_retake, required_to_progress, created_at)
├── exam_questions (id, exam_id FK→exams, text, type ENUM[multiple,essay], options JSONB, correct_option INT, sort_order)
├── exam_results (id, user_id FK→auth.users, exam_id FK→exams, score, passed, has_essay, essay_graded, answers JSONB, submitted_at)
├── enrollments (id, user_id FK→auth.users, course_id FK→courses, enrolled_at)
├── favorites (id, user_id FK→auth.users, course_id FK→courses)
├── lesson_progress (id, user_id FK→auth.users, lesson_id FK→lessons, video_watched, pdf_opened, exam_completed)
└── notifications (id, user_id, title, message, type, read, created_at)
```

**RLS Policies:**
- profiles: users read own, admin reads all
- courses: everyone reads, teachers/admins insert/update own
- user_roles: security definer function `has_role()` لتجنب recursion
- exam_results: users read own, teachers read course students
- enrollments/favorites: users manage own

**خطوات التنفيذ:**
1. تفعيل Lovable Cloud
2. إنشاء migrations للجداول
3. إنشاء Supabase auth بدل نظام المصادقة الحالي (email/password)
4. تعديل كل دوال `loadData`/`saveAllData` لتستخدم Supabase client بدل localStorage
5. إنشاء حساب admin افتراضي
6. تحويل كل العمليات (CRUD) لتستخدم Supabase queries

**ملاحظة مهمة:** هذا التغيير كبير جداً. سيتم تحويل المنصة بالكامل من ملف HTML واحد مع localStorage إلى تطبيق React + Supabase. الملف `ed_master.html` سيتم تحويله إلى React components مع Supabase backend.

---

## ترتيب التنفيذ
1. إصلاح اللغة أولاً (أسرع إصلاح)
2. إضافة خيار "يجب النجاح للمتابعة"
3. نظام الروابط URL
4. تفعيل Supabase وإنشاء الجداول
5. تحويل المصادقة إلى Supabase Auth
6. تحويل CRUD operations إلى Supabase
7. حماية لوحة الإدارة

---

## التفاصيل التقنية

- **المصادقة**: Supabase Auth مع email/password (بدل التخزين المحلي لكلمات المرور)
- **الصور**: يمكن استخدام Supabase Storage لصور الكورسات والأفاتار
- **الأمان**: RLS على كل الجداول + security definer functions للأدوار
- **البنية**: تحويل إلى React components بدل ملف HTML واحد (ضروري للتكامل مع Supabase)

