const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CreateUserPayload = {
  action?: "list" | "upsert" | "reset" | "delete";
  username: string;
  company: string;
  email: string;
  password?: string;
  userId?: string;
};

Deno.serve(async (request) => {
  try {
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const appBaseUrl = Deno.env.get("APP_BASE_URL") || "https://digitaleit.github.io/meeting-room-planner";
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL") || "stefano@stefanoserra.it";
    const senderName = Deno.env.get("BREVO_SENDER_NAME") || "Meeting Room Planner";
    const authToken = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return jsonResponse({ error: "Missing Supabase secrets" }, 500);
    }

    if (!authToken) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const caller = await getCaller(supabaseUrl, authToken, anonKey);
    if (!caller?.id) {
      return jsonResponse({ error: "Invalid user" }, 401);
    }

    const isAdmin = await checkAdmin(supabaseUrl, serviceRoleKey, caller.id);
    if (!isAdmin) {
      return jsonResponse({ error: "Admin only" }, 403);
    }

    const payload = await request.json() as CreateUserPayload;
    const action = payload.action || "upsert";

    if (action === "list") {
      const users = await listProfiles(supabaseUrl, serviceRoleKey);
      return jsonResponse({ ok: true, users });
    }

    if (action === "reset") {
      if (!payload.email?.includes("@")) return jsonResponse({ error: "Missing valid email" }, 400);
      await sendPasswordReset({
        supabaseUrl,
        serviceRoleKey,
        anonKey,
        email: payload.email.trim().toLowerCase(),
        appBaseUrl,
        brevoApiKey,
        senderEmail,
        senderName,
        isNewAccount: false,
      });
      return jsonResponse({ ok: true, passwordResetSent: true });
    }

    if (action === "delete") {
      if (!payload.userId) return jsonResponse({ error: "Missing user id" }, 400);
      if (payload.userId === caller.id) return jsonResponse({ error: "Non puoi rimuovere il tuo account." }, 400);

      const targetIsAdmin = await checkAdmin(supabaseUrl, serviceRoleKey, payload.userId);
      if (targetIsAdmin) return jsonResponse({ error: "Non puoi rimuovere un amministratore." }, 400);

      await deleteAuthUser(supabaseUrl, serviceRoleKey, payload.userId);
      return jsonResponse({ ok: true, deletedUserId: payload.userId });
    }

    const validationError = validatePayload(payload);

    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
    }

    const email = payload.email.trim().toLowerCase();
    const password = payload.password?.trim() || generateTemporaryPassword();
    const shouldSendReset = !payload.password?.trim();

    const user = await createOrUpdateAuthUser(supabaseUrl, serviceRoleKey, {
      email,
      password,
      username: payload.username.trim(),
      company: payload.company.trim(),
    });

    await upsertProfile(supabaseUrl, serviceRoleKey, {
      id: user.id,
      username: payload.username.trim(),
      company: payload.company.trim(),
      email,
    });

    if (shouldSendReset) {
      await sendPasswordReset({
        supabaseUrl,
        serviceRoleKey,
        anonKey,
        email,
        appBaseUrl,
        brevoApiKey,
        senderEmail,
        senderName,
        isNewAccount: true,
      });
    }

    return jsonResponse({
      ok: true,
      user: {
        id: user.id,
        email,
        username: payload.username.trim(),
        company: payload.company.trim(),
      },
      passwordResetSent: shouldSendReset,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({
      error: message,
    }, message.toLowerCase().includes("rate limit") ? 429 : 500);
  }
});

async function getCaller(supabaseUrl: string, authToken: string, anonKey: string) {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      "Authorization": `Bearer ${authToken}`,
      "apikey": anonKey,
    },
  });

  if (!response.ok) return null;
  return await response.json();
}

async function checkAdmin(supabaseUrl: string, serviceRoleKey: string, userId: string) {
  const url = new URL(`${supabaseUrl}/rest/v1/profiles`);
  url.searchParams.set("id", `eq.${userId}`);
  url.searchParams.set("is_admin", "eq.true");
  url.searchParams.set("select", "id");
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    headers: serviceHeaders(serviceRoleKey),
  });

  if (!response.ok) return false;
  const data = await response.json();
  return Array.isArray(data) && data.length === 1;
}

async function createOrUpdateAuthUser(
  supabaseUrl: string,
  serviceRoleKey: string,
  user: { email: string; password: string; username: string; company: string },
) {
  const created = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders(serviceRoleKey),
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: {
        username: user.username,
        company: user.company,
      },
    }),
  });

  const createdBody = await created.json();

  if (created.ok) return createdBody;

  const alreadyExists = JSON.stringify(createdBody).toLowerCase().includes("already");
  if (!alreadyExists) {
    throw new Error(createdBody.message || "Unable to create auth user");
  }

  const existing = await getAuthUserByEmail(supabaseUrl, serviceRoleKey, user.email);
  if (!existing?.id) throw new Error("User already exists but cannot be loaded");

  const updated = await fetch(`${supabaseUrl}/auth/v1/admin/users/${existing.id}`, {
    method: "PUT",
    headers: serviceHeaders(serviceRoleKey),
    body: JSON.stringify({
      password: user.password,
      user_metadata: {
        username: user.username,
        company: user.company,
      },
    }),
  });

  if (!updated.ok) {
    const error = await updated.json();
    throw new Error(error.message || "Unable to update existing auth user");
  }

  return await updated.json();
}

async function listProfiles(supabaseUrl: string, serviceRoleKey: string) {
  const url = new URL(`${supabaseUrl}/rest/v1/profiles`);
  url.searchParams.set("select", "id,username,company,email,is_admin,created_at");
  url.searchParams.set("order", "username.asc");

  const response = await fetch(url, {
    headers: serviceHeaders(serviceRoleKey),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Unable to list profiles");
  }

  return await response.json();
}

async function getAuthUserByEmail(supabaseUrl: string, serviceRoleKey: string, email: string) {
  const url = new URL(`${supabaseUrl}/auth/v1/admin/users`);
  url.searchParams.set("page", "1");
  url.searchParams.set("per_page", "1000");

  const response = await fetch(url, {
    headers: serviceHeaders(serviceRoleKey),
  });

  if (!response.ok) return null;

  const data = await response.json();
  const users = Array.isArray(data?.users) ? data.users : [];
  return users.find((user: { email?: string }) => user.email?.toLowerCase() === email.toLowerCase()) || null;
}

async function deleteAuthUser(supabaseUrl: string, serviceRoleKey: string, userId: string) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: serviceHeaders(serviceRoleKey),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(error.message || "Unable to delete auth user");
  }
}

async function upsertProfile(
  supabaseUrl: string,
  serviceRoleKey: string,
  profile: { id: string; username: string; company: string; email: string },
) {
  const response = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
    method: "POST",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      "Prefer": "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      id: profile.id,
      username: profile.username,
      company: profile.company,
      email: profile.email,
      is_admin: false,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Unable to upsert profile");
  }
}

type PasswordEmailOptions = {
  supabaseUrl: string;
  serviceRoleKey: string;
  anonKey: string;
  email: string;
  appBaseUrl: string;
  brevoApiKey?: string;
  senderEmail: string;
  senderName: string;
  isNewAccount: boolean;
};

async function sendPasswordReset(options: PasswordEmailOptions) {
  if (options.brevoApiKey) {
    try {
      const actionLink = await generateRecoveryLink(options);
      await sendPasswordEmailWithBrevo(options, actionLink);
      return;
    } catch (error) {
      console.error("Brevo password email failed; using Supabase fallback", error);
    }
  }

  await sendSupabasePasswordReset(options);
}

async function generateRecoveryLink(options: PasswordEmailOptions) {
  const redirectTo = `${options.appBaseUrl.replace(/\/$/, "")}/reset.html`;
  const response = await fetch(`${options.supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: serviceHeaders(options.serviceRoleKey),
    body: JSON.stringify({
      type: "recovery",
      email: options.email,
      redirect_to: redirectTo,
    }),
  });

  const result = await safeJson(response);
  const actionLink = result.action_link || result.properties?.action_link;

  if (!response.ok || !actionLink) {
    throw new Error(result.message || result.msg || "Unable to generate password link");
  }

  return String(actionLink);
}

async function sendPasswordEmailWithBrevo(options: PasswordEmailOptions, actionLink: string) {
  const intro = options.isNewAccount
    ? "Il tuo account è stato creato. Clicca sul link qui sotto per creare la tua password personale."
    : "Hai richiesto di cambiare la password. Clicca sul pulsante qui sotto per crearne una nuova.";
  const subject = options.isNewAccount
    ? "Il tuo account Meeting Room Planner è pronto"
    : "Crea una nuova password per Meeting Room Planner";

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": options.brevoApiKey!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: options.senderName, email: options.senderEmail },
      to: [{ email: options.email }],
      subject,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:560px;margin:0 auto">
          <h1 style="font-size:24px">Meeting Room Planner</h1>
          <p>${intro}</p>
          <p style="margin:28px 0">
            <a href="${escapeHtml(actionLink)}" style="background:#3157d5;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block">Crea la tua password personale</a>
          </p>
          <p style="font-size:13px;color:#667085">Se non hai richiesto questa operazione, puoi ignorare questa email.</p>
        </div>
      `,
      textContent: `${intro}\n\nCrea la tua password: ${actionLink}\n\nSe non hai richiesto questa operazione, puoi ignorare questa email.`,
    }),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(error.message || `Unable to send password email (${response.status})`);
  }
}

async function sendSupabasePasswordReset(options: PasswordEmailOptions) {
  const response = await fetch(`${options.supabaseUrl}/auth/v1/recover`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": options.anonKey,
    },
    body: JSON.stringify({
      email: options.email,
      gotrue_meta_security: {},
      redirect_to: `${options.appBaseUrl.replace(/\/$/, "")}/reset.html`,
    }),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(error.message || error.msg || `Unable to send password reset (${response.status})`);
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return { message: await response.text() };
  }
}

function validatePayload(payload: CreateUserPayload) {
  if (!payload?.username?.trim()) return "Missing username";
  if (!payload?.company?.trim()) return "Missing company";
  if (!payload?.email?.includes("@")) return "Missing valid email";
  if (payload.password && payload.password.length < 8) return "Password must be at least 8 characters";
  return "";
}

function generateTemporaryPassword() {
  return `${crypto.randomUUID()}Aa1!`;
}

function serviceHeaders(serviceRoleKey: string) {
  return {
    "Authorization": `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    "apikey": serviceRoleKey,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
