import type { App } from '../lib/types.ts';
import { requireUser } from '../lib/auth.ts';
import { rateLimited } from '../lib/rateLimit.ts';
import { log } from '../../_shared/log.ts';

// Google Places proxy. Auth-only (gates API-key abuse); no org concept.
// Behavior preserved verbatim from the legacy handler.
export function registerPlaces(app: App) {
  // Text search
  app.get('/integrations/google-places/search', requireUser, async (c) => {
    const query = c.req.query('query');
    const latitude = c.req.query('latitude');
    const longitude = c.req.query('longitude');

    if (!query) {
      return c.json({ error: 'Query parameter is required' }, 400);
    }

    const limited = await rateLimited(c, 'places');
    if (limited) return limited;

    const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
    if (!apiKey) {
      log('error', 'places.not_configured');
      return c.json({ error: 'Google Places API key not configured' }, 500);
    }

    const body: Record<string, unknown> = { textQuery: query };
    if (latitude && longitude) {
      body.locationBias = {
        circle: {
          center: { latitude: parseFloat(latitude), longitude: parseFloat(longitude) },
          radius: 50000.0,
        },
      };
    }

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.types',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      log('error', 'places.api_failed', { status: response.status, err: data?.error });
      return c.json(
        { error: `Google Places API error: ${response.status}`, details: data.error?.message || 'Unknown error' },
        500
      );
    }

    const relevantKeywords = [
      'sound', 'audio', 'lighting', 'stage', 'staging', 'production',
      'event', 'venue', 'entertainment', 'music', 'concert', 'theater',
      'theatre', 'show', 'performance', 'rental', 'av', 'pro audio',
    ];

    const scoredResults = (data.places || []).map((place: any) => {
      const name = (place.displayName?.text || '').toLowerCase();
      let score = 0;
      if (name.startsWith(query.toLowerCase())) score += 50;
      else if (name.includes(query.toLowerCase())) score += 20;
      for (const keyword of relevantKeywords) {
        if (name.includes(keyword.toLowerCase())) score += 30;
      }
      return {
        place_id: place.id,
        name: place.displayName?.text,
        formatted_address: place.formattedAddress,
        types: place.types,
        score,
      };
    });

    const filteredResults = scoredResults.filter((r: any) => r.score >= 0);
    filteredResults.sort((a: any, b: any) => b.score - a.score);

    const results = filteredResults.slice(0, 10).map((r: any) => ({
      place_id: r.place_id,
      name: r.name,
      formatted_address: r.formatted_address,
    }));

    return c.json({ results });
  });

  // Place details (catch-all; static /search above wins via Hono static-first)
  app.get('/integrations/google-places/:placeId{.+}', requireUser, async (c) => {
    const placeId = c.req.param('placeId');

    const limited = await rateLimited(c, 'places');
    if (limited) return limited;

    const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
    if (!apiKey) {
      log('error', 'places.not_configured');
      return c.json({ error: 'Google Places API key not configured' }, 500);
    }

    const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,editorialSummary,addressComponents',
      },
    });

    const data = await response.json();
    if (!response.ok) {
      log('error', 'places.api_failed', { status: response.status, err: data?.error });
      return c.json(
        { error: `Google Places API error: ${response.status}`, details: data.error?.message || 'Unknown error' },
        500
      );
    }

    const place = data;
    const address_components = (place.addressComponents || []).map((comp: any) => ({
      long_name: comp.longText,
      short_name: comp.shortText,
      types: comp.types,
    }));

    return c.json({
      place_id: place.id || placeId,
      name: place.displayName?.text,
      formatted_address: place.formattedAddress,
      formatted_phone_number: place.nationalPhoneNumber,
      website: place.websiteUri,
      editorial_summary: place.editorialSummary?.text,
      address_components,
    });
  });
}
