## 1) إصلاح: البريد الإلكتروني يظهر في خانة البحث

المتصفح يعبّي حقل البحث تلقائياً ببريد الحساب. الإصلاح في `public/ed_master.html`:
- تغيير سمات `#searchInput`: إضافة `autocomplete="off"` + `autocorrect="off"` + `spellcheck="false"` + `data-form-type="other"` + `aria-autocomplete="none"`، وتغيير `name` إلى قيمة عشوائية غير قابلة للتخمين (لأن Chrome يتجاهل `autocomplete="off"` أحياناً).
- تغليف الحقل داخل `<form autocomplete="off">` وإضافة حقل مخفي وهمي (`<input type="text" style="display:none">`) لكسر heuristic التعبئة التلقائية.
- بعد جلسة المستخدم عند تحميل الصفحة: مسح صريح للحقل عبر `requestAnimationFrame` مضاعف + `setTimeout(0/100/500)` للتغلب على التعبئة المتأخرة من مدير كلمات المرور.

## 2) نظام المحفظة (Wallet)

### قاعدة البيانات — migration جديد
- `public.wallets`: `user_id` (PK, FK → auth.users, ON DELETE CASCADE)، `balance` (numeric(12,2) default 0)، `updated_at`.
- `public.wallet_transactions`: `id`، `user_id`، `amount` (موجب=شحن، سالب=خصم)، `type` (`topup` | `adjust`)، `note`، `created_by` (admin uuid nullable)، `created_at`.
- `public.wallet_topup_contacts`: `id`، `phone` (text)، `link` (text nullable)، `sort_order` (int)، `created_at`، `updated_at`. لتخزين أرقام الشحن التي يديرها الأدمن.
- GRANTs كاملة (authenticated + service_role)، بدون anon.
- تفعيل RLS + سياسات:
  - `wallets`: قراءة صف المستخدم فقط؛ الأدمن يقرأ الكل؛ الإدراج/التحديث للأدمن فقط (عبر `has_role`).
  - `wallet_transactions`: قراءة صفوف المستخدم نفسه؛ الأدمن يقرأ ويُدرج للجميع.
  - `wallet_topup_contacts`: SELECT للـ authenticated الكل؛ INSERT/UPDATE/DELETE للأدمن فقط.
- دالة RPC آمنة `admin_credit_wallet(_user_id uuid, _amount numeric, _note text)` — `SECURITY DEFINER`، تتحقق `has_role(auth.uid(),'admin')`، تُنشئ صف wallet إن لم يوجد، ترفع الرصيد، تُدرج معاملة، تُنشئ إشعار للمستخدم في `notifications`.
- تريغر `handle_new_user` (أو إضافة استدعاء داخل `setup_new_user`) لإنشاء صف wallet برصيد 0 عند تسجيل مستخدم جديد.

### الواجهة داخل `public/ed_master.html`

#### أ) زر المحفظة في الشريط العلوي
- يظهر فقط عند وجود جلسة (`currentUser`). أيقونة محفظة + الرصيد الحالي بجواره.
- الضغط ينقل إلى المسار `#/wallet` (نظام hash routing الموجود).

#### ب) صفحة المحفظة `#/wallet`
للمستخدم العادي:
- بطاقة كبيرة تعرض الرصيد.
- زر **شحن الرصيد / Top up**: يفتح modal (لا يُغلق بالنقر على الخلفية) يعرض قائمة `wallet_topup_contacts` — كل عنصر: رقم الهاتف + زر رابط (واتساب/تليجرام/الخ) تحته.
- في زاوية الـ modal علامة قلم (fa-pen) تظهر فقط للأدمن → تفتح modal إدارة الأرقام (إضافة/تعديل/حذف رقم + رابط لكل رقم، مع ترتيب).

للأدمن (نفس صفحة `#/wallet` أو زر إضافي داخلها):
- زر **شحن مستخدم**: ينقل إلى `#/wallet/admin-topup`.

#### ج) صفحة شحن المستخدمين (أدمن فقط) `#/wallet/admin-topup`
- شريط بحث في الأعلى (debounced 300ms) يبحث بالاسم/الإيميل عبر `search_teachers_public`-like RPC جديدة `admin_search_users(_term)` تُرجع كل المستخدمين (id, name, email, avatar_url, balance) — `SECURITY DEFINER` مع فحص أدمن.
- قائمة المستخدمين في الأسفل — infinite scroll أو limit 50.
- بجانب كل مستخدم زر ➕ يفتح modal في الوسط: حقل مبلغ + ملاحظة اختيارية + زر تأكيد → يستدعي `admin_credit_wallet` → toast + تحديث الرصيد في القائمة.

#### د) المسارات (Hash Routes)
- `#/wallet` — صفحة المحفظة (يتطلب تسجيل).
- `#/wallet/admin-topup` — صفحة الشحن للأدمن (يتطلب دور admin، وإلا redirect).
- إضافتها إلى نظام التوجيه الحالي في `handleRouteChange`.

#### هـ) i18n
- إضافة كل النصوص الجديدة في كائنات الترجمة العربية والإنجليزية الموجودة.

### التحقق
- بعد الـ migration: تشغيل `psql` للتأكد من إنشاء الجداول والدالة.
- اختبار يدوي عبر Playwright:
  1. تحميل الصفحة كمستخدم مسجّل → التأكد أن حقل البحث فارغ.
  2. الضغط على زر المحفظة → صفحة المحفظة تعرض الرصيد.
  3. فتح modal الشحن → قراءة الأرقام.
  4. تسجيل دخول كأدمن → علامة القلم ظاهرة، إضافة رقم يُحفظ.
  5. صفحة `#/wallet/admin-topup` → البحث يعمل، الضغط على ➕ ثم إدخال مبلغ → رصيد المستخدم يتحدّث في DB.

## الملفات المتأثرة
- migration جديد: جداول wallets + wallet_transactions + wallet_topup_contacts + RPCs + سياسات + GRANTs + trigger.
- `public/ed_master.html`: إصلاح autofill، زر المحفظة، صفحات/modals المحفظة، مسارات، ترجمات.
- `src/integrations/supabase/types.ts`: يُعاد توليده تلقائياً بعد الـ migration.
