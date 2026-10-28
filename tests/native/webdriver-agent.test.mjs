import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import { WebDriverAgent } from "./webdriver-agent.mjs";

test("a stalled WebDriver request is aborted instead of keeping the suite alive", async () => {
  const server = createServer(() => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const agent = new WebDriverAgent(100);
  try {
    await assert.rejects(
      new Promise((resolve, reject) => {
        const request = get(
          `http://127.0.0.1:${server.address().port}`,
          { agent },
          resolve,
        );
        request.on("error", reject);
      }),
      /WebDriver GET \/ timed out after 100ms/,
    );
  } finally {
    agent.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});
