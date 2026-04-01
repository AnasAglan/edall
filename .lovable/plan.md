

# خطة إصلاح وتحسين منصة ED MASTER

## ملخص التغييرات
إصلاح مشاكل التحميل البطيء، إضافة أزرار تعديل/حذف المحاضرات، منع إغلاق النوافذ عند الضغط خارجها، إضافة تعطيل الحسابات، تحميل 5 كورسات فقط مبدئياً، وإصلاح التحميل الموضعي.

---

## المشاكل المكتشفة والحلول

### 1. التحميل البطيء عند فتح الموقع
- **السبب**: `loadData()` تحمّل *جميع* الكورسات والمحاضرات والفيديوهات والامتحانات مرة واحدة عند فتح الموقع.
- **الحل**: تحميل أحدث 5 كورسات فقط مع بيانات الملف الشخصي والأدوار. باقي الكورسات تظهر فقط عندما يبحث المستخدم. عند فتح كورس معين، يتم تحميل محاضراته وامتحاناته من DB في تلك اللحظة (lazy loading).

### 2. التحميل يظهر على الصفحة بالكامل
- **السبب**: `showLoading()` تعرض overlay يغطي الشاشة كاملة.
- **الحل**: إنشاء دالة `showInlineLoading(containerId)` و `hideInlineLoading(containerId)` تعرض spinner صغير داخل العنصر المحدد فقط (مثل مكان الكورسات أو زر الحفظ)، واستخدام التحميل الكامل فقط لتسجيل الدخول/الخروج.

### 3. النوافذ (Modals) تغلق عند الضغط خارجها
- **السبب**: `showModal()` تضيف event listener على `modalBackground` يغلق عند `e.target === this`.
- **الحل**: إزالة هذا الـ listener. النافذة تغلق فقط عند الضغط على زر الإغلاق (×) أو زر "إغلاق".

### 4. لا يوجد زر تعديل/حذف المحاضرة
- **الحل**: في `showCourseDetails()` و `openLesson()`، إضافة أزرار "تعديل" و"حذف" بجانب كل محاضرة للمدرس صاحب الكورس والمدير فقط (`canUserEditCourse`).
- دالة `editLesson(courseId, lessonId)` تفتح modal بنفس شكل `addLessonToCourse` لكن مملوءة بالبيانات الحالية.
- دالة `deleteLesson(courseId, lessonId)` تحذف المحاضرة من DB.
- دالة `updateLessonInDB(courseId, lessonId)` تحدّث العنوان والمحتوى والفيديوهات والملفات.

### 5. إضافة زر تعطيل الحساب في لوحة الإدارة
- **Migration**: إضافة عمود `banned boolean DEFAULT false` لجدول `profiles`.
- في `renderUserList()`: إضافة زر "تعطيل/تفعيل" بجانب كل مستخدم (ما عدا حساب الأدمن الحالي).
- حذف زر "مسح الحساب" من بجانب حساب الأدمن.
- عند تسجيل الدخول (`handleSignIn` و `onAuthStateChange`): بعد تحميل بيانات المستخدم، فحص `banned`. إذا `true`: تسجيل خروج فوري + عرض رسالة "تم حظر حسابك".

### 6. التحميل البطيء عند حفظ محاضرة بفيديو/PDF
- **السبب**: `showLoading()` تغطي الشاشة كاملة أثناء الرفع.
- **الحل**: استخدام `showInlineLoading` على زر الحفظ أو منطقة المحاضرة بدلاً من الـ overlay الكامل.

### 7. التحميل البطيء عند إعادة تحميل الصفحة
- **السبب**: `onAuthStateChange` تستدعي `loadData()` بالكامل مرة أخرى، و`initializeApp` أيضاً.
- **الحل**: منع الاستدعاء المزدوج لـ `loadData` عبر flag `dataLoaded`، وتحميل الكورسات بـ `.limit(5)` مبدئياً.

### 8. البحث يعرض الكورسات المحمّلة فقط
- **الحل**: عند الكتابة في شريط البحث، عمل `sb.from('courses').select('*').ilike('title', '%search%').limit(20)` من DB مباشرة مع debounce 300ms، وعرض النتائج في dropdown أسفل شريط البحث.

---

## خطوات التنفيذ

### الخطوة 1: Migration - إضافة عمود banned
```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS banned boolean DEFAULT false;
```

### الخطوة 2: تحديث ed_master.html

#### 2a. نظام التحميل الموضعي
- إنشاء `showInlineLoading(elementId)` و `hideInlineLoading(elementId)` تضع spinner داخل عنصر محدد.
- استبدال `showLoading()`/`hideLoading()` في `saveLesson`, `createNewCourseFromModal`, `updateCourse`, `saveExam` بالنسخة الموضعية.
- إبقاء التحميل الكامل فقط لـ `handleSignIn` و `handleSignUp` و `initializeApp`.

#### 2b. التحميل الكسول (Lazy Loading)
- تعديل `loadData()`: تحميل أحدث 5 كورسات فقط (`.limit(5)`), بدون محاضرات/فيديوهات/امتحانات.
- إنشاء `loadCourseDetails(courseId)`: عند فتح كورس، تحميل محاضراته وفيديوهاته وملفاته وامتحاناته من DB وتحديث الـ cache المحلي.
- تعديل `showCourseDetails()` و `openLesson()` لاستدعاء `loadCourseDetails` أولاً.
- تعديل `renderCoursesGrid()` لعرض الكورسات المحمّلة فقط.

#### 2c. البحث الحيّ من DB
- تعديل `handleSearch()`: استخدام debounce + استعلام DB مباشر.
- عرض نتائج البحث في dropdown أسفل شريط البحث.
- عند الضغط على نتيجة: فتح صفحة الكورس.

#### 2d. إزالة إغلاق Modal عند الضغط خارجها
- في `showModal()`: إزالة الـ event listener على `modalBackground`.

#### 2e. أزرار تعديل/حذف المحاضرة
- في `showCourseDetails()`: إضافة أزرار "تعديل" و "حذف" بجانب كل محاضرة (فقط إذا `canUserEditCourse`).
- دالة `editLesson(courseId, lessonId)`: modal تعديل المحاضرة.
- دالة `updateLessonInDB(courseId, lessonId)`: تحديث في DB (lessons + lesson_videos + lesson_files).
- دالة `deleteLesson(courseId, lessonId)`: حذف من DB + تحديث المحلي.

#### 2f. تعطيل الحسابات
- في `renderUserList()`: إضافة زر "تعطيل" لكل مستخدم (ما عدا الأدمن الحالي).
- دالة `toggleBanUser(userId)`: تحديث `banned` في `profiles`.
- إخفاء زر "حذف" من بجانب حساب الأدمن.
- في `handleSignIn` و `onAuthStateChange`: فحص `banned` بعد تحميل الملف الشخصي. إذا محظور: `sb.auth.signOut()` + رسالة "تم حظر حسابك".

---

## التفاصيل التقنية

### Migration SQL:
```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS banned boolean DEFAULT false;
```

### ملفات تتأثر:
- `public/ed_master.html` - جميع التغييرات
- Migration SQL جديد واحد

### الدوال الجديدة:
- `showInlineLoading(elementId)` / `hideInlineLoading(elementId)`
- `loadCourseDetails(courseId)` - تحميل كسول لتفاصيل الكورس
- `editLesson(courseId, lessonId)` - modal تعديل المحاضرة
- `updateLessonInDB(courseId, lessonId)` - حفظ التعديلات
- `deleteLesson(courseId, lessonId)` - حذف المحاضرة
- `toggleBanUser(userId)` - تعطيل/تفعيل الحساب
- `searchCoursesFromDB(term)` - بحث حيّ من DB

### الدوال المعدّلة:
- `loadData()` - تحميل 5 كورسات فقط بدون محاضرات
- `showModal()` - إزالة إغلاق عند الضغط خارج النافذة
- `showCourseDetails()` - lazy load + أزرار تعديل/حذف
- `openLesson()` - lazy load
- `handleSearch()` - بحث من DB
- `renderUserList()` - أزرار تعطيل + إخفاء حذف الأدمن
- `handleSignIn()` - فحص الحظر
- `saveLesson()` - تحميل موضعي
- `createNewCourseFromModal()` - تحميل موضعي
- `initializeApp()` - منع التحميل المزدوج

