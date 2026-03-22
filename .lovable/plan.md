

# خطة إكمال تحديث المنصة

## المشاكل المكتشفة

1. **submitExam و saveEssayGrades** تحفظان في localStorage فقط، لا تحفظان في قاعدة البيانات
2. **addNewUser** (لوحة الإدارة) تحفظ محلياً فقط ولا تنشئ حساب حقيقي في النظام
3. **handle_new_user** trigger غير مفعّل - عند التسجيل `setup_new_user` يُستدعى يدوياً لكن أول مستخدم فقط يحصل على admin
4. **renderManageCoursesPage** تقارن `course.createdBy === currentUser.email` لكن `createdBy` هو UUID وليس email - هذا يمنع المدرس من رؤية كورساته
5. **لا يوجد loading spinner** عند تسجيل الدخول/الإنشاء
6. **لا يظهر اسم المدرس** على بطاقة الكورس ولا توجد صفحة مدرس
7. **لا يوجد دعم PDF** في إضافة المحاضرة
8. **لا يوجد تعديل محاضرة** - فقط إضافة
9. **دعم فيديو محدود** - placeholder يقول YouTube فقط، لا يدعم 4shared و Dailymotion
10. **profiles لا تحتوي على حقل bio** لوصف المدرس
11. **لا يوجد تعيين أدوار من لوحة الإدارة** بشكل فعّال عبر قاعدة البيانات

---

## خطوات التنفيذ

### 1. تحديث قاعدة البيانات (Migration)
- إضافة حقل `bio` لجدول `profiles` لوصف المدرس عن نفسه
- إنشاء storage bucket `lesson-pdfs` لحفظ ملفات PDF
- إنشاء storage bucket `course-images` لصور الكورسات
- تفعيل trigger `handle_new_user` على `auth.users` بعد INSERT

### 2. تحديث `submitExam` لحفظ النتائج في DB
- بعد حساب النتيجة، إدراج سجل في `exam_results` عبر Supabase
- تخزين `exam_id` الفعلي بدل `examIndex`
- إزالة الاعتماد على localStorage لنتائج الامتحان

### 3. تحديث `saveEssayGrades` لحفظ التصحيح في DB
- تحديث سجل `exam_results` في Supabase بالدرجات النهائية
- تحديث `passed` و `score` و `essay_graded` و `answers` في DB

### 4. إصلاح `addNewUser` في لوحة الإدارة
- استخدام edge function لإنشاء مستخدمين جدد (لأن signUp من العميل لا يسمح بتحديد الدور)
- أو: إنشاء الحساب عبر `sb.auth.signUp` ثم تعيين الدور عبر `user_roles` insert (المدير لديه صلاحية)

### 5. إضافة Loading Spinners
- إضافة spinner/overlay أثناء تسجيل الدخول وإنشاء الحساب
- إضافة spinner لأي عملية async (إنشاء كورس، حفظ محاضرة، تسليم امتحان)

### 6. عرض اسم المدرس على بطاقة الكورس + صفحة المدرس
- في `renderCoursesGrid`: إضافة اسم المدرس (من `users` array باستخدام `course.createdBy` UUID)
- عند الضغط على اسم المدرس: فتح صفحة المدرس (اسم، صورة، bio، كورساته)
- إضافة صفحة جديدة `teacherProfilePage` في HTML

### 7. إصلاح مقارنة `createdBy`
- في `renderManageCoursesPage` سطر 3624: تغيير `course.createdBy === currentUser.email` إلى `course.createdBy === currentUser.id`
- التأكد من أن `createdBy` يُحفظ كـ UUID في كل مكان

### 8. دعم فيديوهات متعددة المنصات
- تحديث placeholder ليشمل YouTube, Dailymotion, 4shared
- تحديث `getYouTubeEmbedUrl` لتشمل Dailymotion embed و 4shared player
- إعادة تسمية الدالة لـ `getVideoEmbedUrl`

### 9. دعم ملفات PDF في المحاضرة
- إضافة input لرفع ملفات PDF في `addLessonToCourse`
- حفظ ملفات PDF في Supabase Storage bucket `lesson-pdfs`
- إنشاء جدول `lesson_files` (id, lesson_id, file_url, file_name, sort_order) لربط الملفات بالمحاضرات
- عرض ملفات PDF في `openLesson`

### 10. تعديل المحاضرة
- إضافة زر "تعديل" بجانب كل محاضرة في `showCourseDetails`
- modal تعديل يحمّل بيانات المحاضرة الحالية (عنوان، محتوى، فيديوهات، ملفات)
- دالة `updateLesson` تحدّث الدرجة في DB وتحذف/تضيف فيديوهات وملفات

### 11. إضافة حقل bio في صفحة الملف الشخصي
- textarea في `renderProfilePage` لإضافة/تعديل الوصف الشخصي
- حفظ `bio` في جدول `profiles`

---

## التفاصيل التقنية

### Migration SQL المطلوب:
```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio text;

CREATE TABLE public.lesson_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
    file_url text NOT NULL,
    file_name text NOT NULL,
    sort_order integer DEFAULT 0
);
ALTER TABLE public.lesson_files ENABLE ROW LEVEL SECURITY;
-- RLS policies similar to lesson_videos
```

### Storage Buckets:
- `lesson-pdfs` - public read, authenticated upload
- `course-images` - public read, authenticated upload

### ملفات تتأثر:
- `public/ed_master.html` - التحديث الرئيسي (جميع الدوال المذكورة)
- Migration SQL جديد
- لا حاجة لتعديل ملفات React (المنصة تعمل من ed_master.html)

