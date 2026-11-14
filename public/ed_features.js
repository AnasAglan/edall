(() => {
  "use strict";

  const rootId = "edFeaturesRoot";
  const state = {
    user: null,
    roles: [],
    courses: [],
    courseId: "",
    availablePaidCourses: [],
    tab: "",
    busy: false,
    data: {},
    error: "",
    publicToken: "",
    mfaFactorId: "",
    mfaChallengeId: "",
    mfaQr: "",
    exportRows: []
  };

  const text = (ar, en) => (document.documentElement.lang || "ar").toLowerCase().startsWith("ar") ? ar : en;
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
  const fmtDate = (v) => {
    if (!v) return text("غير محدد", "Not set");
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? esc(v) : d.toLocaleString(document.documentElement.lang || "ar");
  };
  const formatAmount = (v,currency) => {
    const n = Number(v || 0);
    return new Intl.NumberFormat(document.documentElement.lang || "ar", { maximumFractionDigits: 2 }).format(n) + " " + (currency || "EGP");
  };
  const sb = () => window.sb;
  const currentUser = () => window.currentUser || state.user;
  const isAdmin = () => state.roles.includes("admin");
  const isTeacher = () => state.roles.includes("teacher") || isAdmin();
  const isStudent = () => state.roles.includes("student") || (!isAdmin() && !state.roles.includes("teacher"));
  const notify = (msg, type) => {
    if (typeof window.showToast === "function") window.showToast(msg, type || "info");
    else console[(type === "error" ? "error" : "log")](msg);
  };
  const rpc = async (name, args) => {
    const client = sb();
    if (!client) throw new Error(text("جلسة المنصة غير جاهزة.", "Platform session is not ready."));
    const { data, error } = await client.rpc(name, args || {});
    if (error) throw error;
    return data;
  };
  const rows = async (table, build) => {
    const client = sb();
    if (!client) throw new Error(text("جلسة المنصة غير جاهزة.", "Platform session is not ready."));
    let q = client.from(table).select("*");
    if (typeof build === "function") q = build(q);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  };
  const actionError = (e) => {
    const message = e && e.message ? e.message : String(e || "Unknown error");
    if (/ADMIN_MFA_REQUIRED|MFA_REQUIRED/i.test(message)) return text("يلزم تفعيل المصادقة الثنائية للمدير ثم تأكيد الرمز.", "Administrator MFA must be enabled and verified.");
    if (/PAYMENT_PROVIDER_NOT_CONFIGURED/i.test(message)) return text("الدفع الإلكتروني غير مفعّل بعد؛ لم يتم ضبط مفاتيح مزود الدفع.", "Online payments are not enabled yet; the payment provider keys are not configured.");
    if (/CHECKOUT_ALREADY_BEING_PREPARED/i.test(message)) return text("يجري تجهيز رابط الدفع بالفعل. انتظر قليلاً ثم حدّث الصفحة.", "A checkout is already being prepared. Wait briefly, then refresh.");
    if (/ENROLLMENT_REQUIRED|NOT_ALLOWED|NOT_AUTHORIZED/i.test(message)) return text("ليست لديك صلاحية لتنفيذ هذه العملية.", "You are not authorized to perform this action.");
    return message;
  };
  const makeBtn = (label, action, cls) => '<button type="button" class="edf-btn ' + (cls || "") + '" data-action="' + esc(action) + '">' + esc(label) + '</button>';
  const card = (heading, body, meta) => '<article class="edf-card">' +
    (heading ? '<h3>' + esc(heading) + '</h3>' : "") +
    (meta ? '<div class="edf-meta">' + meta + '</div>' : "") +
    '<div class="edf-card-body">' + body + '</div></article>';
  const empty = (msg) => '<div class="edf-empty">' + esc(msg) + '</div>';
  const loading = () => '<div class="edf-loading"><span class="edf-spinner"></span>' + esc(text("جارٍ تحميل البيانات...", "Loading data...")) + '</div>';
  const setBusy = (busy) => {
    state.busy = busy;
    const el = document.getElementById(rootId);
    if (el) el.querySelectorAll("button,input,select,textarea").forEach(x => { x.disabled = !!busy; });
  };

  const tabsForRole = () => {
    if (isAdmin()) return [
      ["analytics", text("التحليلات", "Analytics")],
      ["payments", text("المدفوعات", "Payments")],
      ["staff", text("صلاحيات الدورات", "Course roles")],
      ["audit", text("سجل الإدارة", "Audit log")],
      ["mfa", text("المصادقة الثنائية", "Admin MFA")],
      ["liveClasses", text("الفصول المباشرة", "Live classes")]
    ];
    if (isTeacher()) return [
      ["assignments", text("الواجبات والتصحيح", "Assignments & grading")],
      ["attendance", text("الحضور", "Attendance")],
      ["liveClasses", text("الفصول المباشرة", "Live classes")],
      ["discussions", text("النقاشات", "Discussions")],
      ["analytics", text("تقارير الدورة", "Course reports")],
      ["certificates", text("الشهادات", "Certificates")]
    ];
    return [
      ["assignments", text("واجباتي", "My assignments")],
      ["attendance", text("الحضور", "My attendance")],
      ["liveClasses", text("مواعيد اللقاءات", "Class schedule")],
      ["certificates", text("شهاداتي", "My certificates")],
      ["discussions", text("النقاشات", "Discussions")],
      ["payments", text("مدفوعاتي", "My payments")]
    ];
  };

  async function loadCourses() {
    const u = currentUser();
    const uid = u && u.id;
    if (!uid) { state.courses = []; state.courseId = ""; return; }
    let ids = [];
    if (isAdmin()) {
      const all = await rows("courses", q => q.order("title", { ascending: true }));
      state.courses = all.map(c => ({ id: c.id, title: c.title || c.id }));
      state.courseId = state.courses.some(c => c.id === state.courseId) ? state.courseId : (state.courses[0] && state.courses[0].id) || "";
      return;
    }
    if (isStudent()) {
      const enrollments = await rows("enrollments", q => q.select("course_id").eq("user_id", uid));
      ids.push(...enrollments.map(r => r.course_id));
    }
    if (isTeacher()) {
      const owned = await rows("courses", q => q.select("id,title").eq("created_by", uid).order("title", { ascending: true }));
      state.courses = owned.map(c => ({ id: c.id, title: c.title || c.id }));
      const staffRows = await rows("course_staff_roles", q => q.select("course_id").eq("user_id", uid));
      ids.push(...staffRows.map(r => r.course_id));
    }
    ids = [...new Set(ids.filter(Boolean))];
    if (ids.length) {
      const available = await rows("courses", q => q.select("id,title").in("id", ids).order("title", { ascending: true }));
      const byId = new Map(state.courses.map(c => [c.id,c]));
      available.forEach(c => byId.set(c.id,{ id:c.id,title:c.title || c.id }));
      state.courses = [...byId.values()];
    }
    state.courseId = state.courses.some(c => c.id === state.courseId) ? state.courseId : (state.courses[0] && state.courses[0].id) || "";
  }

  async function loadTabData() {
    state.error = "";
    state.data = {};
    if (state.publicToken) return loadPublicCertificate();
    if (!state.user || !state.user.id) return;
    if (state.tab === "payments") {
      state.data.payments = await rows("payment_orders", q =>
        isAdmin() ? q.order("created_at",{ascending:false}).limit(100) :
          q.eq("user_id",state.user.id).order("created_at",{ascending:false}).limit(50)
      );
      if (!isAdmin()) {
        const [allCourses,enrollments] = await Promise.all([
          rows("courses", q => q.select("id,title,price").order("title",{ascending:true})),
          rows("enrollments", q => q.select("course_id").eq("user_id",state.user.id))
        ]);
        const enrolled = new Set(enrollments.map(item=>item.course_id));
        state.availablePaidCourses = allCourses
          .filter(course=>Number(course.price)>0 && !enrolled.has(course.id))
          .map(course=>({id:course.id,title:course.title || course.id,price:course.price}));
      }
      return;
    }
    if (state.tab === "mfa" || state.tab === "audit" || state.tab === "staff" || (state.tab === "analytics" && isAdmin())) {
      if (state.tab === "mfa") return;
      if (state.tab === "audit") {
        state.data.audit = await rows("platform_audit_log", q => q.order("created_at",{ascending:false}).limit(100));
        return;
      }
      if (state.tab === "analytics" && isAdmin()) {
        state.data.analytics = await rpc("get_platform_analytics", {});
        return;
      }
      if (state.tab === "staff") {
        state.data.staff = await rows("course_staff_roles", q => q.order("created_at",{ascending:false}).limit(150));
        state.data.teacherSearch = [];
        return;
      }
     }
    if (!state.courseId) return;
    const courseId = state.courseId;
    if (state.tab === "assignments") {
      state.data.assignments = await rows("assignments", q => q.eq("course_id",courseId).order("due_at",{ascending:true}));
      const ids = state.data.assignments.map(a => a.id);
      if (isTeacher()) {
        const batches = await Promise.all(state.data.assignments.map(async assignment => {
          const items = await rpc("list_assignment_submissions",{_assignment_id:assignment.id});
          return (Array.isArray(items) ? items : []).map(item=>({...item,assignment_id:assignment.id}));
        }));
        state.data.submissions = batches.flat();
      } else {
        state.data.submissions = ids.length ? await rows("assignment_submissions", q =>
          q.eq("student_id",state.user.id).in("assignment_id",ids).order("submitted_at",{ascending:false})
        ) : [];
      }
      state.data.submissions = await Promise.all(state.data.submissions.map(async submission => {
        const items = Array.isArray(submission.attachments) ? submission.attachments : [];
        const signed = await Promise.all(items.map(async item => {
          if (!item || !item.path) return item;
          try {
            const {data,error}=await sb().storage.from("assignment-submissions").createSignedUrl(item.path,900);
            return error ? item : {...item,signedUrl:data?.signedUrl || null};
          } catch (_) { return item; }
        }));
        return {...submission,attachments:signed};
      }));
    } else if (state.tab === "attendance") {
      state.data.sessions = await rows("attendance_sessions", q => q.eq("course_id",courseId).order("starts_at",{ascending:false}));
      const ids = state.data.sessions.map(a => a.id);
      state.data.attendance = ids.length ? await rows("attendance_records", q =>
        (isTeacher() ? q.in("session_id",ids) : q.eq("student_id",state.user.id).in("session_id",ids))
      ) : [];
      state.data.roster = isTeacher() ? await rpc("list_course_students",{
        _course_id:courseId,_capability:"attendance"
      }) : [];
    } else if (state.tab === "liveClasses") {
      state.data.liveClasses = await rows("live_classes", q => q.eq("course_id",courseId).order("starts_at",{ascending:true}));
    } else if (state.tab === "certificates") {
      state.data.certificates = await rows("course_certificates", q =>
        isTeacher() ? q.eq("course_id",courseId).order("issued_at",{ascending:false}) :
          q.eq("course_id",courseId).eq("student_id",state.user.id).order("issued_at",{ascending:false})
      );
    } else if (state.tab === "discussions") {
      state.data.topics = await rpc("get_course_discussion_feed",{_course_id:courseId}) || [];
      state.data.posts = [];
    } else if (state.tab === "payments") {
      state.data.payments = await rows("payment_orders", q =>
        isAdmin() ? q.order("created_at",{ascending:false}).limit(100) :
          q.eq("user_id",state.user.id).order("created_at",{ascending:false}).limit(50)
      );
    } else if (state.tab === "analytics") {
      state.data.analytics = await rpc("get_course_analytics", { _course_id: courseId });
    }
  }

  function courseSelector() {
    if (state.tab === "payments" || (state.tab === "analytics" && isAdmin())) return "";
    if (!state.courses.length) return "";
    return '<label class="edf-course-select"><span>' + esc(text("الدورة", "Course")) + '</span><select data-field="course">' +
      state.courses.map(c => '<option value="' + esc(c.id) + '"' + (c.id === state.courseId ? " selected" : "") + '>' + esc(c.title) + '</option>').join("") +
      '</select></label>';
  }

  function renderAssignmentTab() {
    const assignments = state.data.assignments || [];
    const submissions = state.data.submissions || [];
    let body = "";
    if (isTeacher()) {
      body += '<form class="edf-form" data-form="create-assignment">' +
        '<h3>' + esc(text("إضافة واجب", "Create assignment")) + '</h3>' +
        '<input name="title" maxlength="180" required placeholder="' + esc(text("عنوان الواجب","Assignment title")) + '">' +
        '<textarea name="description" maxlength="12000" placeholder="' + esc(text("التعليمات","Instructions")) + '"></textarea>' +
        '<div class="edf-form-grid"><input name="due_at" type="datetime-local"><input name="max_score" type="number" min="1" max="100000" value="100" required></div>' +
        '<button class="edf-btn edf-primary" type="submit">' + esc(text("نشر الواجب","Publish assignment")) + '</button></form>';
    }
    body += assignments.map(a => {
      const mine = submissions.find(s => s.assignment_id === a.id);
      const submitted = submissions.filter(s => s.assignment_id === a.id);
      let detail = '<p>' + esc(a.description || text("لا توجد تعليمات إضافية.","No extra instructions.")) + '</p>' +
        '<div class="edf-meta">' + esc(text("آخر موعد: ","Due: ")) + esc(fmtDate(a.due_at)) + ' · ' +
        esc(text("الدرجة: ","Max score: ")) + esc(a.max_score) + '</div>';
      if (!isTeacher()) {
        detail += mine ? '<div class="edf-status">' + esc(text("تم التسليم: ","Submitted: ")) + esc(fmtDate(mine.submitted_at)) +
          (mine.score == null ? "" : ' · ' + esc(text("درجتك: ","Your score: ")) + esc(mine.score)) + '</div>' +
          ((mine.attachments || []).filter(x=>x && x.signedUrl).map(x=>'<a class="edf-link" href="' + esc(x.signedUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(x.name || text("فتح المرفق","Open attachment")) + '</a>').join("")) : "";
        detail += '<form class="edf-form" data-form="submit-assignment" data-id="' + esc(a.id) + '">' +
          '<textarea name="content" maxlength="30000" placeholder="' + esc(text("اكتب إجابتك هنا أو أرفق ملفاً","Write your answer or attach a file")) + '">' + esc(mine && mine.content || "") + '</textarea>' +
          '<label class="edf-file-field">' + esc(text("مرفقات (PDF أو صورة أو Word، حتى 20MB للملف)","Attachments (PDF, image or Word, up to 20MB each)")) +
          '<input name="attachments" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label>' +
          '<button class="edf-btn edf-primary" type="submit">' + esc(text("حفظ التسليم","Submit answer")) + '</button></form>';
      } else {
        detail += '<div class="edf-submissions">' + (submitted.length ? submitted.map(s =>
          '<div class="edf-submission"><strong>' + esc(s.student_name || s.student_public_id || s.student_id) + '</strong>' +
          (s.student_public_id ? '<small> · ' + esc(s.student_public_id) + '</small>' : '') +
          '<p>' + esc(s.content || "") + '</p><small>' + esc(fmtDate(s.submitted_at)) + (s.is_late ? ' · ' + esc(text("متأخر","Late")) : '') + '</small>' +
          ((s.attachments || []).filter(x=>x && x.signedUrl).map(x=>'<a class="edf-link" href="' + esc(x.signedUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(x.name || text("فتح المرفق","Open attachment")) + '</a>').join("")) +
          '<form class="edf-inline-form" data-form="grade-submission" data-id="' + esc(s.id) + '">' +
          '<input name="score" type="number" min="0" max="' + esc(a.max_score) + '" step="0.01" value="' + esc(s.score == null ? "" : s.score) + '" placeholder="' + esc(text("الدرجة","Score")) + '" required>' +
          '<input name="feedback" maxlength="6000" value="' + esc(s.feedback || "") + '" placeholder="' + esc(text("ملاحظات","Feedback")) + '">' +
          '<button class="edf-btn" type="submit">' + esc(text("اعتماد التصحيح","Save grade")) + '</button></form></div>'
        ).join("") : empty(text("لم يسلّم الطلاب بعد.","No submissions yet."))) + '</div>';
      }
      return card(a.title,detail);
    }).join("");
    if (!assignments.length) body += empty(text("لا توجد واجبات في هذه الدورة بعد.","No assignments are available in this course yet."));
    return body;
  }

  function renderAttendanceTab() {
    const sessions = state.data.sessions || [];
    const records = state.data.attendance || [];
    let body = "";
    if (isTeacher()) {
      body += '<form class="edf-form" data-form="create-attendance"><h3>' + esc(text("إنشاء جلسة حضور","Create attendance session")) + '</h3>' +
        '<input name="title" maxlength="180" required placeholder="' + esc(text("اسم الجلسة","Session title")) + '">' +
        '<input name="starts_at" type="datetime-local" required>' +
        '<button class="edf-btn edf-primary" type="submit">' + esc(text("إنشاء الجلسة","Create session")) + '</button></form>';
    }
    body += sessions.map(s => {
      const mine = records.filter(r => r.session_id === s.id);
      let details = '<div class="edf-meta">' + esc(fmtDate(s.starts_at)) + '</div>';
      if (isTeacher()) {
        const options = (state.data.roster || []).map(r =>
          '<option value="' + esc(r.user_id) + '">' + esc(r.student_name || r.public_id || r.user_id) + '</option>'
        ).join("");
        details += '<form class="edf-inline-form" data-form="mark-attendance" data-id="' + esc(s.id) + '">' +
          '<select name="student_id" required><option value="">' + esc(text("اختر الطالب","Select student")) + '</option>' + options + '</select>' +
          '<select name="status"><option value="present">حاضر</option><option value="late">متأخر</option><option value="absent">غائب</option><option value="excused">بعذر</option></select>' +
          '<input name="note" maxlength="500" placeholder="' + esc(text("ملاحظة","Note")) + '">' +
          '<button class="edf-btn" type="submit">' + esc(text("تسجيل","Mark")) + '</button></form>' +
          '<div class="edf-meta">' + esc(text("السجلات: ","Records: ")) + mine.length + '</div>';
      } else {
        const record = mine.find(r => r.student_id === state.user.id);
        details += '<div class="edf-status">' + esc(record ? record.status : text("لم يتم تسجيل حضورك بعد","Your attendance has not been recorded")) + '</div>';
      }
      return card(s.title,details);
    }).join("");
    if (!sessions.length) body += empty(text("لا توجد جلسات حضور حتى الآن.","No attendance sessions yet."));
    return body;
  }

  function renderLiveClassesTab() {
    const items = state.data.liveClasses || [];
    let body = "";
    if (isTeacher()) {
      body += '<form class="edf-form" data-form="create-live-class"><h3>' + esc(text("جدولة لقاء مباشر","Schedule a live class")) + '</h3>' +
        '<input name="title" maxlength="180" required placeholder="' + esc(text("عنوان اللقاء","Class title")) + '">' +
        '<textarea name="description" maxlength="5000" placeholder="' + esc(text("الوصف","Description")) + '"></textarea>' +
        '<div class="edf-form-grid"><label>' + esc(text("البداية","Starts")) + '<input name="starts_at" type="datetime-local" required></label>' +
        '<label>' + esc(text("النهاية","Ends")) + '<input name="ends_at" type="datetime-local" required></label></div>' +
        '<input name="meeting_url" type="url" required placeholder="https://...">' +
        '<select name="provider"><option value="external">External provider</option><option value="zoom">Zoom</option><option value="google_meet">Google Meet</option><option value="microsoft_teams">Microsoft Teams</option><option value="other">Other</option></select>' +
        '<p class="edf-help">' + esc(text("المنصة تحفظ الموعد والرابط فقط؛ يلزم مزود خارجي للاجتماع والتسجيل.","ED-ALL stores the schedule and link only; an external provider hosts the meeting and recording.")) + '</p>' +
        '<button class="edf-btn edf-primary" type="submit">' + esc(text("حفظ الموعد","Save schedule")) + '</button></form>';
    }
    body += items.map(c => card(c.title,
      '<div class="edf-meta">' + esc(fmtDate(c.starts_at)) + ' – ' + esc(fmtDate(c.ends_at)) + ' · ' + esc(c.status) + '</div>' +
      (c.description ? '<p>' + esc(c.description) + '</p>' : "") +
      (c.meeting_url ? '<a class="edf-link" href="' + esc(c.meeting_url) + '" target="_blank" rel="noopener noreferrer">' + esc(text("فتح رابط اللقاء","Open meeting link")) + '</a>' : "") +
      (c.recording_url ? '<a class="edf-link" href="' + esc(c.recording_url) + '" target="_blank" rel="noopener noreferrer">' + esc(text("مشاهدة التسجيل","Watch recording")) + '</a>' : "") +
      (isTeacher() ? '<form class="edf-inline-form" data-form="update-live-class" data-id="' + esc(c.id) + '">' +
        '<select name="status"><option value="scheduled">scheduled</option><option value="cancelled">cancelled</option><option value="completed">completed</option></select>' +
        '<input name="recording_url" type="url" placeholder="' + esc(text("رابط التسجيل HTTPS (اختياري)","Recording HTTPS URL (optional)")) + '">' +
        '<button class="edf-btn" type="submit">' + esc(text("تحديث","Update")) + '</button></form>' : "")
    )).join("");
    if (!items.length) body += empty(text("لا توجد لقاءات مجدولة.","No live classes scheduled."));
    return body;
  }

  function renderCertificatesTab() {
    const list = state.data.certificates || [];
    let body = "";
    if (isTeacher()) {
      body += '<form class="edf-form" data-form="issue-certificate"><h3>' + esc(text("إصدار شهادة بعد التحقق من إكمال الدورة","Issue a certificate after course completion")) + '</h3>' +
        '<input name="student_id" required placeholder="' + esc(text("معرّف الطالب","Student user ID")) + '">' +
        '<button class="edf-btn edf-primary" type="submit">' + esc(text("إصدار الشهادة","Issue certificate")) + '</button></form>';
    } else {
      body += '<div class="edf-actions">' + makeBtn(text("التحقق من أهليتي وإصدار الشهادة","Check eligibility & issue certificate"),"self-certificate","edf-primary") + '</div>';
    }
    body += list.map(c => {
      const token = c.verification_token;
      const url = window.location.origin + "/?verify-certificate=" + encodeURIComponent(token);
      return card(c.certificate_number,
        '<div class="edf-meta">' + esc(fmtDate(c.issued_at)) + ' · ' + esc(c.revoked_at ? text("ملغاة","Revoked") : text("سارية","Valid")) + '</div>' +
        '<a class="edf-link" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(text("رابط التحقق العام","Public verification link")) + '</a>'
      );
    }).join("");
    if (!list.length) body += empty(text("لا توجد شهادات لهذه الدورة حتى الآن.","No certificates are available for this course yet."));
    return body;
  }

  function renderDiscussionsTab() {
    const topics = state.data.topics || [];
    const posts = state.data.posts || [];
    let body = '<form class="edf-form" data-form="create-topic"><h3>' + esc(text("طرح سؤال أو نقاش","Start a discussion")) + '</h3>' +
      '<input name="title" maxlength="180" required placeholder="' + esc(text("عنوان النقاش","Discussion title")) + '">' +
      '<textarea name="content" maxlength="12000" required placeholder="' + esc(text("اكتب رسالتك","Write your post")) + '"></textarea>' +
      '<button class="edf-btn edf-primary" type="submit">' + esc(text("نشر","Publish")) + '</button></form>';
    body += topics.map(t => {
      const topicPosts = Array.isArray(t.posts) ? t.posts : posts.filter(p => p.topic_id === t.id);
      return card(t.title,
        '<div class="edf-meta">' + esc(fmtDate(t.created_at)) + (t.is_pinned ? ' · ' + esc(text("مثبّت","Pinned")) : "") +
          (t.is_locked ? ' · ' + esc(text("مغلق","Locked")) : "") + '</div>' +
        topicPosts.map(p => '<div class="edf-post' + (p.is_hidden ? ' is-hidden' : '') + '"><strong>' + esc(p.author_name || "") + '</strong><p>' + esc(p.content) + '</p><small>' + esc(fmtDate(p.created_at)) + '</small>' +
          (isTeacher() ? '<button class="edf-text-btn" data-action="moderate-post" data-id="' + esc(p.id) + '" data-hidden="' + (!p.is_hidden) + '">' + esc(p.is_hidden ? text("إظهار","Unhide") : text("إخفاء","Hide")) + '</button>' : "") +
          '</div>').join("") +
        '<form class="edf-inline-form" data-form="reply-topic" data-id="' + esc(t.id) + '">' +
        '<input name="content" maxlength="12000" required placeholder="' + esc(text("أضف ردًا","Add a reply")) + '">' +
        '<button class="edf-btn" type="submit">' + esc(text("رد","Reply")) + '</button></form>' +
        (isTeacher() ? '<div class="edf-actions">' +
          '<button class="edf-text-btn" data-action="moderate-topic" data-id="' + esc(t.id) + '" data-kind="lock">' + esc(t.is_locked ? text("فتح النقاش","Unlock topic") : text("إغلاق النقاش","Lock topic")) + '</button>' +
          '<button class="edf-text-btn" data-action="moderate-topic" data-id="' + esc(t.id) + '" data-kind="pin">' + esc(t.is_pinned ? text("إلغاء التثبيت","Unpin") : text("تثبيت","Pin")) + '</button>' +
          '</div>' : "")
      );
    }).join("");
    if (!topics.length) body += empty(text("ابدأ أول نقاش في هذه الدورة.","Start the first discussion in this course."));
    return body;
  }

  function renderPaymentsTab() {
    const list = state.data.payments || [];
    let body = "";
    if (!isAdmin()) {
      const available = state.availablePaidCourses || [];
      body += '<form class="edf-form" data-form="create-payment"><h3>' + esc(text("شراء دورة","Purchase a course")) + '</h3>' +
        '<p class="edf-help">' + esc(text("السعر يُقرأ مباشرة من قاعدة البيانات. الدفع لن يبدأ حتى يكون حساب Paymob مضبوطاً ومفعّلاً من الخادم.","The price is read from the database. Checkout will start only after Paymob is securely configured and enabled on the server.")) + '</p>' +
        (available.length
          ? '<select name="course_id" required><option value="">' + esc(text("اختر دورة مدفوعة","Choose a paid course")) + '</option>' +
              available.map(c=>'<option value="' + esc(c.id) + '">' + esc(c.title) + ' · ' + esc(formatAmount(c.price,"EGP")) + '</option>').join("") +
            '</select><button class="edf-btn edf-primary" type="submit">' + esc(text("إنشاء طلب دفع","Create payment order")) + '</button>'
          : empty(text("لا توجد دورات مدفوعة متاحة للشراء حالياً.","No paid courses are currently available to purchase."))) +
        '</form>';
    }
    body += list.map(p => card(p.provider || "Payment",
      '<div class="edf-meta">' + esc(fmtDate(p.created_at)) + '</div>' +
      '<div class="edf-status">' + esc(formatAmount(p.amount,p.currency)) + ' · ' + esc(p.status) + '</div>' +
      (p.checkout_url && p.status==="pending" ? '<a class="edf-link" href="' + esc(p.checkout_url) + '" target="_blank" rel="noopener noreferrer">' + esc(text("استكمال الدفع","Continue payment")) + '</a>' : "")
    )).join("");
    if (!list.length) body += empty(text("لا توجد طلبات دفع مسجلة.","No payment orders are recorded."));
    return body;
  }

  function renderAnalyticsTab() {
    const data = state.data.analytics;
    if (!data) return empty(text("لا توجد بيانات تحليلية متاحة.","Analytics are not available."));
    const keys = Object.keys(data);
    const body = '<div class="edf-metrics">' + keys.map(k => card(k.replace(/_/g," "),'<strong>' + esc(typeof data[k] === "object" ? JSON.stringify(data[k]) : data[k]) + '</strong>')).join("") + '</div>' +
      '<div class="edf-actions">' + makeBtn(text("تصدير CSV لبرنامج Excel","Export CSV for Excel"),"export") + makeBtn(text("طباعة / حفظ PDF","Print / Save PDF"),"print") + '</div>';
    state.exportRows = [data];
    return body;
  }

  function renderStaffTab() {
    const list = state.data.staff || [];
    const teachers = state.data.teacherSearch || [];
    let body = '<form class="edf-form" data-form="search-teachers"><h3>' + esc(text("البحث عن معلم أو مدير","Find a teacher or admin")) + '</h3>' +
      '<input name="term" maxlength="100" placeholder="' + esc(text("الاسم أو البريد (للمدير)","Name or email (admin only)")) + '">' +
      '<button class="edf-btn" type="submit">' + esc(text("بحث","Search")) + '</button></form>';
    body += teachers.map(t => '<div class="edf-card"><strong>' + esc(t.name || t.id) + '</strong><small>' + esc(t.email || t.id) + '</small>' +
      '<form class="edf-inline-form" data-form="grant-staff" data-id="' + esc(t.id) + '">' +
      '<select name="role"><option value="instructor">instructor</option><option value="assistant">assistant</option><option value="moderator">moderator</option><option value="analyst">analyst</option></select>' +
      '<button class="edf-btn" type="submit">' + esc(text("منح صلاحية","Assign role")) + '</button></form></div>').join("");
    body += '<h3>' + esc(text("الصلاحيات الحالية","Current assignments")) + '</h3>' +
      list.map(s => card(s.role,
        '<div class="edf-meta">' + esc(text("الدورة: ","Course: ")) + esc(s.course_id) + ' · ' +
        esc(text("المستخدم: ","User: ")) + esc(s.user_id) + '</div>' +
        '<button class="edf-text-btn" data-action="revoke-staff" data-id="' + esc(s.user_id) + '" data-course="' + esc(s.course_id) + '">' + esc(text("إلغاء الصلاحية","Revoke role")) + '</button>'
      )).join("");
    if (!list.length && !teachers.length) body += empty(text("لا توجد صلاحيات مخصصة حالياً.","No scoped course roles assigned."));
    return body;
  }

  function renderAuditTab() {
    const list = state.data.audit || [];
    const actions = '<div class="edf-actions">' + makeBtn(text("تصدير CSV لبرنامج Excel","Export CSV for Excel"),"export") +
      makeBtn(text("طباعة / حفظ PDF","Print / Save PDF"),"print") + '</div>';
    return actions + (list.length ? list.map(a => card(a.event_type,
      '<div class="edf-meta">' + esc(fmtDate(a.created_at)) + ' · ' + esc(a.entity_type) + ' · ' + esc(a.entity_id || "") + '</div>' +
      '<pre class="edf-json">' + esc(JSON.stringify(a.details || {},null,2)) + '</pre>'
    )).join("") : empty(text("لا توجد أحداث مسجلة.","No audit events recorded.")));
  }

  async function mfaState() {
    const client = sb();
    const [assurance, factors] = await Promise.all([
      client.auth.mfa.getAuthenticatorAssuranceLevel(),
      client.auth.mfa.listFactors()
    ]);
    if (assurance.error) throw assurance.error;
    if (factors.error) throw factors.error;
    return { assurance: assurance.data, factors: factors.data };
  }

  function renderMfaTab() {
    if (!isAdmin()) return empty(text("هذه الصفحة للمديرين فقط.","Administrators only."));
    const factor = state.mfaFactorId;
    const qr = state.mfaQr;
    const assurance = state.data.mfa && state.data.mfa.assurance;
    const level = assurance && assurance.currentLevel;
    const factorView = factor ? '<div class="edf-mfa-qr">' +
      (qr ? '<img alt="TOTP QR code" src="' + esc(qr) + '">' : "") +
      '<p>' + esc(text("امسح رمز QR في تطبيق مصادقة ثم أدخل الرمز المكون من 6 أرقام.","Scan this QR code in an authenticator app, then enter the six-digit code.")) + '</p></div>' : "";
    const detail = '<div class="edf-status">' + esc(text("مستوى الجلسة الحالي: ","Current session assurance: ")) + esc(level || "unknown") + '</div>' +
      factorView +
      '<form class="edf-form" data-form="mfa-verify">' +
      '<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="000000">' +
      '<button class="edf-btn edf-primary" type="submit">' + esc(text("تأكيد الرمز وتفعيل AAL2","Verify code and activate AAL2")) + '</button></form>' +
      '<div class="edf-actions">' + makeBtn(text("إعداد عامل TOTP جديد","Enroll a new TOTP factor"),"mfa-enroll") + makeBtn(text("طلب رمز التحقق","Request verification code"),"mfa-challenge") + '</div>';
    return card(text("حماية حساب المدير","Administrator account protection"),detail);
  }

  function renderBody() {
    if (state.publicToken) {
      const c = state.data.publicCertificate;
      if (!c) return loading();
      if (!c.length) return card(text("التحقق من الشهادة","Certificate verification"),empty(text("لم يتم العثور على شهادة بهذا الرمز.","No certificate was found for this token.")));
      const cert = c[0];
      return card(text("التحقق من الشهادة","Certificate verification"),
        '<div class="edf-status ' + (cert.is_valid ? "valid" : "invalid") + '">' +
        esc(cert.is_valid ? text("شهادة صحيحة","Valid certificate") : text("شهادة ملغاة","Revoked certificate")) + '</div>' +
        '<p>' + esc(text("رقم الشهادة: ","Certificate number: ")) + esc(cert.certificate_number) + '</p>' +
        '<p>' + esc(text("الدورة: ","Course: ")) + esc(cert.course_title) + '</p>' +
        '<p>' + esc(text("الاسم: ","Name: ")) + esc(cert.student_name) + '</p>' +
        '<p>' + esc(text("تاريخ الإصدار: ","Issued: ")) + esc(fmtDate(cert.issued_at)) + '</p>'
      );
    }
    if (!state.user || !state.user.id) return card(text("سجّل الدخول أولاً","Sign in first"),
      '<p>' + esc(text("سجّل الدخول لعرض مساحة التعلم المرتبطة بدوراتك.","Sign in to view the learning tools for your courses.")) + '</p>' +
      makeBtn(text("تسجيل الدخول","Sign in"),"login","edf-primary"));
    if (state.error) return '<div class="edf-error">' + esc(state.error) + '</div>' + makeBtn(text("إعادة المحاولة","Retry"),"refresh");
    if (state.tab === "mfa") return renderMfaTab();
    if (state.tab === "audit") return renderAuditTab();
    if (state.tab === "staff") return renderStaffTab();
    if (state.tab === "assignments") return renderAssignmentTab();
    if (state.tab === "attendance") return renderAttendanceTab();
    if (state.tab === "liveClasses") return renderLiveClassesTab();
    if (state.tab === "certificates") return renderCertificatesTab();
    if (state.tab === "discussions") return renderDiscussionsTab();
    if (state.tab === "payments") return renderPaymentsTab();
    if (state.tab === "analytics") return renderAnalyticsTab();
    return empty(text("اختر أحد أقسام مساحة التعلم.","Choose a Learning Hub section."));
  }

  function render() {
    const root = document.getElementById(rootId);
    if (!root) return;
    const tabs = state.publicToken ? [] : tabsForRole();
    if (!state.tab && tabs.length) state.tab = tabs[0][0];
    const title = state.publicToken ? text("التحقق من الشهادة","Certificate verification") : text("مساحة التعلم","Learning Hub");
    root.innerHTML = '<div class="edf-shell">' +
      '<div class="edf-top"><div><div class="edf-kicker">ED ALL · LEARNING</div><h1>' + esc(title) + '</h1>' +
      '<p>' + esc(text("أدوات الدراسة والمتابعة والإدارة المرتبطة بصلاحيات حسابك.","Learning, progress, and management tools scoped to your account.")) + '</p></div>' +
      '<div class="edf-top-actions">' + (!state.publicToken ? makeBtn(text("الرئيسية","Home"),"home") : "") +
      (!state.publicToken ? makeBtn(text("تحديث","Refresh"),"refresh") : "") + '</div></div>' +
      (!state.publicToken ? courseSelector() : "") +
      (!state.publicToken ? '<nav class="edf-tabs">' + tabs.map(([id,label]) =>
        '<button type="button" data-tab="' + esc(id) + '" class="' + (state.tab===id ? "active" : "") + '">' + esc(label) + '</button>'
      ).join("") + '</nav>' : "") +
      '<div class="edf-content">' + (state.busy ? loading() : renderBody()) + '</div></div>';
    const nav = root.querySelector(".edf-tabs");
    if (nav) nav.addEventListener("click", async e => {
      const b=e.target.closest("[data-tab]"); if (!b) return;
      state.tab=b.dataset.tab; await refresh();
    });
    const select = root.querySelector('[data-field="course"]');
    if (select) select.addEventListener("change", async e => { state.courseId=e.target.value; await refresh(); });
  }

  async function verifyPublicCertificate() {
    const result = await rpc("verify_course_certificate",{_token:state.publicToken});
    state.data.publicCertificate = Array.isArray(result) ? result : (result ? [result] : []);
  }

  async function loadPublicCertificate() {
    await verifyPublicCertificate();
  }

  async function refresh() {
    const root = document.getElementById(rootId);
    if (!root) return;
    setBusy(true);
    render();
    try {
      if (state.publicToken) await loadPublicCertificate();
      else {
        await loadCourses();
        if (state.tab && state.tab !== "mfa") await loadTabData();
        if (state.tab === "mfa") await loadMfaInfo();
      }
      state.error = "";
    } catch (e) {
      state.error = actionError(e);
    } finally {
      setBusy(false);
      render();
    }
  }

  async function loadMfaInfo() {
    const result = await mfaState();
    state.data.mfa = result;
    const verified = (result.factors.totp || []).find(f => f.status === "verified");
    if (verified && !state.mfaFactorId) state.mfaFactorId = verified.id;
  }

  async function handleSubmit(form) {
    const fd = new FormData(form);
    const v = Object.fromEntries(fd.entries());
    const id = form.dataset.id;
    const course = state.courseId;
    setBusy(true);
    try {
      switch (form.dataset.form) {
        case "create-payment": {
          const idempotencyKey=crypto.randomUUID();
          const {data,error}=await sb().functions.invoke("create-payment-intention",{
            body:{course_id:v.course_id,idempotency_key:idempotencyKey}
          });
          if(error) throw error;
          if(!data || !data.checkout_url) throw new Error(data?.message || data?.error || text("لم يتم إنشاء رابط الدفع.","The checkout URL was not created."));
          window.location.assign(data.checkout_url);
          return;
        }
        case "create-assignment":
          await rpc("create_assignment",{
            _course_id:course,_lesson_id:null,_title:v.title,_description:v.description || "",
            _due_at:v.due_at ? new Date(v.due_at).toISOString() : null,_max_score:Number(v.max_score || 100)
          });
          break;
        case "submit-assignment": {
          const files = Array.from(form.querySelector('input[name="attachments"]')?.files || []);
          if (files.length > 5) throw new Error(text("الحد الأقصى خمسة مرفقات لكل تسليم.","A submission may contain up to five attachments."));
          if (!String(v.content || "").trim() && files.length === 0) {
            throw new Error(text("اكتب إجابة أو أرفق ملفاً واحداً على الأقل.","Write an answer or attach at least one file."));
          }
          const accepted = new Set([
            "application/pdf","image/jpeg","image/png","image/webp",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          ]);
          const attachments = [];
          const uploadedPaths = [];
          try {
            for (const file of files) {
              if (!accepted.has(file.type) || file.size > 20 * 1024 * 1024) {
                throw new Error(text("نوع الملف غير مسموح أو حجمه أكبر من 20MB.","Unsupported file type or file larger than 20MB."));
              }
              const safeName = (file.name || "attachment")
                .normalize("NFKD").replace(/[^A-Za-z0-9_. -]/g,"_").slice(-140) || "attachment";
              const path = state.user.id + "/" + id + "/" + Date.now() + "_" + safeName;
              const { error } = await sb().storage.from("assignment-submissions").upload(path,file,{
                upsert:false,contentType:file.type
              });
              if (error) throw error;
              uploadedPaths.push(path);
              attachments.push({path,name:safeName,mime_type:file.type,size:file.size});
            }
            await rpc("submit_assignment",{_assignment_id:id,_content:v.content || "",_attachments:attachments});
          } catch (error) {
            if (uploadedPaths.length) {
              await sb().storage.from("assignment-submissions").remove(uploadedPaths).catch(()=>{});
            }
            throw error;
          }
          break;
        }
        case "grade-submission":
          await rpc("grade_assignment_submission",{_submission_id:id,_score:Number(v.score),_feedback:v.feedback || ""});
          break;
        case "create-attendance":
          await rpc("create_attendance_session",{_course_id:course,_title:v.title,_starts_at:new Date(v.starts_at).toISOString()});
          break;
        case "mark-attendance":
          await rpc("mark_attendance",{_session_id:id,_student_id:v.student_id,_status:v.status,_note:v.note || ""});
          break;
        case "create-live-class":
          await rpc("create_live_class",{
            _course_id:course,_title:v.title,_description:v.description || "",
            _starts_at:new Date(v.starts_at).toISOString(),_ends_at:new Date(v.ends_at).toISOString(),
            _meeting_url:v.meeting_url,_provider:v.provider || "external"
          });
          break;
        case "update-live-class":
          await rpc("update_live_class_status",{_live_class_id:id,_status:v.status,_recording_url:v.recording_url || null});
          break;
        case "issue-certificate":
          await rpc("issue_course_certificate",{_course_id:course,_student_id:v.student_id});
          break;
        case "create-topic":
          await rpc("create_discussion_topic",{_course_id:course,_lesson_id:null,_title:v.title,_content:v.content});
          break;
        case "reply-topic":
          await rpc("create_discussion_post",{_topic_id:id,_content:v.content});
          break;
        case "search-teachers":
          state.data.teacherSearch = await rpc("search_teachers_public",{_term:v.term || ""}) || [];
          break;
        case "grant-staff":
          await rpc("grant_course_staff_role",{_course_id:course,_user_id:form.dataset.id,_role:v.role});
          break;
        case "mfa-verify":
          if (!state.mfaFactorId || !state.mfaChallengeId) throw new Error(text("اطلب رمز التحقق أولاً.","Request a verification code first."));
          {
            const { data,error } = await sb().auth.mfa.verify({factorId:state.mfaFactorId,challengeId:state.mfaChallengeId,code:String(v.code).trim()});
            if (error) throw error;
            state.mfaChallengeId = "";
            state.mfaQr = "";
            state.data.mfa = (await mfaState());
          }
          break;
        default:
          throw new Error("Unknown form action");
      }
      notify(text("تم حفظ العملية بنجاح.","The operation was saved."),"success");
      form.reset();
      await refresh();
    } catch (e) {
      notify(actionError(e),"error");
    } finally {
      setBusy(false);
    }
  }

  async function handleClick(button) {
    const action = button.dataset.action;
    const id = button.dataset.id;
    try {
      if (action === "home") { if (window.showPage) window.showPage("mainPage"); return; }
      if (action === "login") { if (window.showPage) window.showPage("loginPage"); return; }
      if (action === "refresh") { await refresh(); return; }
      if (action === "self-certificate") {
        const data = await rpc("issue_course_certificate",{_course_id:state.courseId,_student_id:state.user.id});
        notify(text("تم إصدار الشهادة أو كانت موجودة مسبقاً.","Certificate issued or already exists."),"success");
        await refresh();
        return data;
      }
      if (action === "moderate-post") {
        await rpc("moderate_discussion_post",{_post_id:id,_hidden:button.dataset.hidden==="true"});
        await refresh(); return;
      }
      if (action === "moderate-topic") {
        const item=(state.data.topics||[]).find(x=>x.id===id); if(!item) return;
        const kind=button.dataset.kind;
        await rpc("moderate_discussion_topic",{
          _topic_id:id,_hidden:!!item.is_hidden,_locked:kind==="lock"?!item.is_locked:!!item.is_locked,
          _pinned:kind==="pin"?!item.is_pinned:!!item.is_pinned
        });
        await refresh(); return;
      }
      if (action === "revoke-staff") {
        await rpc("revoke_course_staff_role",{_course_id:button.dataset.course,_user_id:button.dataset.id});
        notify(text("تم إلغاء الصلاحية.","Course role revoked."),"success"); await refresh(); return;
      }
      if (action === "export") { exportCsv(); return; }
      if (action === "print") { window.print(); return; }
      if (action === "mfa-enroll") {
        const { data,error } = await sb().auth.mfa.enroll({factorType:"totp",friendlyName:"ED-ALL Administrator"});
        if (error) throw error;
        state.mfaFactorId=data.id;
        state.mfaQr=data.totp && data.totp.qr_code || "";
        const challenge=await sb().auth.mfa.challenge({factorId:data.id});
        if (challenge.error) throw challenge.error;
        state.mfaChallengeId=challenge.data.id;
        render(); return;
      }
      if (action === "mfa-challenge") {
        if (!state.mfaFactorId) await loadMfaInfo();
        const verified=(state.data.mfa?.factors?.totp||[]).find(f=>f.status==="verified");
        const factorId=verified?.id || state.mfaFactorId;
        if (!factorId) throw new Error(text("أنشئ عامل TOTP أولاً.","Enroll a TOTP factor first."));
        state.mfaFactorId=factorId;
        const challenge=await sb().auth.mfa.challenge({factorId});
        if (challenge.error) throw challenge.error;
        state.mfaChallengeId=challenge.data.id;
        notify(text("تم إرسال طلب التحقق. افتح تطبيق المصادقة.","Verification challenge created. Open your authenticator app."),"info");
        render(); return;
      }
    } catch (e) {
      notify(actionError(e),"error");
    }
  }

  function exportCsv() {
    const items = state.tab === "audit" ? (state.data.audit||[]) : (state.exportRows||[]);
    if (!items.length) { notify(text("لا توجد بيانات للتصدير.","No data to export."),"warning"); return; }
    const keys = [...new Set(items.flatMap(x=>Object.keys(x)))];
    const csv = [keys.join(","),...items.map(x=>keys.map(k=>'"'+String(x[k] == null ? "" : typeof x[k]==="object" ? JSON.stringify(x[k]) : x[k]).replace(/"/g,'""')+'"').join(","))].join("\r\n");
    const blob = new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download="edall-report-"+new Date().toISOString().slice(0,10)+".csv";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function init() {
    const user=currentUser();
    state.user=user && user.id ? user : null;
    state.roles=state.user ? (Array.isArray(state.user.roles) ? state.user.roles : (state.user.role ? [state.user.role] : [])) : [];
    if (state.roles.length === 0 && state.user) {
      const cached = state.user.user_metadata && state.user.user_metadata.role;
      if (cached) state.roles = [cached];
    }
    state.publicToken=new URLSearchParams(location.search).get("verify-certificate") || "";
    const entry=document.getElementById("edLearningHubEntry");
    if(entry) entry.style.display=state.user ? "inline-flex" : "none";
    if(state.publicToken && window.showPage) window.showPage("edLearningHubPage",true);
    const root=document.getElementById(rootId);
    if(root && (state.publicToken || state.user)) refresh();
    else if(root) render();
  }

  function boot() {
    const root=document.getElementById(rootId);
    if(root){
      root.addEventListener("submit",e=>{
        const form=e.target.closest("form[data-form]");
        if(!form) return; e.preventDefault(); handleSubmit(form);
      });
      root.addEventListener("click",e=>{
        const button=e.target.closest("button[data-action]");
        if(button) handleClick(button);
      });
    }
    window.addEventListener("edall:user-changed",init);
    init();
  }

  window.EDFeatures = {
    refresh,
    open: () => { if(window.showPage) window.showPage("edLearningHubPage"); refresh(); },
    getState: () => ({ userId:state.user?.id || null,roles:state.roles.slice(),tab:state.tab,courseId:state.courseId })
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
})();