const baseUrl = "https://www.maviri.it/api/chat";
const levels = [50, 100, 200];
const runId = `load-${Date.now()}`;

async function runLevel(concurrency) {
  const tenantId = `${runId}-${concurrency}`;
  const results = await Promise.all(
    Array.from({ length: concurrency }, async (_, index) => {
      const startedAt = Date.now();
      try {
        const response = await fetch(baseUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": `198.51.100.${(index % 250) + 1}`
          },
          body: JSON.stringify({
            action: "public-context",
            mode: "client",
            tenantId
          })
        });
        await response.text();
        return { status: response.status, ms: Date.now() - startedAt };
      } catch (error) {
        return { status: 0, ms: Date.now() - startedAt, error: String(error) };
      }
    })
  );

  const times = results.map(item => item.ms).sort((a, b) => a - b);
  const statuses = Object.fromEntries(
    [...new Set(results.map(item => String(item.status)))].sort().map(
      status => [status, results.filter(item => String(item.status) === status).length]
    )
  );

  return {
    concurrency,
    accepted: results.filter(item => item.status > 0 && item.status !== 429).length,
    limited: results.filter(item => item.status === 429).length,
    transportErrors: results.filter(item => item.status === 0).length,
    statuses,
    medianMs: times[Math.floor(times.length / 2)],
    p95Ms: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)],
    maxMs: times[times.length - 1]
  };
}

const report = [];
for (const level of levels) {
  report.push(await runLevel(level));
  await new Promise(resolve => setTimeout(resolve, 1500));
}

console.log(JSON.stringify({ runId, report }, null, 2));
if (report.some(item => item.transportErrors > 0)) process.exitCode = 1;
