const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BookingPayload = {
  id: string;
  user_id?: string;
  name?: string;
  company?: string;
  date?: string;
  start_time?: string;
  end_time?: string;
  notes?: string;
};

type RequestPayload = {
  action: "update" | "delete";
  booking: BookingPayload;
};

Deno.serve(async (request) => {
  try {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const authToken = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return jsonResponse({ error: "Missing Supabase secrets" }, 500);
    }

    if (!authToken) return jsonResponse({ error: "Missing authorization" }, 401);

    const caller = await getCaller(supabaseUrl, authToken, anonKey);
    if (!caller?.id) return jsonResponse({ error: "Invalid user" }, 401);

    const payload = await request.json() as RequestPayload;
    if (!payload?.booking?.id) return jsonResponse({ error: "Missing booking id" }, 400);

    const existing = await getBooking(supabaseUrl, serviceRoleKey, payload.booking.id);
    if (!existing) return jsonResponse({ error: "Booking not found" }, 404);

    const isAdmin = await checkAdmin(supabaseUrl, serviceRoleKey, caller.id);
    if (!isAdmin && existing.user_id !== caller.id) {
      return jsonResponse({ error: "Only owner or admin can manage this booking" }, 403);
    }

    if (payload.action === "delete") {
      await deleteBooking(supabaseUrl, serviceRoleKey, payload.booking.id);
      return jsonResponse({ ok: true, deleted: true });
    }

    if (payload.action === "update") {
      const validationError = validateBooking(payload.booking);
      if (validationError) return jsonResponse({ error: validationError }, 400);

      const updated = await updateBooking(supabaseUrl, serviceRoleKey, {
        ...payload.booking,
        user_id: existing.user_id,
      });
      return jsonResponse({ ok: true, booking: updated });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
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

  const response = await fetch(url, { headers: serviceHeaders(serviceRoleKey) });
  if (!response.ok) return false;
  const data = await response.json();
  return Array.isArray(data) && data.length === 1;
}

async function getBooking(supabaseUrl: string, serviceRoleKey: string, id: string) {
  const url = new URL(`${supabaseUrl}/rest/v1/bookings`);
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("select", "id,user_id,name,company,date,start_time,end_time,notes,created_at");
  url.searchParams.set("limit", "1");

  const response = await fetch(url, { headers: serviceHeaders(serviceRoleKey) });
  if (!response.ok) throw new Error("Unable to load booking");
  const data = await response.json();
  return Array.isArray(data) ? data[0] : null;
}

async function updateBooking(supabaseUrl: string, serviceRoleKey: string, booking: BookingPayload) {
  const response = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${booking.id}`, {
    method: "PATCH",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      "Prefer": "return=representation",
    },
    body: JSON.stringify({
      name: booking.name,
      company: booking.company,
      date: booking.date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      notes: booking.notes || "",
    }),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(error.message || error.details || "Unable to update booking");
  }

  const data = await response.json();
  return Array.isArray(data) ? data[0] : null;
}

async function deleteBooking(supabaseUrl: string, serviceRoleKey: string, id: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/bookings?id=eq.${id}`, {
    method: "DELETE",
    headers: serviceHeaders(serviceRoleKey),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(error.message || "Unable to delete booking");
  }
}

function validateBooking(booking: BookingPayload) {
  if (!booking.name || !booking.company || !booking.date || !booking.start_time || !booking.end_time) {
    return "Missing booking fields";
  }

  if (booking.end_time <= booking.start_time) return "End time must be after start time";
  if (booking.start_time < "08:00" || booking.end_time > "20:00") return "Booking outside allowed hours";
  return "";
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return { message: await response.text() };
  }
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
