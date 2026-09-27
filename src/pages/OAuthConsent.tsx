import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

// Typed wrapper for the beta supabase.auth.oauth namespace
type AuthOAuth = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};
const authOAuth = (supabase.auth as unknown as { oauth: AuthOAuth }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  async function loadDetails() {
    if (!authorizationId) return setError("رابط الطلب غير صالح: authorization_id مفقود");
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      setNeedsLogin(true);
      return;
    }
    setNeedsLogin(false);
    const { data, error } = await authOAuth.getAuthorizationDetails(authorizationId);
    if (error) return setError(error.message ?? String(error));
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) {
      window.location.href = immediate;
      return;
    }
    setDetails(data);
  }

  useEffect(() => {
    loadDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorizationId]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLoginError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setLoginError(error.message);
      return;
    }
    loadDetails();
  }

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error } = approve
      ? await authOAuth.approveAuthorization(authorizationId)
      : await authOAuth.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      return setError(error.message ?? String(error));
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      return setError("لم يُرجع خادم المصادقة رابط إعادة توجيه.");
    }
    window.location.href = target;
  }

  const wrap: React.CSSProperties = {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#f8fafc", padding: "24px", direction: "rtl", fontFamily: "system-ui, sans-serif",
  };
  const card: React.CSSProperties = {
    background: "white", borderRadius: 16, padding: 32, maxWidth: 480, width: "100%",
    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
  };
  const btn: React.CSSProperties = {
    padding: "10px 18px", borderRadius: 8, border: "none", cursor: "pointer",
    fontSize: 15, fontWeight: 600,
  };

  if (error) return (
    <div style={wrap}><div style={card}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>تعذّر تحميل طلب المصادقة</h1>
      <p style={{ color: "#64748b" }}>{error}</p>
    </div></div>
  );

  if (needsLogin) return (
    <div style={wrap}><div style={card}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>تسجيل الدخول</h1>
      <p style={{ color: "#64748b", marginBottom: 20 }}>سجّل الدخول للمتابعة والموافقة على طلب الوصول.</p>
      <form onSubmit={signIn} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input type="email" required placeholder="البريد الإلكتروني" value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        <input type="password" required placeholder="كلمة المرور" value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        {loginError && <div style={{ color: "#dc2626", fontSize: 14 }}>{loginError}</div>}
        <button type="submit" disabled={busy} style={{ ...btn, background: "#2563eb", color: "white" }}>
          {busy ? "..." : "دخول"}
        </button>
      </form>
    </div></div>
  );

  if (!details) return <div style={wrap}><div style={card}>جاري التحميل...</div></div>;

  const clientName = details.client?.name ?? details.client?.client_name ?? "تطبيق خارجي";

  return (
    <div style={wrap}><div style={card}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>ربط {clientName} بحسابك</h1>
      <p style={{ color: "#475569", marginBottom: 8 }}>
        سيتمكن <strong>{clientName}</strong> من استخدام أدوات ED ALL بالنيابة عنك أثناء تسجيل دخولك.
      </p>
      <p style={{ color: "#64748b", fontSize: 14, marginBottom: 20 }}>
        هذا لا يتجاوز صلاحيات حسابك أو سياسات المنصة. الأدوات تصل فقط إلى بياناتك المسموح بها.
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button disabled={busy} onClick={() => decide(false)}
          style={{ ...btn, background: "#f1f5f9", color: "#0f172a" }}>رفض</button>
        <button disabled={busy} onClick={() => decide(true)}
          style={{ ...btn, background: "#2563eb", color: "white" }}>
          {busy ? "..." : "موافقة"}
        </button>
      </div>
    </div></div>
  );
}
