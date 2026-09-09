// Normalizes whichever external provider you pick into one internal shape.
// Swap the implementation of fetchRawEvents() if you change providers —
// nothing else in the backend needs to know which API you're using.

export interface RawFlagEvent {
  region: string; // 'US' or state abbreviation
  status: 'half-staff' | 'full-staff';
  reason: string | null;
  issuedBy: string | null;
  startDate: string;
  endDate: string | null;
  sourceUrl: string | null;
}

const PROVIDER = process.env.FLAG_DATA_PROVIDER ?? 'rapidapi'; // 'rapidapi' | 'mast'
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

/** Fetches current half-staff events for the federal flag and all states. */
export async function fetchRawEvents(): Promise<RawFlagEvent[]> {
  if (PROVIDER === 'mast') {
    return fetchFromMast();
  }
  return fetchFromRapidApi();
}

async function fetchFromRapidApi(): Promise<RawFlagEvent[]> {
  const res = await fetch('https://flag-status.p.rapidapi.com/all', {
    headers: {
      'X-RapidAPI-Key': RAPIDAPI_KEY ?? '',
      'X-RapidAPI-Host': 'flag-status.p.rapidapi.com',
    },
  });
  if (!res.ok) {
    throw new Error(`RapidAPI flag status error: ${res.status}`);
  }
  const data = await res.json();

  return (data as any[]).map((item) => ({
    region: item.flag === 'US' ? 'US' : item.flag,
    status: 'half-staff' as const,
    reason: item.title ?? item.description ?? null,
    issuedBy: item.issued_by ?? null,
    startDate: item.date_start,
    endDate: item.date_end ?? null,
    sourceUrl: item.url ?? null,
  }));
}

async function fetchFromMast(): Promise<RawFlagEvent[]> {
  // Placeholder — adapt to Mast's actual response shape once you have API
  // access; check their terms on redistribution before shipping this.
  const res = await fetch('https://www.mast.today/api/status/all');
  if (!res.ok) {
    throw new Error(`Mast API error: ${res.status}`);
  }
  const data = await res.json();
  return data as RawFlagEvent[];
}
