const assert = require("node:assert/strict");
const test = require("node:test");

const feedback = require("./feedback");

function invoke(request) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, payload });
      },
    };
    Promise.resolve(feedback(request, response)).catch(reject);
  });
}

test("feedback management accepts only POST", async () => {
  const response = await invoke({ method: "GET", headers: {} });
  assert.equal(response.status, 405);
  assert.equal(response.payload.error, "METHOD_NOT_ALLOWED");
});

test("feedback management requires an authenticated admin", async () => {
  const response = await invoke({ method: "POST", headers: {}, body: {} });
  assert.equal(response.status, 401);
  assert.equal(response.payload.error, "AUTH_HEADER_MISSING");
});
