type QueryClient = { from: (table: string) => any };

export type FloV4SimpleIntent =
  | { kind: "greeting" }
  | { kind: "thanks" }
  | { kind: "app_help"; topic: "income" | "bucket_create" | "bucket_purchase" }
  | { kind: "current_date" }
  | { kind: "current_time" }
  | { kind: "weather"; location: string | null };

export type WeatherProviderConfig = {
  geocodeUrl: string;
  currentUrl: string;
  apiKey: string;
  apiKeyParam: string;
};

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
type SimpleResult = {
  answer: {
    answer: string;
    claims: never[];
    caveat: string | null;
    evidenceIds: string[];
    followups: string[];
  };
  sources: Array<{
    id: string;
    type: string;
    label: string;
    asOf: string | null;
    freshness: "current" | "stale" | "unknown";
    route?: string;
  }>;
  aggregate: {
    dataAsOf: string | null;
    coverage: Record<string, unknown>;
    partial: boolean;
  };
  usage: { inputTokens: 0; outputTokens: 0 };
  model: null;
  operation: string;
  auditRowCount: number;
};

const complete = (
  answer: string,
  operation: string,
  options: Partial<
    Pick<SimpleResult, "sources" | "aggregate" | "auditRowCount">
  > = {},
): SimpleResult => ({
  answer: {
    answer,
    claims: [],
    caveat: null,
    evidenceIds: options.sources?.map((source) => source.id) ?? [],
    followups: [],
  },
  sources: options.sources ?? [],
  aggregate: options.aggregate ?? {
    dataAsOf: null,
    coverage: { complete: true },
    partial: false,
  },
  usage: { inputTokens: 0, outputTokens: 0 },
  model: null,
  operation,
  auditRowCount: options.auditRowCount ?? 0,
});
const partial = (
  answer: string,
  operation: string,
  reason: string,
): SimpleResult => ({
  ...complete(answer, operation),
  answer: {
    answer,
    claims: [],
    caveat: "This response is intentionally limited rather than inferred.",
    evidenceIds: [],
    followups: [],
  },
  aggregate: {
    dataAsOf: null,
    coverage: { complete: false, reasons: [reason] },
    partial: true,
  },
});

function isSupportedPostalCode(value: string): boolean {
  return /^(?:\d{4,6}|\d{5}-\d{4}|[A-Z]\d[A-Z][ -]?\d[A-Z]\d|GIR[ -]?0AA|[A-Z]{1,2}\d[A-Z\d]?[ -]?\d[A-Z]{2})$/i.test(
    value,
  );
}

export function classifyFloV4SimpleIntent(
  question: string,
): FloV4SimpleIntent | null {
  const value = question.trim();
  if (/^(?:thanks|thank you)(?:,?\s+Flo)?[?!.]*$/i.test(value)) return { kind: "thanks" };
  if (/^(?:how (?:do|can) I|how to|where (?:do|can) I) add (?:an? )?income(?: source)?[?!.]*$/i.test(value)) return { kind: "app_help", topic: "income" };
  if (/^(?:how (?:do|can) I|how to|where (?:do|can) I) (?:create|add) (?:a )?(?:spending )?bucket[?!.]*$/i.test(value)) return { kind: "app_help", topic: "bucket_create" };
  if (/^(?:how (?:do|can) I|how to|where (?:do|can) I) add (?:a )?purchase to (?:a|an existing|my) (?:spending )?bucket[?!.]*$/i.test(value)) return { kind: "app_help", topic: "bucket_purchase" };
  if (
    /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|how\s+are\s+you)[?!.]*$/i.test(
      value,
    )
  )
    return { kind: "greeting" };
  if (
    /^(?:(?:what(?:'s|\s+is)\s+(?:today'?s\s+date|the\s+(?:current\s+)?(?:date|day)|the\s+date\s+today|day\s+is\s+it))|what\s+(?:date|day)\s+is\s+(?:it|today)|(?:tell\s+me|show\s+me)\s+(?:the\s+)?(?:current\s+date|current\s+day|today'?s\s+date)|today'?s\s+date|current\s+(?:date|day))[?!.]*$/i.test(
      value,
    )
  )
    return { kind: "current_date" };
  if (
    /^(?:(?:what(?:'s|\s+is)\s+(?:the\s+)?(?:current\s+)?time)|what\s+time\s+is\s+it|(?:tell\s+me|show\s+me)\s+(?:the\s+)?current\s+time|current\s+time)[?!.]*$/i.test(
      value,
    )
  )
    return { kind: "current_time" };
  if (
    /^(?:weather|weather\s+today|what(?:'s|\s+is)\s+the\s+weather(?:\s+like)?(?:\s+today)?)[?!.]*$/i.test(
      value,
    )
  )
    return { kind: "weather", location: null };
  const weather = value.match(
    /^(?:weather|current\s+weather|what(?:'s|\s+is)\s+(?:the\s+)?weather(?:\s+like)?)\s+(?:in|for)\s+(.+?)[?!.]*$/i,
  );
  if (!weather) return null;
  const location = weather[1].trim();
  const postal = isSupportedPostalCode(location);
  const cityAndCode =
    location.length <= 120 &&
    /^[\p{L}][\p{L}\s.'’-]{0,79},\s*[A-Z]{2}$/iu.test(location);
  if (!postal && !cityAndCode) return null;
  return { kind: "weather", location };
}

export function validIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export async function householdClockResult(
  client: QueryClient,
  householdId: string,
  kind: "current_date" | "current_time",
  now: string,
): Promise<SimpleResult> {
  const result = await client
    .from("household_settings")
    .select("household_id,time_zone")
    .eq("household_id", householdId)
    .maybeSingle();
  const row = result.data;
  if (
    result.error ||
    !row ||
    row.household_id !== householdId ||
    !validIanaTimeZone(row.time_zone) ||
    !Number.isFinite(Date.parse(now))
  )
    return partial(
      "I couldn’t verify your household’s saved time zone, so I won’t guess the current date or time.",
      `simple_${kind}`,
      "household_time_zone_unavailable",
    );
  const instant = new Date(now);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: row.time_zone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(instant);
  const answer =
    kind === "current_date"
      ? `Today is ${date} in your household’s saved time zone.`
      : `The current time is ${new Intl.DateTimeFormat("en-US", { timeZone: row.time_zone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(instant)} on ${date}.`;
  const source = {
    id: "household-time-zone",
    type: "household_setting",
    label: "Saved household time zone",
    asOf: null,
    freshness: "unknown" as const,
  };
  return complete(answer, `simple_${kind}`, {
    sources: [source],
    auditRowCount: 1,
  });
}

export function weatherProviderConfig(
  env: (name: string) => string | undefined,
): WeatherProviderConfig | null {
  const geocodeUrl = env("FLO_WEATHER_GEOCODE_URL")?.trim(),
    currentUrl = env("FLO_WEATHER_CURRENT_URL")?.trim(),
    apiKey = env("FLO_WEATHER_API_KEY")?.trim();
  const apiKeyParam = env("FLO_WEATHER_API_KEY_PARAM")?.trim() || "apikey";
  if (
    !geocodeUrl ||
    !currentUrl ||
    !apiKey ||
    !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(apiKeyParam)
  )
    return null;
  try {
    const geocode = new URL(geocodeUrl);
    const current = new URL(currentUrl);
    if (
      geocode.origin !== "https://customer-geocoding-api.open-meteo.com" ||
      geocode.pathname !== "/v1/search" ||
      current.origin !== "https://customer-api.open-meteo.com" ||
      current.pathname !== "/v1/forecast" ||
      geocode.username ||
      geocode.password ||
      current.username ||
      current.password ||
      geocode.hash ||
      current.hash
    )
      return null;
  } catch {
    return null;
  }
  return { geocodeUrl, currentUrl, apiKey, apiKeyParam };
}

function normalizedLocation(value: string): string | null {
  const location = value.trim().replace(/\s+/g, " ");
  if (
    location.length < 2 ||
    location.length > 120 ||
    /[\x00-\x1f\x7f]/.test(location) ||
    !/^[\p{L}\p{N}\s,.'’+-]+$/u.test(location)
  )
    return null;
  const postal = isSupportedPostalCode(location);
  const place = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return postal || place.length >= 2 ? location : null;
}

const weatherDescriptions: Record<number, string> = {
  0: "clear skies",
  1: "mainly clear conditions",
  2: "partly cloudy conditions",
  3: "overcast conditions",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "drizzle",
  55: "dense drizzle",
  56: "light freezing drizzle",
  57: "dense freezing drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "light freezing rain",
  67: "heavy freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light rain showers",
  81: "rain showers",
  82: "heavy rain showers",
  85: "light snow showers",
  86: "heavy snow showers",
  95: "thunderstorms",
  96: "thunderstorms with light hail",
  99: "thunderstorms with heavy hail",
};

async function fetchJson(
  fetcher: Fetcher,
  url: URL,
  timeoutMs: number,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) return { ok: false, reason: "weather_provider_http" };
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 262_144) {
      await response.body?.cancel();
      return { ok: false, reason: "weather_provider_response_too_large" };
    }
    if (!response.body)
      return { ok: false, reason: "weather_provider_malformed" };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = "";
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > 262_144) {
        await reader.cancel();
        return { ok: false, reason: "weather_provider_response_too_large" };
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return { ok: true, value: JSON.parse(body) };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof DOMException && error.name === "AbortError"
          ? "weather_provider_timeout"
          : "weather_provider_unavailable",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function weatherResult(
  locationInput: string | null,
  config: WeatherProviderConfig | null,
  options: { fetcher?: Fetcher; now: string; timeoutMs?: number },
): Promise<SimpleResult> {
  if (!locationInput)
    return partial(
      "What city and state or country—or postal code—should I use for the weather?",
      "simple_weather",
      "weather_location_required",
    );
  const location = normalizedLocation(locationInput);
  if (!location)
    return partial(
      "Please provide a city and state or country, or a postal code, for the weather.",
      "simple_weather",
      "weather_location_invalid",
    );
  if (!config)
    return partial(
      "Weather is not configured for this preview yet.",
      "simple_weather",
      "weather_provider_unconfigured",
    );
  const fetcher = options.fetcher ?? fetch,
    timeoutMs = Math.max(100, Math.min(options.timeoutMs ?? 5000, 10000));
  const geocode = new URL(config.geocodeUrl);
  geocode.searchParams.set("name", location);
  geocode.searchParams.set("count", "5");
  geocode.searchParams.set("language", "en");
  geocode.searchParams.set("format", "json");
  geocode.searchParams.set(config.apiKeyParam, config.apiKey);
  const located = await fetchJson(fetcher, geocode, timeoutMs);
  if ("reason" in located)
    return partial(
      "I couldn’t retrieve that location’s weather right now.",
      "simple_weather",
      located.reason,
    );
  const results = (located.value as any)?.results;
  if (!Array.isArray(results) || results.length === 0)
    return partial(
      "I couldn’t find that location. Please include a city and state or country, or use a postal code.",
      "simple_weather",
      "weather_location_not_found",
    );
  const printableLabel = (value: unknown, required = false) =>
    typeof value === "string" &&
    value.trim().length >= (required ? 1 : 0) &&
    value.trim().length <= 80 &&
    !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
  const valid = results.filter(
    (row: any) =>
      row &&
      Number.isFinite(row.latitude) &&
      Number.isFinite(row.longitude) &&
      printableLabel(row.name, true) &&
      (row.admin1 == null || printableLabel(row.admin1)) &&
      (row.country == null || printableLabel(row.country)),
  );
  if (!valid.length)
    return partial(
      "I couldn’t verify that location from the weather provider.",
      "simple_weather",
      "weather_geocode_malformed",
    );
  const labels = [
    ...new Set(
      valid.map((row: any) =>
        [row.name, row.admin1, row.country]
          .filter((value) => typeof value === "string" && value.trim())
          .map((value) => value.trim())
          .join(", "),
      ),
    ),
  ];
  const coordinatePairs = new Set(
    valid.map((row: any) => `${row.latitude},${row.longitude}`),
  );
  if (labels.length > 1 || coordinatePairs.size > 1)
    return partial(
      `That location is ambiguous. Please choose one of: ${labels.slice(0, 3).join("; ")}.`,
      "simple_weather",
      "weather_location_ambiguous",
    );
  const place = valid[0],
    latitude = Number(place.latitude),
    longitude = Number(place.longitude);
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
    return partial(
      "I couldn’t verify that location from the weather provider.",
      "simple_weather",
      "weather_geocode_malformed",
    );
  const currentUrl = new URL(config.currentUrl);
  currentUrl.searchParams.set("latitude", String(latitude));
  currentUrl.searchParams.set("longitude", String(longitude));
  currentUrl.searchParams.set(
    "current",
    "temperature_2m,weather_code,wind_speed_10m",
  );
  currentUrl.searchParams.set("temperature_unit", "fahrenheit");
  currentUrl.searchParams.set("wind_speed_unit", "mph");
  currentUrl.searchParams.set("timezone", "UTC");
  currentUrl.searchParams.set(config.apiKeyParam, config.apiKey);
  const conditions = await fetchJson(fetcher, currentUrl, timeoutMs);
  if ("reason" in conditions)
    return partial(
      "I couldn’t retrieve current weather conditions right now.",
      "simple_weather",
      conditions.reason,
    );
  const current = (conditions.value as any)?.current,
    temperature = current?.temperature_2m,
    wind = current?.wind_speed_10m,
    code = current?.weather_code;
  const observedRaw = typeof current?.time === "string" ? current.time : "";
  const observedValue =
    observedRaw && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(observedRaw)
      ? observedRaw
      : observedRaw
        ? `${observedRaw}Z`
        : "";
  const observed =
    observedValue && Number.isFinite(Date.parse(observedValue))
      ? new Date(observedValue).toISOString()
      : null;
  const retrievedMs = Date.parse(options.now),
    observedMs = observed ? Date.parse(observed) : NaN;
  if (
    !Number.isFinite(temperature) ||
    !Number.isFinite(wind) ||
    wind < 0 ||
    !Number.isInteger(code) ||
    !weatherDescriptions[code] ||
    !Number.isFinite(retrievedMs) ||
    !Number.isFinite(observedMs)
  )
    return partial(
      "The weather provider returned an invalid current-conditions response.",
      "simple_weather",
      "weather_conditions_malformed",
    );
  const ageMs = retrievedMs - observedMs;
  if (ageMs > 3 * 60 * 60 * 1000 || ageMs < -5 * 60 * 1000)
    return partial(
      "The available weather observation is stale, so I won’t present it as current.",
      "simple_weather",
      "weather_observation_stale",
    );
  const resolved = labels[0],
    retrieved = new Date(retrievedMs).toISOString();
  const source = {
    id: "weather-current",
    type: "external_weather",
    label: "Open-Meteo current conditions",
    asOf: observed,
    freshness: "current" as const,
  };
  return complete(
    `In ${resolved}, it’s ${Math.round(temperature)}°F with ${weatherDescriptions[code]} and winds near ${Math.round(wind)} mph. Observed ${observed}; retrieved ${retrieved}.`,
    "simple_weather",
    {
      sources: [source],
      aggregate: {
        dataAsOf: observed,
        coverage: {
          complete: true,
          source: "configured_weather_provider",
          retrievedAt: retrieved,
        },
        partial: false,
      },
    },
  );
}

/** Pure allowlisted static responses, shared by the endpoint and evaluator.
 * Financial questions are not classified here and keep the analysis pipeline. */
export function floV4StaticIntentResult(intent: FloV4SimpleIntent): SimpleResult | null {
  if (intent.kind === "greeting" || intent.kind === "thanks") {
    const result = complete(intent.kind === "greeting" ? "Hi! I’m Flo. I can help you understand your accounts, bills, spending, and buckets. What would you like to check?" : "You’re welcome. What would you like to check next?", `simple_${intent.kind}`);
    result.answer.followups = ["What accounts can you see?", "What bills are due before my next paycheck?", "How do I create a spending bucket?"];
    return result;
  }
  if (intent.kind !== "app_help") return null;
  const help = {
    income: { text: "Open Settings → Plan settings → Income, then choose Add income source. Enter its amount and schedule, review the details, and save it in the app.", route: "/(tabs)/more?section=money", label: "Income settings" },
    bucket_create: { text: "Open Buckets from the Dashboard or Settings → Tools & lists, then choose Create bucket. Enter its name, planned amount, and target date, review the details, and save it in the app.", route: "/(tabs)/more?section=buckets", label: "Spending buckets" },
    bucket_purchase: { text: "Open the bucket in Buckets. If it’s closed, choose Reopen bucket first; if its budget is used up, choose Adjust budget. Then choose Add purchase and pick an existing bank transaction, an existing manual transaction, or enter a new purchase. Review the amount and confirm it in the app. I haven’t recorded or changed anything.", route: "/(tabs)/more?section=buckets", label: "Spending buckets" },
  }[intent.topic];
  return complete(help.text, "simple_app_help", { sources: [{ id: `app-help:${intent.topic}`, type: "help", label: help.label, asOf: null, freshness: "unknown", route: help.route }] });
}

export async function runFloV4SimpleIntent(
  intent: FloV4SimpleIntent,
  dependencies: {
    client: QueryClient;
    householdId: string;
    now: string;
    weatherConfig: WeatherProviderConfig | null;
    fetcher?: Fetcher;
  },
): Promise<SimpleResult> {
  if (intent.kind === "greeting" || intent.kind === "thanks" || intent.kind === "app_help") return floV4StaticIntentResult(intent)!;
  if (intent.kind === "current_date" || intent.kind === "current_time")
    return householdClockResult(
      dependencies.client,
      dependencies.householdId,
      intent.kind,
      dependencies.now,
    );
  return weatherResult(intent.location, dependencies.weatherConfig, {
    fetcher: dependencies.fetcher,
    now: dependencies.now,
  });
}
