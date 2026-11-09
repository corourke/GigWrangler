import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { captureException } from "../_shared/sentry.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { buildScanParams, readScanResponse } from "./scanRequest.ts";
import { mediaTypeFor, queueUpdateFor, staleScanCutoff } from "./scanQueue.ts";
import { canScanInvoices, scanLimitError, scanFailure } from "./scanLimits.ts";
import { classifyItem } from "./classifyItem.ts";

function getCorsHeaders(req: Request): Record<string, string> {
  return corsHeaders(req.headers.get('Origin'), {
    allowMethods: 'POST, OPTIONS',
    allowHeaders: 'authorization, x-client-info, apikey, content-type',
  });
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ASSET_CATEGORY_HINTS = `
ASSET categories (for durable equipment):
Audio       → Microphone, Speaker, Subwoofer, Amplifier, Mixer, Interface,
              Processor, DI Box, In-Ear Monitor, Headphone, Cable, Connector,
              Accessory, Software
Lighting    → Moving Head, LED Par, Wash, Spot, Strobe, Controller, Cable,
              Truss, Stand, Dimmer, Accessory
Video       → Camera, Display, Projector, Switcher, Scaler, Cable, Accessory
Backline    → Guitar Amp, Bass Amp, Keyboard, Drum Kit, Percussion, Accessory
Staging     → Stage Deck, Leg, Guardrail, Stair, Carpet, Accessory
Cases       → Road Case, Rack Case, Soft Bag, Accessory
Power       → Distribution, Cabling, UPS, Accessory
Networking  → Switch, Router, Cable, Wireless, Accessory
Misc        → (anything that doesn't fit above)
`;

const EXPENSE_CATEGORY_HINTS = `
EXPENSE categories (IRS Schedule C Part II — use for non-durable / consumable items):
Advertising                   → Promo flyers, social media ads, event listings, graphic design, sponsorship materials
Commissions                   → Booking agent fees, ticketing platform cuts, credit card processing fees
Depreciation                  → Annual write-down of PA systems, lighting rigs, road cases, vehicles
Insurance                     → Event liability, equipment floater, performer insurance, venue insurance
Labor                         → Stagehands, riggers, freelance engineers, day-of crew, security, photographers
Legal/Accounting              → Performance contracts, rider reviews, accountant/CPA fees, legal counsel
Meals                         → Crew meals, hospitality rider food, catering buyouts, craft services
Office                        → Scheduling software, DAW subscriptions, cloud storage, office supplies
Rentals                       → Venue rental, backline rentals, generator rental, tent/staging rental, speaker/lighting rig rental
Repairs                       → Blown driver replacement, fixture re-lamping, cable repair, console servicing, tuning
Supplies                      → Gaffer tape, batteries, lamps/bulbs, consumable cables, cleaning supplies, zip ties, expendables
Taxes/Licenses                → Music licenses (ASCAP/BMI/SESAC), business licenses, venue permits, noise permits
Transportation                → Mileage/fuel for load-in/out, van/truck rentals, tolls, parking
Travel                        → Airfare, hotels, per diem for touring crew, ground transport, ride-shares
Utilities                     → Generator fuel, temporary power drops, internet/comms at venue, water/sanitation
Wages                         → W-2 employees — full-time crew, office staff, salaried production managers
Other                         → Misc production costs not fitting above
`;

const EXTRACTION_PROMPT = `
You are an inventory assistant for a professional audio/video/lighting production company.
Extract structured data from the invoice or receipt document below and return ONLY a JSON object
with no explanation, markdown, or code fences.

${ASSET_CATEGORY_HINTS}

${EXPENSE_CATEGORY_HINTS}

JSON schema to return:
{
  "purchase_date": "YYYY-MM-DD or null",
  "vendor": "Vendor name or null",
  "total_inv_amount": <number or null>,
  "payment_method": "Payment method or null",
  "invoice_number": "<invoice number, receipt number, order number, or PO number if present, else null>",
  "items": [
    {
      "manufacturer_model": "<Brand + Model string — this is the primary identifier>",
      "description": "<full line description including accessories or bundle notes>",
      "quantity": <integer, default 1>,
      "item_price": <number or null — the unit price as printed on the invoice>,
      "item_cost": <number or null — set to the unit price if present, or null — the burdened cost per item if you can calculate it based on header fees (tax/shipping)>,
      "line_amount": <number or null — the total amount for this line as printed on the invoice>,
      "serial_numbers": ["SN1", "SN2"],
      "category": "<if is_durable: use ASSET category; if is_consumable or not durable: use EXPENSE (IRS Schedule C) category>",
      "sub_category": "<only for assets: use the sub-category from ASSET category hints; null for expenses>",
      "type": "<short practical label, e.g. 'Powered Speaker', 'Dynamic Microphone'>",
      "is_durable": <boolean, true for durable equipment (e.g. gear, cases, tools)>,
      "is_consumable": <boolean, true for short-lived items (e.g. batteries, tape, cleaning supplies)>
    }
  ]
}

Rules:
- manufacturer_model is REQUIRED for every line item. If the invoice has no clear make/model, use the best descriptive label available.
- DO NOT calculate any values. Extract them exactly as they appear. If a field isn't present, return null.
- Omit line items that are purely shipping, tax, or fees (these costs will be allocated later).
- If a line shows qty > 1 and lists individual serial numbers, expand into one item per serial number (quantity=1 each) rather than grouping.
- Dates must be ISO 8601 (YYYY-MM-DD).
- Costs and prices are numeric only (no currency symbols).
- total_inv_amount must be the ABSOLUTE GRAND TOTAL of the invoice (all items + tax + shipping - discounts). This is critical.

Analyze the document and return the JSON.
`;

interface ScanResult {
  status: number;
  body: Record<string, unknown>;
}

/** Reads one invoice file with Claude. Errors the caller should report come back as a status; others throw. */
async function scanFile(file: File, organizationId: string, userId: string, adminClient: SupabaseClient): Promise<ScanResult> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { status: 413, body: { error: 'File too large (max 10 MB)' } };
  }

  // Resolve the media type (fall back to the extension for clients that send
  // a generic content type) and enforce the allowlist
  const mediaType = mediaTypeFor(file.type, file.name);
  if (!mediaType) {
    return { status: 415, body: { error: 'Unsupported file type (PDF, JPEG, PNG, WebP, or GIF only)' } };
  }

  // Limits: the person's scans in the trailing hour and the organization's in the trailing
  // 24 hours, counted before spending Anthropic credits; the attempt is recorded before the call
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [userUsage, orgUsage] = await Promise.all([
    adminClient
      .from('ai_scan_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', oneHourAgo),
    adminClient
      .from('ai_scan_usage')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .gte('created_at', oneDayAgo),
  ]);

  if (userUsage.error || orgUsage.error) {
    console.error('Failed to check scan usage:', userUsage.error ?? orgUsage.error);
    throw new Error('Unable to verify scan quota');
  }

  const limitError = scanLimitError({ userScansLastHour: userUsage.count ?? 0, orgScansLastDay: orgUsage.count ?? 0 });
  if (limitError) {
    return { status: 429, body: { error: limitError } };
  }

  const { error: insertError } = await adminClient
    .from('ai_scan_usage')
    .insert({ user_id: userId, organization_id: organizationId });
  if (insertError) {
    console.error('Failed to record scan usage:', insertError);
    throw new Error('Unable to record scan usage');
  }

  // Opportunistic cleanup so the usage table stays small (the daily limit needs only the last 24 hours)
  await adminClient.from('ai_scan_usage').delete().lt('created_at', oneDayAgo);

  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const base64Data = encodeBase64(uint8Array);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }

  const anthropic = new Anthropic({
    apiKey,
  });

  // Determine content for Anthropic message
  const content: any[] = [];

  if (mediaType === 'application/pdf') {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: base64Data,
      },
    });
  } else {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType as any,
        data: base64Data,
      },
    });
  }

  let response;
  try {
    response = await anthropic.beta.messages.create(buildScanParams(content, EXTRACTION_PROMPT));
  } catch (err: any) {
    console.error('Anthropic API Error:', err.status, err.message);
    
    if (err.status === 404 || err.status === 400) {
      return {
        status: 403,
        body: {
          error: 'SCAN_ACCESS_REQUIRED',
          message: 'Invoice scanning is not available right now.',
        },
      };
    } else {
      throw err;
    }
  }

  if (response.stop_reason === 'max_tokens') {
    console.warn('AI response was truncated (max_tokens reached)');
  }

  const rawOutput = readScanResponse(response);
  
  // Extract JSON from response
  const jsonMatch = rawOutput.match(/\{.*\}/s);
  if (!jsonMatch) {
    throw new Error('Failed to extract JSON from AI response');
  }
  
  let jsonStr = jsonMatch[0];

  // Attempt repair if truncated: close open arrays/objects
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (_parseErr) {
    // Try to repair truncated JSON by closing open brackets
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escape = false;
    for (const ch of jsonStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') openBraces++;
      else if (ch === '}') openBraces--;
      else if (ch === '[') openBrackets++;
      else if (ch === ']') openBrackets--;
    }

    // Remove trailing comma before closing
    jsonStr = jsonStr.replace(/,\s*$/, '');

    for (let i = 0; i < openBrackets; i++) jsonStr += ']';
    for (let i = 0; i < openBraces; i++) jsonStr += '}';

    try {
      parsed = JSON.parse(jsonStr);
      console.warn('Repaired truncated JSON successfully');
    } catch (repairErr: any) {
      throw new Error(`AI returned malformed JSON that could not be repaired: ${repairErr.message}`);
    }
  }
  
  // Post-process: Apply classification and format for preview
  const processedItems = (parsed.items || []).map((item: any) => ({
    ...item,
    suggested_type: classifyItem(item),
    item_cost: item.item_cost || item.item_price || 0, // Fallback to item_price for cost if not extracted
  }));

  return { status: 200, body: { ...parsed, items: processedItems } };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const json = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Service-role client for the membership check, rate limiting and the scan
    // queue (ai_scan_usage has no RLS policies; it is service-role only)
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // A queued invoice (10-01): the file is already in storage; claim the row so
    // no other tab scans it too, scan it, and record the result on the row.
    if ((req.headers.get('content-type') ?? '').includes('application/json')) {
      const { queue_item_id: queueItemId } = await req.json().catch(() => ({}));
      if (typeof queueItemId !== 'string' || !UUID_REGEX.test(queueItemId)) {
        return json(400, { error: 'queue_item_id is required' });
      }
      const { data: item } = await adminClient
        .from('purchase_scan_queue')
        .select('id, organization_id, file_name, attachments(file_path)')
        .eq('id', queueItemId)
        .maybeSingle();
      if (!item) return json(404, { error: 'Invoice not found in the scan queue' });

      const { data: role } = await adminClient
        .from('organization_members')
        .select('role')
        .eq('organization_id', item.organization_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!canScanInvoices(role?.role)) {
        return json(403, { error: 'Only Admins and Managers can scan invoices' });
      }

      const { data: claimed } = await adminClient
        .from('purchase_scan_queue')
        .update({ status: 'scanning', error: null })
        .eq('id', queueItemId)
        .or(`status.in.(queued,failed),and(status.eq.scanning,updated_at.lt.${staleScanCutoff(new Date())})`)
        .select('id');
      if (!claimed?.length) return json(409, { error: 'This invoice is already being scanned' });

      let result: ScanResult;
      try {
        const filePath = (item.attachments as { file_path?: string } | null)?.file_path;
        const { data: blob, error: downloadError } = filePath
          ? await adminClient.storage.from('attachments').download(filePath)
          : { data: null, error: new Error('missing file') };
        if (downloadError || !blob) throw new Error('Could not read the invoice file');
        const file = new File([blob], item.file_name, { type: blob.type });
        result = await scanFile(file, item.organization_id, user.id, adminClient);
      } catch (err: any) {
        const reference = crypto.randomUUID();
        console.error(`Error scanning a queued invoice (reference ${reference}):`, err);
        await captureException(err);
        result = scanFailure(reference);
      }
      await adminClient.from('purchase_scan_queue').update(queueUpdateFor(result)).eq('id', queueItemId);
      return json(result.status, result.body);
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const organizationId = formData.get('organization_id');

    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (typeof organizationId !== 'string' || !UUID_REGEX.test(organizationId)) {
      return new Response(JSON.stringify({ error: 'organization_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: membership, error: membershipError } = await adminClient
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (membershipError || !canScanInvoices(membership?.role)) {
      return json(403, { error: 'Only Admins and Managers can scan invoices' });
    }

    const result = await scanFile(file, organizationId, user.id, adminClient);
    return json(result.status, result.body);

  } catch (error: any) {
    const reference = crypto.randomUUID();
    console.error(`Error in ai-scan (reference ${reference}):`, error);
    await captureException(error);
    const failure = scanFailure(reference);
    return new Response(JSON.stringify(failure.body), {
      status: failure.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
