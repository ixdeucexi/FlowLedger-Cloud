import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFloV4SimpleIntent,
  householdClockResult,
  runFloV4SimpleIntent,
  weatherProviderConfig,
  weatherResult,
} from "./simpleIntents.ts";

const householdId = "22222222-2222-4222-8222-222222222222";
function settingsClient(result) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(["from", table]);
      return {
        select(columns) {
          calls.push(["select", columns]);
          return this;
        },
        eq(column, value) {
          calls.push(["eq", column, value]);
          return this;
        },
        async maybeSingle() {
          return result;
        },
      };
    },
  };
}
const config = {
  geocodeUrl: "https://customer-geocoding-api.open-meteo.com/v1/search",
  currentUrl: "https://customer-api.open-meteo.com/v1/forecast",
  apiKey: "server-secret",
  apiKeyParam: "apikey",
};
const response = (value) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const successFetch =
  (observed = "2026-10-14T15:00:00Z") =>
  async (input) => {
    const url = new URL(input);
    return url.pathname === "/v1/search"
      ? response({
          results: [
            {
              name: "Chicago",
              admin1: "Illinois",
              country: "United States",
              latitude: 41.88,
              longitude: -87.63,
            },
          ],
        })
      : response({
          current: {
            time: observed,
            temperature_2m: 72.4,
            weather_code: 2,
            wind_speed_10m: 7.6,
          },
        });
  };

test("strict greetings and simple intents never consume compound financial prompts", () => {
  for (const question of [
    "hi",
    "Hello!",
    "hey",
    "Good morning",
    "good afternoon.",
    "Good evening!",
    "How are you?",
  ])
    assert.deepEqual(classifyFloV4SimpleIntent(question), { kind: "greeting" });
  assert.equal(
    classifyFloV4SimpleIntent("Hi, what bills are due after payday?"),
    null,
  );
  assert.equal(classifyFloV4SimpleIntent("Hello, show my balance"), null);
  assert.equal(
    classifyFloV4SimpleIntent("Weather in Chicago, IL and show my balance"),
    null,
  );
  assert.equal(
    classifyFloV4SimpleIntent(
      "What is the weather in Boston, MA and what bills are due?",
    ),
    null,
  );
  assert.equal(
    classifyFloV4SimpleIntent("Weather in Chicago, IL tomorrow"),
    null,
  );
  assert.equal(
    classifyFloV4SimpleIntent("Weather in Chicago, IL bills due"),
    null,
  );
  assert.equal(
    classifyFloV4SimpleIntent("Weather in Chicago, IL / show balance"),
    null,
  );
  for (const compound of [
    "Weather in Chicago, IL with my credit card utilization",
    "Weather in Chicago, IL. Give me my credit card utilization",
    "Weather in Chicago, IL alongside my net worth",
  ]) {
    assert.equal(classifyFloV4SimpleIntent(compound), null);
  }
  assert.equal(classifyFloV4SimpleIntent("Weather for 90210 cash"), null);
  assert.equal(classifyFloV4SimpleIntent("Weather for 90210 bills"), null);
  assert.deepEqual(classifyFloV4SimpleIntent("What's today's date?"), {
    kind: "current_date",
  });
  assert.deepEqual(classifyFloV4SimpleIntent("What date is it?"), {
    kind: "current_date",
  });
  assert.deepEqual(classifyFloV4SimpleIntent("Show me the current day"), {
    kind: "current_date",
  });
  assert.deepEqual(classifyFloV4SimpleIntent("What time is it?"), {
    kind: "current_time",
  });
  assert.deepEqual(classifyFloV4SimpleIntent("What's current time?"), {
    kind: "current_time",
  });
  assert.deepEqual(classifyFloV4SimpleIntent("What's the weather?"), {
    kind: "weather",
    location: null,
  });
  assert.deepEqual(classifyFloV4SimpleIntent("Weather in Chicago, IL"), {
    kind: "weather",
    location: "Chicago, IL",
  });
  assert.deepEqual(classifyFloV4SimpleIntent("Weather in Show Low, AZ"), {
    kind: "weather",
    location: "Show Low, AZ",
  });
  assert.deepEqual(
    classifyFloV4SimpleIntent("Weather in Truth or Consequences, NM"),
    {
      kind: "weather",
      location: "Truth or Consequences, NM",
    },
  );
  assert.deepEqual(classifyFloV4SimpleIntent("Weather for SW1A 1AA"), {
    kind: "weather",
    location: "SW1A 1AA",
  });
  for (const postal of ["90210", "90210-1234", "K1A 0B1", "SW1A 1AA"]) {
    assert.deepEqual(classifyFloV4SimpleIntent(`Weather for ${postal}`), {
      kind: "weather",
      location: postal,
    });
  }
  assert.equal(classifyFloV4SimpleIntent("What time is payday?"), null);
});

test("household date and time use only exact RLS-scoped saved timezone across DST and day boundaries", async () => {
  const client = settingsClient({
    data: { household_id: householdId, time_zone: "America/Los_Angeles" },
    error: null,
  });
  const date = await householdClockResult(
    client,
    householdId,
    "current_date",
    "2026-03-08T07:30:00.000Z",
  );
  assert.match(date.answer.answer, /Saturday, March 7, 2026/);
  const time = await householdClockResult(
    client,
    householdId,
    "current_time",
    "2026-03-08T10:30:00.000Z",
  );
  assert.match(time.answer.answer, /3:30 AM PDT.*Sunday, March 8, 2026/);
  assert.deepEqual(client.calls.slice(0, 3), [
    ["from", "household_settings"],
    ["select", "household_id,time_zone"],
    ["eq", "household_id", householdId],
  ]);
});

test("missing errored invalid or cross-household timezone fails closed", async () => {
  for (const result of [
    { data: null, error: null },
    { data: null, error: { message: "rls" } },
    { data: { household_id: householdId, time_zone: "bad/zone" }, error: null },
    { data: { household_id: "other", time_zone: "UTC" }, error: null },
  ]) {
    const answer = await householdClockResult(
      settingsClient(result),
      householdId,
      "current_date",
      "2026-10-14T12:00:00Z",
    );
    assert.equal(answer.aggregate.partial, true);
    assert.match(answer.answer.answer, /won’t guess/);
  }
});

test("weather requires explicit bounded location and server-only configured provider", async () => {
  assert.match(
    (await weatherResult(null, config, { now: "2026-10-14T15:10:00Z" })).answer
      .answer,
    /city and state or country/,
  );
  assert.match(
    (await weatherResult("Chicago", config, { now: "2026-10-14T15:10:00Z" }))
      .answer.answer,
    /provide a city and state/,
  );
  assert.match(
    (await weatherResult("Chicago, IL", null, { now: "2026-10-14T15:10:00Z" }))
      .answer.answer,
    /not configured/,
  );
  assert.match(
    (await weatherResult("SW1A 1AA", null, { now: "2026-10-14T15:10:00Z" }))
      .answer.answer,
    /not configured/,
  );
  for (const postal of ["90210", "90210-1234", "K1A 0B1", "SW1A 1AA"]) {
    assert.match(
      (await weatherResult(postal, null, { now: "2026-10-14T15:10:00Z" }))
        .answer.answer,
      /not configured/,
    );
  }
  for (const compound of ["90210 cash", "90210 bills"]) {
    assert.match(
      (await weatherResult(compound, config, { now: "2026-10-14T15:10:00Z" }))
        .answer.answer,
      /provide a city and state/,
    );
  }
  assert.equal(
    weatherProviderConfig(() => undefined),
    null,
  );
  assert.equal(
    weatherProviderConfig(
      (name) =>
        ({
          FLO_WEATHER_GEOCODE_URL: "http://free.example",
          FLO_WEATHER_CURRENT_URL:
            "https://customer-api.open-meteo.com/v1/forecast",
          FLO_WEATHER_API_KEY: "x",
        })[name],
    ),
    null,
  );
  assert.equal(
    weatherProviderConfig(
      (name) =>
        ({
          FLO_WEATHER_GEOCODE_URL:
            "https://user:pass@customer-geocoding-api.open-meteo.com/v1/search",
          FLO_WEATHER_CURRENT_URL:
            "https://customer-api.open-meteo.com/v1/forecast",
          FLO_WEATHER_API_KEY: "x",
        })[name],
    ),
    null,
  );
  for (const [geocodeUrl, currentUrl] of [
    [
      "https://localhost/v1/search",
      "https://customer-api.open-meteo.com/v1/forecast",
    ],
    [
      "https://169.254.169.254/v1/search",
      "https://customer-api.open-meteo.com/v1/forecast",
    ],
    [
      "https://customer-geocoding-api.open-meteo.com/v1/search",
      "https://127.0.0.1/v1/forecast",
    ],
    [
      "https://evil.open-meteo.com/v1/search",
      "https://customer-api.open-meteo.com/v1/forecast",
    ],
    [
      "https://customer-geocoding-api.open-meteo.com/v1/search",
      "https://api.open-meteo.com/v1/forecast",
    ],
    [
      "https://customer-api.open-meteo.com/v1/search",
      "https://customer-api.open-meteo.com/v1/forecast",
    ],
    [
      "https://geocoding-api.open-meteo.com/v1/search",
      "https://customer-api.open-meteo.com/v1/forecast",
    ],
  ]) {
    assert.equal(
      weatherProviderConfig(
        (name) =>
          ({
            FLO_WEATHER_GEOCODE_URL: geocodeUrl,
            FLO_WEATHER_CURRENT_URL: currentUrl,
            FLO_WEATHER_API_KEY: "x",
          })[name],
      ),
      null,
    );
  }
  assert.deepEqual(
    weatherProviderConfig(
      (name) =>
        ({
          FLO_WEATHER_GEOCODE_URL:
            "https://customer-geocoding-api.open-meteo.com/v1/search",
          FLO_WEATHER_CURRENT_URL:
            "https://customer-api.open-meteo.com/v1/forecast",
          FLO_WEATHER_API_KEY: "commercial-key",
        })[name],
    ),
    { ...config, apiKey: "commercial-key" },
  );
});

test("configured weather validates provider data and returns source freshness without identity headers", async () => {
  const calls = [];
  const fetcher = async (input, init) => {
    calls.push({ url: String(input), headers: init.headers });
    return successFetch()(input);
  };
  const result = await weatherResult("Chicago, IL", config, {
    fetcher,
    now: "2026-10-14T15:10:00Z",
  });
  assert.equal(result.aggregate.partial, false);
  assert.equal(result.usage.inputTokens, 0);
  assert.equal(result.model, null);
  assert.match(
    result.answer.answer,
    /Chicago, Illinois, United States.*72°F.*partly cloudy.*8 mph/,
  );
  assert.equal(result.sources[0].asOf, "2026-10-14T15:00:00.000Z");
  assert.equal(result.sources[0].freshness, "current");
  assert.equal(result.sources[0].label, "Open-Meteo current conditions");
  assert.deepEqual(
    calls.map((call) => call.headers),
    [{ Accept: "application/json" }, { Accept: "application/json" }],
  );
  assert.ok(
    calls.every(
      (call) =>
        !new URL(call.url).searchParams.has("user_id") &&
        !new URL(call.url).searchParams.has("household_id"),
    ),
  );
});

test("weather ambiguity missing timeout non-2xx malformed and stale responses stay bounded", async () => {
  let oversizedCancelled = false;
  const cases = [
    async () =>
      response({
        results: [
          {
            name: "Springfield",
            admin1: "Illinois",
            country: "US",
            latitude: 1,
            longitude: 1,
          },
          {
            name: "Springfield",
            admin1: "Missouri",
            country: "US",
            latitude: 2,
            longitude: 2,
          },
        ],
      }),
    async () => response({ results: [] }),
    async (_input, init) =>
      await new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      ),
    async () => new Response("no", { status: 503 }),
    async (input) =>
      new URL(input).pathname === "/v1/search"
        ? response({
            results: [
              { name: "Chicago", country: "US", latitude: "bad", longitude: 2 },
            ],
          })
        : response({}),
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(140_000));
          },
          cancel() {
            oversizedCancelled = true;
          },
        }),
        { status: 200 },
      ),
    successFetch("2026-10-14T10:00:00Z"),
  ];
  const patterns = [
    /ambiguous/,
    /couldn’t find/,
    /couldn’t retrieve/,
    /couldn’t retrieve/,
    /couldn’t verify/,
    /couldn’t retrieve/,
    /stale/,
  ];
  for (let index = 0; index < cases.length; index++) {
    const result = await weatherResult("Springfield, US", config, {
      fetcher: cases[index],
      now: "2026-10-14T15:10:00Z",
      timeoutMs: 100,
    });
    assert.equal(result.aggregate.partial, true);
    assert.match(result.answer.answer, patterns[index]);
  }
  assert.equal(oversizedCancelled, true);
});

test("weather rejects unsafe labels and treats duplicate labels at different coordinates as ambiguous", async () => {
  const malformedLabels = [
    {
      name: `City${"x".repeat(81)}`,
      country: "US",
      latitude: 1,
      longitude: 1,
    },
    { name: "Bad\nCity", country: "US", latitude: 1, longitude: 1 },
    { name: "City", country: "U\u0000S", latitude: 1, longitude: 1 },
    { name: "City\u202E", country: "US", latitude: 1, longitude: 1 },
  ];
  for (const row of malformedLabels) {
    const result = await weatherResult("City, US", config, {
      now: "2026-10-14T15:10:00Z",
      fetcher: async () => response({ results: [row] }),
    });
    assert.equal(result.aggregate.partial, true);
    assert.match(result.answer.answer, /couldn’t verify/);
  }

  const ambiguous = await weatherResult("Springfield, US", config, {
    now: "2026-10-14T15:10:00Z",
    fetcher: async () =>
      response({
        results: [
          { name: "Springfield", country: "US", latitude: 1, longitude: 1 },
          { name: "Springfield", country: "US", latitude: 2, longitude: 2 },
        ],
      }),
  });
  assert.equal(ambiguous.aggregate.partial, true);
  assert.match(ambiguous.answer.answer, /ambiguous/);
});

test("simple runner returns zero-token greeting without household or weather reads", async () => {
  const client = {
    from() {
      throw new Error("unexpected financial read");
    },
  };
  const result = await runFloV4SimpleIntent(
    { kind: "greeting" },
    { client, householdId, now: "2026-10-14T15:10:00Z", weatherConfig: null },
  );
  assert.equal(result.usage.inputTokens, 0);
  assert.equal(result.usage.outputTokens, 0);
  assert.equal(result.model, null);
  assert.match(result.answer.answer, /I’m Flo/);
});
