import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {};
  const nextParam = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/";

  return (
    <div className="login-shell">
      <div className="panel login-panel">
        <div className="login-title">RODYO CRM</div>
        <p className="table-meta">Enter the password to continue.</p>
        <LoginForm next={next} />
      </div>
    </div>
  );
}
