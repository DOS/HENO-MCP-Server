// Automated test suite for Tingee MCP Server
const assert = require("node:assert");
const { evaluateResetEligibility, handleToolCall } = require("./server.js");

async function runTests() {
  console.log("Running Tingee MCP Server tests...");

  // Test 1: evaluateResetEligibility with null/missing expiry
  {
    const res = evaluateResetEligibility(null);
    assert.strictEqual(res.allowed, false);
    assert(res.reason.includes("Không xác định được hạn sử dụng"));
    console.log("✓ Test 1 passed: null data rejected");
  }

  // Test 2: evaluateResetEligibility with invalid date
  {
    const res = evaluateResetEligibility({ expiresAt: "invalid-date" });
    assert.strictEqual(res.allowed, false);
    assert(res.reason.includes("không hợp lệ"));
    console.log("✓ Test 2 passed: invalid date rejected");
  }

  // Test 3: evaluateResetEligibility with < 11 months remaining (e.g. 5 months remaining)
  {
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 5);
    const res = evaluateResetEligibility({ expiresAt: futureDate.toISOString() });
    assert.strictEqual(res.allowed, false);
    assert(res.reason.includes("Loa này không đủ điều kiện reset"));
    assert(res.reason.includes("còn dưới 11 tháng"));
    console.log("✓ Test 3 passed: expiry < 11 months rejected with polite Vietnamese reason");
  }

  // Test 4: evaluateResetEligibility with >= 11 months remaining (e.g. 11.5 months or 12 months remaining)
  {
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 11);
    futureDate.setDate(futureDate.getDate() + 15); // +11.5 months
    const res = evaluateResetEligibility({ expiresAt: futureDate.toISOString() });
    assert.strictEqual(res.allowed, true);
    console.log("✓ Test 4 passed: expiry >= 11 months allowed");
  }

  // Test 5: tool call invalid tool
  {
    const res = await handleToolCall("non_existent_tool", {});
    assert.strictEqual(res.isError, true);
    assert(res.text.includes("Tool không tồn tại"));
    console.log("✓ Test 5 passed: non existent tool handled");
  }

  // Test 6: reset_device with missing uuid
  {
    const res = await handleToolCall("reset_device", {});
    assert.strictEqual(res.isError, true);
    assert(res.text.includes("Vui lòng cung cấp mã serial loa"));
    console.log("✓ Test 6 passed: missing serial handled");
  }

  console.log("\nAll 6 tests PASSED cleanly!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
