"use client";

import { useState } from "react";
import type { FormEvent } from "react";

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not sign in.");
      // Full navigation (not client-side routing) so the new cookie is
      // actually sent with the next request.
      window.location.assign(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      setSaving(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <div className="field">
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
          required
        />
      </div>
      <button className="primary-button" type="submit" disabled={saving || !password}>
        {saving ? "Checking…" : "Enter"}
      </button>
      {error ? <p className="form-error">{error}</p> : null}
    </form>
  );
}
