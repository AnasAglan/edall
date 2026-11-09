# تقرير تشخيصي: عقد المساعد مع Worker (بدون أي تعديل)

## 1. ما ترسله الواجهة — `public/ed_assistant.js`
- العنوان: سطر 3 `ENDPOINT="https://edall-assistant.anasaglan2011.workers.dev"`.
- الطلب: سطر 103 — `POST` بالترويستين `Content-Type: application/json` و`Authorization: Bearer <token>`.
- الجسم: `{ conversationId, messages: history.slice(-12), images }` حيث `messages` = `[{role, content}]` و`images` = `[{mimeType, name, data(base64)}]`.
- الأخطاء: سطر 104 — إذا لم يكن `res.ok` تقرأ `d.error`.
- قراءة الرد: سطر 80 `readResponse`:
  - إذا كان JSON: تقرأ `d.response` فقط (لا تقرأ `answer`).
  - غير ذلك تعامله كبث SSE: سطور `data:`، تتجاهل `[DONE]`، وتقرأ `choices[0].delta.content` أو `response`.
- يتم تحميل الملف من `public/ed_master.html` سطر 11068. ولا توجد في `ed_master.html` الآن أي واجهة قديمة تستخدم `{message}` / `{answer}`.

## 2. ما يرد به Worker — `workers/edall-assistant/index.js`
- CORS (سطور 4–7 و127–138): يسمح فقط بـ `edall.lovable.app` ورابط المعاينة، وبالترويسات `Authorization, Content-Type, apikey`.
- الأخطاء كلها JSON بالشكل `{error}` (الدالة `json` في سطر 140): 401 للجلسة، 403 للدور أو المصدر، 400 للجسم أو إذا لم تكن الرسائل بين 1 و12، 422/502 لعمليات الكتابة، 500 في catch النهائي (سطور 2033–2040).
- رسائل التأكيد والكتابة تُرسل SSE بالشكل `data: {"response": "..."}` ثم `[DONE]` (`sseTextResponse` سطر 1770، وسطر 1920).
- الرد النهائي (سطور 2022–2031): `runAssistantModel(..., stream: true)` ويُمرَّر كما هو بترويسة `text/event-stream`.
- لا يوجد في أي مسار حقل `answer`. الرد يأتي إما `response` أو بث `choices[].delta`.

النتيجة: شكل الطلب والترويسات وأسماء الحقول متطابقة بين الواجهة وWorker. ملاحظة: وصف العقد القديم بأنه `{message}` → `{answer}` لم يعد صحيحًا.

## 3. التعارض المثبت: نجاح Gemini يكسر حلقة الأدوات
- `runAssistantModel` (سطور 49–69): عندما ينجح Gemini تُرجع الدالة كائن `fetch Response` خامًا (سطر 62 `return response;`) ولا تقرأ منه JSON. أما مسار Workers AI البديل فيُرجع كائنًا جاهزًا.
- سطر 1963: `result?.choices?.[0]?.message` على كائن `Response` تكون قيمته `undefined`، فيعود سطر 1964 بالخطأ **502 «لم يرجع النموذج استجابة مفهومة.»**.
- لذلك كلما كان `GEMINI_API_KEY` موجودًا ونجح Gemini، يفشل كل طلب عادي قبل الوصول إلى البث. المفارقة أن المساعد يعمل فقط عندما يفشل Gemini ويعمل البديل.
- نفس الخلل في مصنّف نية الكتابة (سطور 77–89 و103–118): قيمة `verdict` تكون دائمًا فارغة، فيُعتبر القرار «لا» بصمت.
- البث النهائي (سطر 2022) يعمل مع الطريقتين: Gemini يرسل `choices[0].delta.content` وWorkers AI يرسل `response`، والواجهة تقرأ الاثنين. لكن التنفيذ لا يصل إلى هذا السطر بسبب الخلل في سطر 1964.

## 4. ملاحظات ثانوية (غير مثبتة كأعطال)
- عند فشل Gemini مع عدم وجود `env.AI`: يظهر الخطأ 500 برسالة عامة، أو برسالة «حد Workers AI» إذا احتوى نص الخطأ كلمة quota/limit. الرسالة قد تضلّل لأن العطل من Gemini.
- العمل من `localhost` يُرفض بخطأ 403 «Origin not allowed»، وهذا متوقع بحسب القائمة المسموحة.
- الواجهة تعرض أي JSON ناجح لا يحتوي `response` على أنه «لم يصل نص الرد»، وهذا متسق مع Worker.

## الإصلاح المقترح (لا يُنفَّذ إلا بموافقتك الصريحة)
تعديل واحد في `workers/edall-assistant/index.js` داخل `runAssistantModel`: إذا لم يكن الطلب بثًا (`options.stream` ليست true) تُرجع الدالة `await response.json()` بدل `response`، وتبقى طلبات البث تُرجع `response.body`. بعد ذلك يجب إعادة نشر Worker يدويًا عبر Cloudflare، لأنه لا يُنشر من هنا. لن يُلمس مشغل الفيديو ولا قاعدة البيانات ولا الإعدادات.
