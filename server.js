// Tingee MCP Server - Ready-to-deploy for Heno / Tingee on-premise infrastructure.
//
// Protocol: Model Context Protocol (MCP) over Streamable HTTP (JSON-RPC 2.0).
// Compatible with DOS.AI Gateway Custom MCP Registry & OpenClaw Agent Runtime.
//
// Tools exposed:
// 1. get_speaker_status: Look up speaker subscription expiry and linkage status.
// 2. reset_device: Reset Tingee speaker (with automatic 11-month subscription expiry gate).
//
// Zero external npm dependencies - uses native Node.js (v18+).

const http = require("node:http");
const crypto = require("node:crypto");

const PORT = parseInt(process.env.PORT || "18070", 10);
const BEARER_TOKEN = (process.env.MCP_BEARER_TOKEN || "").trim();

const TINGEE_API_KEY = (process.env.TINGEE_API_KEY || "").trim();
const TINGEE_RESET_URL = (
  process.env.TINGEE_RESET_URL || "https://open-api.tingee.vn/v1/device/reset-device"
).trim();

const TINGEE_SPEAKER_API_KEY = (process.env.TINGEE_SPEAKER_API_KEY || "").trim();
const TINGEE_SPEAKER_STATUS_URL = (
  process.env.TINGEE_SPEAKER_STATUS_URL || "https://open-api.tingee.vn/v1/partner/speakers/status"
).trim();

const MIN_REMAINING_MONTHS = parseInt(process.env.MIN_REMAINING_MONTHS || "11", 10);

const JSONRPC_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function jsonRpcResult(id, result) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function jsonRpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

// Check if string matches bearer token in constant time.
function isValidBearer(authHeader) {
  if (!BEARER_TOKEN) {
    // If no bearer token configured, allow (dev mode warning logged on boot)
    return true;
  }
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const token = authHeader.slice(7).trim();
  if (token.length !== BEARER_TOKEN.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(BEARER_TOKEN));
}

// Fetch speaker status from Tingee partner API.
async function fetchSpeakerStatus(deviceCode) {
  if (!TINGEE_SPEAKER_STATUS_URL || !TINGEE_SPEAKER_API_KEY) {
    return {
      configured: false,
      error: "Tingee speaker status lookup is not configured on this server.",
    };
  }

  const u = new URL(TINGEE_SPEAKER_STATUS_URL);
  u.searchParams.set("deviceCode", deviceCode);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(u.toString(), {
      method: "GET",
      headers: {
        "x-speaker-api-key": TINGEE_SPEAKER_API_KEY,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (res.status === 404) {
      return { found: false, error: "SPEAKER_NOT_FOUND" };
    }

    if (!res.ok) {
      return {
        found: false,
        error: `Tingee speaker status API returned HTTP ${res.status}`,
      };
    }

    const json = await res.json();
    return {
      configured: true,
      found: true,
      data: json.data || json,
    };
  } catch (err) {
    return {
      found: false,
      error: `Call to Tingee speaker status failed: ${err.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Evaluate reset eligibility based on remaining subscription.
// Business rule: Speaker linked > 30 days must NOT be reset.
// Since subscription is 12 months, linked > 30 days means remaining < 11 months.
function evaluateResetEligibility(speakerData) {
  if (!speakerData || !speakerData.expiresAt) {
    return {
      allowed: false,
      reason:
        "Không xác định được hạn sử dụng của loa này nên chưa thể xác nhận loa đủ điều kiện reset (chỉ loa liên kết dưới 30 ngày mới được reset).",
    };
  }

  const expiresAt = new Date(speakerData.expiresAt);
  if (isNaN(expiresAt.getTime())) {
    return {
      allowed: false,
      reason:
        "Dữ liệu ngày hết hạn của loa không hợp lệ, không thể xác nhận điều kiện reset.",
    };
  }

  // Calculate threshold: now + MIN_REMAINING_MONTHS
  const now = new Date();
  const threshold = new Date(now.getTime());
  threshold.setMonth(threshold.getMonth() + MIN_REMAINING_MONTHS);

  if (expiresAt < threshold) {
    const day = String(expiresAt.getDate()).padStart(2, "0");
    const month = String(expiresAt.getMonth() + 1).padStart(2, "0");
    const year = expiresAt.getFullYear();
    const formattedDate = `${day}/${month}/${year}`;

    return {
      allowed: false,
      reason: `Loa này không đủ điều kiện reset: hạn sử dụng đến ${formattedDate}, còn dưới ${MIN_REMAINING_MONTHS} tháng, nghĩa là loa đã được liên kết quá 30 ngày. Theo quy định chỉ loa liên kết dưới 30 ngày mới được reset.`,
    };
  }

  return { allowed: true };
}

// Call Tingee Reset API
async function callTingeeReset(uuid, phoneNumber, accountNumber, isBankRequest) {
  if (!TINGEE_RESET_URL || !TINGEE_API_KEY) {
    return {
      success: false,
      error: "Tingee reset API endpoint or x-api-key is not configured on this server.",
    };
  }

  let payload;
  if (isBankRequest || (!phoneNumber && !accountNumber)) {
    payload = { uuid, isBankRequest: true };
  } else {
    payload = {
      uuid,
      phoneNumber: String(phoneNumber || "").trim(),
      accountNumber: String(accountNumber || "").trim(),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(TINGEE_RESET_URL, {
      method: "POST",
      headers: {
        "x-api-key": TINGEE_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let resJson;
    try {
      resJson = await res.json();
    } catch {
      resJson = { rawStatus: res.status };
    }

    return {
      success: res.ok,
      statusCode: res.status,
      data: resJson,
    };
  } catch (err) {
    return {
      success: false,
      error: `Call to Tingee reset API failed: ${err.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Tool definitions for MCP
const TOOLS = [
  {
    name: "get_speaker_status",
    description:
      "Tra cứu thông tin trạng thái hoạt động và hạn sử dụng gói thuê bao của loa Tingee theo mã thiết bị (serial loa SGA...). Dùng để kiểm tra điều kiện bảo hành hoặc reset.",
    inputSchema: {
      type: "object",
      properties: {
        device_code: {
          type: "string",
          description: "Mã serial của loa Tingee (ví dụ: SGA0210099).",
        },
      },
      required: ["device_code"],
    },
  },
  {
    name: "reset_device",
    description:
      "Thực hiện reset loa Tingee về trạng thái ban đầu để liên kết lại. Tự động kiểm tra điều kiện quy định: chỉ loa được liên kết dưới 30 ngày (còn hạn sử dụng từ 11 tháng trở lên) mới được phép reset.",
    inputSchema: {
      type: "object",
      properties: {
        uuid: {
          type: "string",
          description: "Mã serial của thiết bị loa cần reset (ví dụ: SGA0210099).",
        },
        phone_number: {
          type: "string",
          description: "Số điện thoại của khách hàng đã đăng ký loa.",
        },
        account_number: {
          type: "string",
          description: "Số tài khoản ngân hàng liên kết với loa.",
        },
        is_bank_request: {
          type: "boolean",
          description: "Đặt true nếu đây là yêu cầu trực tiếp từ ngân hàng/nhân viên kỹ thuật (chỉ cần serial loa).",
        },
      },
      required: ["uuid"],
    },
  },
];

async function handleToolCall(name, args) {
  if (name === "get_speaker_status") {
    const deviceCode = String(args?.device_code || "").trim();
    if (!deviceCode) {
      return { isError: true, text: "Vui lòng cung cấp mã serial của loa (device_code)." };
    }

    const status = await fetchSpeakerStatus(deviceCode);
    if (!status.found) {
      if (status.error === "SPEAKER_NOT_FOUND") {
        return {
          isError: false,
          text: `Không tìm thấy thông tin thiết bị loa với mã serial ${deviceCode}. Vui lòng kiểm tra lại mã serial.`,
        };
      }
      return { isError: true, text: `Lỗi tra cứu thông tin loa: ${status.error}` };
    }

    const data = status.data;
    const expiresAt = data.expiresAt ? new Date(data.expiresAt).toLocaleDateString("vi-VN") : "Không xác định";
    const decision = evaluateResetEligibility(data);

    let summary = `Thông tin loa ${deviceCode}:\n`;
    summary += `- Hạn sử dụng: ${expiresAt}\n`;
    summary += `- Trạng thái hết hạn: ${data.expired ? "Đã hết hạn" : "Còn hạn"}\n`;
    if (data.daysRemaining !== undefined && data.daysRemaining !== null) {
      summary += `- Số ngày còn lại: ${data.daysRemaining} ngày\n`;
    }
    summary += `- Điều kiện reset (quy định 30 ngày): ${decision.allowed ? "ĐỦ ĐIỀU KIỆN RESET" : "KHÔNG ĐỦ ĐIỀU KIỆN"}\n`;
    if (!decision.allowed) {
      summary += `- Lý do: ${decision.reason}`;
    }

    return { isError: false, text: summary };
  }

  if (name === "reset_device") {
    const uuid = String(args?.uuid || "").trim();
    const phoneNumber = args?.phone_number;
    const accountNumber = args?.account_number;
    const isBankRequest = Boolean(args?.is_bank_request);

    if (!uuid) {
      return { isError: true, text: "Vui lòng cung cấp mã serial loa (uuid)." };
    }

    // Step 1: Gate check if speaker status API is configured
    if (TINGEE_SPEAKER_STATUS_URL && TINGEE_SPEAKER_API_KEY) {
      const statusRes = await fetchSpeakerStatus(uuid);
      if (!statusRes.found) {
        if (statusRes.error === "SPEAKER_NOT_FOUND") {
          return {
            isError: true,
            text: `Không thể reset: Không tìm thấy loa với mã serial ${uuid} trên hệ thống Tingee. Vui lòng kiểm tra lại mã serial.`,
          };
        }
        return {
          isError: true,
          text: `Không thể kiểm tra điều kiện reset do lỗi hệ thống tra cứu: ${statusRes.error}. Để đảm bảo an toàn, yêu cầu reset tạm dừng.`,
        };
      }

      const decision = evaluateResetEligibility(statusRes.data);
      if (!decision.allowed) {
        return {
          isError: false,
          text: decision.reason,
        };
      }
    }

    // Step 2: Gate passed -> execute reset call to Tingee
    const resetRes = await callTingeeReset(uuid, phoneNumber, accountNumber, isBankRequest);
    if (!resetRes.success) {
      const errMsg = resetRes.data?.message || resetRes.error || `HTTP ${resetRes.statusCode}`;
      return {
        isError: true,
        text: `Reset thiết bị ${uuid} thất bại từ phía Tingee: ${errMsg}`,
      };
    }

    const message = resetRes.data?.message || "Thiết bị đã được reset thành công.";
    return {
      isError: false,
      text: `Reset loa ${uuid} thành công: ${message}`,
    };
  }

  return { isError: true, text: `Tool không tồn tại: ${name}` };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoint
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    res.writeHead(200, JSONRPC_HEADERS);
    res.end(
      JSON.stringify({
        ok: true,
        service: "tingee-mcp-server",
        tools: TOOLS.map((t) => t.name),
        statusConfigured: Boolean(TINGEE_SPEAKER_STATUS_URL && TINGEE_SPEAKER_API_KEY),
        resetConfigured: Boolean(TINGEE_RESET_URL && TINGEE_API_KEY),
      })
    );
    return;
  }

  // MCP streamable-http endpoint (POST /mcp or POST /)
  if (req.method === "POST" && (url.pathname === "/mcp" || url.pathname === "/")) {
    // Validate Bearer auth
    const authHeader = req.headers["authorization"] || "";
    if (!isValidBearer(authHeader)) {
      res.writeHead(401, JSONRPC_HEADERS);
      res.end(JSON.stringify({ error: "Unauthorized: Invalid or missing Bearer token" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
      }
    });

    req.on("end", async () => {
      let rpc;
      try {
        rpc = JSON.parse(body);
      } catch {
        res.writeHead(400, JSONRPC_HEADERS);
        res.end(jsonRpcError(null, -32700, "Parse error: Invalid JSON"));
        return;
      }

      const id = rpc.id ?? null;

      // Notifications carry no id and expect no response body
      if (id === null || id === undefined) {
        res.writeHead(202);
        res.end();
        return;
      }

      switch (rpc.method) {
        case "initialize":
          res.writeHead(200, JSONRPC_HEADERS);
          res.end(
            jsonRpcResult(id, {
              protocolVersion: rpc.params?.protocolVersion || "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "tingee-mcp-server", version: "1.0.0" },
            })
          );
          return;

        case "tools/list":
          res.writeHead(200, JSONRPC_HEADERS);
          res.end(jsonRpcResult(id, { tools: TOOLS }));
          return;

        case "tools/call": {
          const toolName = rpc.params?.name;
          const toolArgs = rpc.params?.arguments || {};
          const result = await handleToolCall(toolName, toolArgs);

          res.writeHead(200, JSONRPC_HEADERS);
          res.end(
            jsonRpcResult(id, {
              content: [
                {
                  type: "text",
                  text: result.text,
                },
              ],
              isError: result.isError,
            })
          );
          return;
        }

        default:
          res.writeHead(200, JSONRPC_HEADERS);
          res.end(jsonRpcError(id, -32601, `Method not found: ${rpc.method}`));
          return;
      }
    });
    return;
  }

  // Not found
  res.writeHead(404, JSONRPC_HEADERS);
  res.end(JSON.stringify({ error: "Not found" }));
});

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[tingee-mcp] Server running on http://0.0.0.0:${PORT}`);
    console.log(`[tingee-mcp] Health check: http://localhost:${PORT}/health`);
    console.log(`[tingee-mcp] MCP endpoint: http://localhost:${PORT}/mcp`);
    if (!BEARER_TOKEN) {
      console.warn("[tingee-mcp] WARN: MCP_BEARER_TOKEN is not set! Running in insecure mode.");
    }
  });
}

module.exports = {
  server,
  evaluateResetEligibility,
  fetchSpeakerStatus,
  callTingeeReset,
  handleToolCall,
};
