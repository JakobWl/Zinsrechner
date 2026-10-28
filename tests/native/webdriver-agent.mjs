import { Agent } from "node:http";

// Selenium's script/page timeouts do not bound an unresponsive HTTP transport.
export class WebDriverAgent extends Agent {
  constructor(timeoutMs = 45000) {
    super({ keepAlive: false });
    this.timeoutMs = timeoutMs;
  }

  addRequest(request, options) {
    request.setTimeout(this.timeoutMs, () => {
      request.destroy(
        new Error(
          `WebDriver ${request.method} ${request.path} timed out after ${this.timeoutMs}ms`,
        ),
      );
    });
    super.addRequest(request, options);
  }
}
