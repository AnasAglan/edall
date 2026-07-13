## المطلوب

### 1. منع تكرار أسماء الكورسات
- إضافة migration لإضافة UNIQUE constraint على عمود `title` في جدول `courses` (case-insensitive عبر unique index على `lower(title)`).
- في `public/ed_master.html`: قبل إنشاء/تعديل الكورس، فحص وجود الاسم مسبقاً وعرض رسالة خطأ واضحة بالعربية/الإنجليزية بدلاً من رسالة قاعدة البيانات.

### 2. منع تكرار الإيميلات في الحسابات
- Supabase Auth أصلاً يمنع تكرار الإيميل في `auth.users`، لكن جدول `profiles.email` غير مقيّد.
- إضافة UNIQUE index على `lower(email)` في `profiles`.
- في نموذج التسجيل و `admin-create-user` edge function: التقاط خطأ التكرار وعرض رسالة "هذا الإيميل مستخدم بالفعل / Email already in use".

### 3. زر تليجرام عائم دائم
- إضافة زر دائري ثابت (fixed) في أسفل يمين الشاشة (أو يسار حسب اتجاه اللغة) بأيقونة تليجرام ولون تليجرام المميز (#0088cc) مع ظل ناعم وحركة hover.
- عند الضغط: يفتح modal صغير (نفس نظام المودالات الحالي بحيث لا يُغلق بالنقر على الخلفية).
- محتوى المودال:
  - صورة QR (سأرفعها كأصل عبر lovable-assets من `user-uploads://image.png` وأستخدم رابط CDN).
  - أسفلها زر مستطيل مكتوب عليه **Chat / محادثة** بأيقونة تليجرام يفتح `https://t.me/anasaglan` في تبويب جديد.
  - زر إغلاق (X) في الأعلى.
- ترجمة النصوص في نظام i18n الحالي.

## الملفات المتأثرة
- migration جديد: unique constraints على `courses.title` و `profiles.email`.
- `public/ed_master.html`: زر عائم + modal + منطق فحص التكرار + ترجمات.
- `src/assets/telegram-qr.png.asset.json`: مرجع صورة QR عبر lovable-assets.
