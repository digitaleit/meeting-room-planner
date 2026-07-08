const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BookingPayload = {
  id: string;
  name: string;
  company: string;
  date: string;
  start_time: string;
  end_time: string;
  notes?: string;
};

type RequestPayload = {
  booking: BookingPayload;
  attendeeEmail: string;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("FROM_EMAIL") || "Meeting Room Planner <onboarding@resend.dev>";
  const adminEmail = Deno.env.get("ADMIN_EMAIL") || "stefano@stefanoserra.it";

  if (!resendApiKey) {
    return jsonResponse({ error: "Missing RESEND_API_KEY" }, 500);
  }

  const payload = await request.json() as RequestPayload;
  const callerEmail = getEmailFromAuthHeader(request.headers.get("Authorization"));
  const validationError = validatePayload(payload);

  if (validationError) {
    return jsonResponse({ error: validationError }, 400);
  }

  const { booking, attendeeEmail } = payload;

  if (callerEmail && callerEmail.toLowerCase() !== attendeeEmail.toLowerCase()) {
    return jsonResponse({ error: "Attendee email does not match authenticated user" }, 403);
  }

  const ics = buildIcs(booking);
  const subject = `Prenotazione sala riunioni - ${formatItalianDate(booking.date)} ${booking.start_time}-${booking.end_time}`;
  const html = buildEmailHtml(booking);
  const text = buildEmailText(booking);

  const recipients = Array.from(new Set([attendeeEmail, adminEmail].filter(Boolean)));
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: recipients,
      subject,
      html,
      text,
      attachments: [
        {
          filename: "prenotazione-sala.ics",
          content: base64FromUtf8(ics),
        },
      ],
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    return jsonResponse({ error: "Email provider error", details: result }, response.status);
  }

  return jsonResponse({ ok: true, result });
});

function validatePayload(payload: RequestPayload) {
  if (!payload?.attendeeEmail || !payload.attendeeEmail.includes("@")) return "Missing attendee email";
  if (!payload?.booking) return "Missing booking";
  if (!payload.booking.name) return "Missing booking name";
  if (!payload.booking.company) return "Missing booking company";
  if (!payload.booking.date) return "Missing booking date";
  if (!payload.booking.start_time) return "Missing start time";
  if (!payload.booking.end_time) return "Missing end time";
  return "";
}

function buildIcs(booking: BookingPayload) {
  const uid = `${booking.id || crypto.randomUUID()}@meeting-room-planner`;
  const created = toUtcStamp(new Date());
  const start = toLocalIcsDateTime(booking.date, booking.start_time);
  const end = toLocalIcsDateTime(booking.date, booking.end_time);
  const summary = escapeIcsText(`Sala riunioni - ${booking.company}`);
  const description = escapeIcsText([
    `Prenotazione sala riunioni`,
    `Nome: ${booking.name}`,
    `Azienda: ${booking.company}`,
    booking.notes ? `Note: ${booking.notes}` : "",
  ].filter(Boolean).join("\\n"));

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Meeting Room Planner//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${created}`,
    `DTSTART;TZID=Europe/Rome:${start}`,
    `DTEND;TZID=Europe/Rome:${end}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    "LOCATION:Sala riunioni",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function buildEmailHtml(booking: BookingPayload) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#172023">
      <h2>Prenotazione sala confermata</h2>
      <p><strong>${escapeHtml(formatItalianDate(booking.date))}</strong>, dalle <strong>${escapeHtml(booking.start_time)}</strong> alle <strong>${escapeHtml(booking.end_time)}</strong>.</p>
      <p><strong>Utente:</strong> ${escapeHtml(booking.name)}<br>
      <strong>Azienda:</strong> ${escapeHtml(booking.company)}</p>
      ${booking.notes ? `<p><strong>Note:</strong> ${escapeHtml(booking.notes)}</p>` : ""}
      <p>In allegato trovi il file calendario da aggiungere al tuo calendario personale.</p>
    </div>
  `;
}

function buildEmailText(booking: BookingPayload) {
  return [
    "Prenotazione sala confermata",
    `${formatItalianDate(booking.date)} ${booking.start_time}-${booking.end_time}`,
    `Utente: ${booking.name}`,
    `Azienda: ${booking.company}`,
    booking.notes ? `Note: ${booking.notes}` : "",
    "In allegato trovi il file calendario.",
  ].filter(Boolean).join("\n");
}

function toLocalIcsDateTime(date: string, time: string) {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function toUtcStamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function formatItalianDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function escapeIcsText(value: string) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

function escapeHtml(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function base64FromUtf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
}

function getEmailFromAuthHeader(authHeader: string | null) {
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) return "";

  const [, payload] = token.split(".");
  if (!payload) return "";

  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const normalized = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(normalized));
    return String(decoded.email || "");
  } catch {
    return "";
  }
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
