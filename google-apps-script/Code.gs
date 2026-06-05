const SHEET_NAME = "Orders";
const SPREADSHEET_ID = "PASTE_SPREADSHEET_ID_HERE";
const HEADER = [
  "注文番号",
  "編集トークン",
  "名前",
  "学年",
  "商品名",
  "個数",
  "合計金額",
  "注文時刻",
  "更新時刻",
  "ステータス",
  "注文JSON"
];

const ADMIN_PASSWORD_HASH = "PASTE_SHA256_HASH_HERE";
const PRODUCT_CATALOG = {
  croffle_sugar: { name: "シュガーバタークロッフル", price: 400 },
  croffle_choco: { name: "チョコクロッフル", price: 450 },
  croffle_berry: { name: "ベリークリームクロッフル", price: 500 }
};

const STATUS = {
  RECEIVED: "受付中",
  COOKING: "調理中",
  READY: "完成",
  PICKED_UP: "受取済み",
  CANCELED: "キャンセル"
};

const EDITABLE_STATUSES = [STATUS.RECEIVED, STATUS.COOKING, STATUS.READY];
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 6;
const SCRIPT_PROPERTY_LAST_NUMBER = "LAST_ORDER_NUMBER";

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  var request = {};

  try {
    request = normalizeRequest_(e);
    ensureSheet_();
    const action = String(request.action || "").trim();
    let result;

    switch (action) {
      case "createOrder":
        result = createOrder_(request);
        break;
      case "getOrder":
        result = getOrder_(request);
        break;
      case "updateOrder":
        result = updateOrder_(request);
        break;
      case "cancelOrder":
        result = cancelOrder_(request);
        break;
      case "adminLogin":
        result = adminLogin_(request);
        break;
      case "adminList":
        result = adminList_(request);
        break;
      case "adminUpdateStatus":
        result = adminUpdateStatus_(request);
        break;
      case "displayList":
        result = displayList_();
        break;
      default:
        result = {
          ok: true,
          message: "Festival order API is running.",
          updatedAt: new Date().toISOString()
        };
    }

    return buildResponse_(result, request.callback);
  } catch (error) {
    return buildResponse_(
      {
        ok: false,
        error: error.message || "Unexpected error",
        code: error.code || "ERROR",
        updatedAt: new Date().toISOString()
      },
      request.callback
    );
  }
}

function normalizeRequest_(e) {
  const params = Object.assign({}, (e && e.parameter) || {});

  if (e && e.postData && e.postData.contents && /^application\/json/i.test(e.postData.type || "")) {
    const body = JSON.parse(e.postData.contents);
    Object.keys(body).forEach(function (key) {
      if (params[key] === undefined || params[key] === "") {
        params[key] = body[key];
      }
    });
  }

  return params;
}

function createOrder_(request) {
  const payload = validateOrderPayload_(decodePayload_(requireParam_(request, "payload")));
  const sheet = getSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const orderNumber = nextOrderNumber_();
    const editToken = generateEditToken_();
    const now = new Date().toISOString();
    const row = buildRowRecord_(orderNumber, editToken, payload, now, now, STATUS.RECEIVED);
    sheet.appendRow(row);

    return {
      ok: true,
      orderNumber: orderNumber,
      editToken: editToken,
      status: STATUS.RECEIVED,
      totalAmount: payload.totalAmount,
      updatedAt: now
    };
  } finally {
    lock.releaseLock();
  }
}

function getOrder_(request) {
  const token = requireParam_(request, "token");
  const match = findRowByToken_(token);

  if (!match) {
    throw createError_("指定された注文が見つかりません。", "NOT_FOUND");
  }

  return {
    ok: true,
    order: rowToOrder_(match.values, match.row)
  };
}

function updateOrder_(request) {
  const token = requireParam_(request, "token");
  const payload = validateOrderPayload_(decodePayload_(requireParam_(request, "payload")));
  const match = findRowByToken_(token);

  if (!match) {
    throw createError_("指定された注文が見つかりません。", "NOT_FOUND");
  }

  const order = rowToOrder_(match.values, match.row);
  if (!order.editable) {
    throw createError_("この注文は変更できません。", "LOCKED");
  }

  const now = new Date().toISOString();
  const updatedRow = buildRowRecord_(
    order.orderNumber,
    token,
    payload,
    order.orderedAt,
    now,
    STATUS.RECEIVED
  );
  getSheet_().getRange(match.row, 1, 1, updatedRow.length).setValues([updatedRow]);

  return {
    ok: true,
    order: rowToOrder_(updatedRow, match.row)
  };
}

function cancelOrder_(request) {
  const token = requireParam_(request, "token");
  const match = findRowByToken_(token);

  if (!match) {
    throw createError_("指定された注文が見つかりません。", "NOT_FOUND");
  }

  const order = rowToOrder_(match.values, match.row);
  if (!order.editable) {
    throw createError_("この注文はキャンセルできません。", "LOCKED");
  }

  const row = match.values.slice();
  row[8] = new Date().toISOString();
  row[9] = STATUS.CANCELED;
  getSheet_().getRange(match.row, 1, 1, row.length).setValues([row]);

  return {
    ok: true,
    order: rowToOrder_(row, match.row)
  };
}

function adminLogin_(request) {
  const passwordHash = String(requireParam_(request, "passwordHash")).toLowerCase();
  if (ADMIN_PASSWORD_HASH === "PASTE_SHA256_HASH_HERE") {
    throw createError_("Apps Script の `ADMIN_PASSWORD_HASH` を設定してください。", "CONFIG");
  }

  if (passwordHash !== String(ADMIN_PASSWORD_HASH).toLowerCase()) {
    throw createError_("管理パスワードが正しくありません。", "UNAUTHORIZED");
  }

  const sessionToken = generateEditToken_();
  CacheService.getScriptCache().put(sessionToken, "1", ADMIN_SESSION_TTL_SECONDS);

  return {
    ok: true,
    sessionToken: sessionToken,
    expiresInSeconds: ADMIN_SESSION_TTL_SECONDS
  };
}

function adminList_(request) {
  requireAdminSession_(request);

  const rows = getSheet_().getDataRange().getValues().slice(1);
  const orders = rows
    .map(function (row, index) {
      return rowToOrder_(row, index + 2);
    })
    .sort(function (a, b) {
      return orderNumberToInt_(b.orderNumber) - orderNumberToInt_(a.orderNumber);
    });

  return {
    ok: true,
    orders: orders,
    stats: buildStats_(orders),
    updatedAt: new Date().toISOString()
  };
}

function adminUpdateStatus_(request) {
  requireAdminSession_(request);

  const orderNumber = requireParam_(request, "orderNumber");
  const status = requireParam_(request, "status");
  if (Object.values(STATUS).indexOf(status) === -1) {
    throw createError_("不正なステータスです。", "INVALID_STATUS");
  }

  const match = findRowByOrderNumber_(orderNumber);
  if (!match) {
    throw createError_("注文番号が見つかりません。", "NOT_FOUND");
  }

  const row = match.values.slice();
  row[8] = new Date().toISOString();
  row[9] = status;
  getSheet_().getRange(match.row, 1, 1, row.length).setValues([row]);

  return {
    ok: true,
    order: rowToOrder_(row, match.row),
    updatedAt: row[8]
  };
}

function displayList_() {
  const rows = getSheet_().getDataRange().getValues().slice(1);
  const orders = rows
    .map(function (row, index) {
      return rowToOrder_(row, index + 2);
    })
    .filter(function (order) {
      return order.status === STATUS.READY;
    })
    .sort(function (a, b) {
      return orderNumberToInt_(a.orderNumber) - orderNumberToInt_(b.orderNumber);
    })
    .map(function (order) {
      return {
        orderNumber: order.orderNumber
      };
    });

  return {
    ok: true,
    orders: orders,
    updatedAt: new Date().toISOString()
  };
}

function buildRowRecord_(orderNumber, editToken, payload, orderedAt, updatedAt, status) {
  const itemsSummary = payload.items
    .map(function (item) {
      return item.name + " × " + item.qty;
    })
    .join(" / ");
  const qtySummary = payload.items
    .map(function (item) {
      return String(item.qty);
    })
    .join(" / ");

  return [
    orderNumber,
    editToken,
    payload.name,
    payload.grade,
    itemsSummary,
    qtySummary,
    payload.totalAmount,
    orderedAt,
    updatedAt,
    status,
    JSON.stringify(payload.items)
  ];
}

function rowToOrder_(row) {
  const items = parseItemsJson_(row[10]);
  const order = {
    orderNumber: String(row[0] || ""),
    name: String(row[2] || ""),
    grade: String(row[3] || ""),
    items: items,
    totalAmount: Number(row[6] || 0),
    orderedAt: row[7],
    updatedAt: row[8],
    status: String(row[9] || STATUS.RECEIVED)
  };
  order.editable = EDITABLE_STATUSES.indexOf(order.status) !== -1;
  return order;
}

function parseItemsJson_(itemsJson) {
  if (!itemsJson) {
    return [];
  }

  try {
    return JSON.parse(itemsJson);
  } catch (error) {
    return [];
  }
}

function validateOrderPayload_(payload) {
  const name = String((payload && payload.name) || "").trim();
  const grade = String((payload && payload.grade) || "").trim();
  const inputItems = (payload && payload.items) || [];

  if (!name) {
    throw createError_("名前を入力してください。", "INVALID_NAME");
  }
  if (name.length > 40) {
    throw createError_("名前は40文字以内で入力してください。", "INVALID_NAME");
  }
  if (grade.length > 20) {
    throw createError_("学年は20文字以内で入力してください。", "INVALID_GRADE");
  }
  if (!Array.isArray(inputItems) || !inputItems.length) {
    throw createError_("1つ以上の商品を選んでください。", "INVALID_ITEMS");
  }

  const quantityById = inputItems.reduce(function (result, item) {
    const id = String(item.id || "");
    const qty = Number(item.qty || 0);

    if (!PRODUCT_CATALOG[id]) {
      throw createError_("不正な商品が含まれています。", "INVALID_PRODUCT");
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
      throw createError_("数量は1〜20の整数で指定してください。", "INVALID_QUANTITY");
    }

    result[id] = (result[id] || 0) + qty;
    return result;
  }, {});

  let totalAmount = 0;
  let totalCount = 0;
  const items = Object.keys(quantityById).map(function (id) {
    const catalog = PRODUCT_CATALOG[id];
    const qty = quantityById[id];

    if (qty > 20) {
      throw createError_("同じ商品の数量は20個までです。", "INVALID_QUANTITY");
    }

    const normalizedItem = {
      id: id,
      name: catalog.name,
      price: catalog.price,
      qty: qty,
      subtotal: catalog.price * qty
    };
    totalAmount += normalizedItem.subtotal;
    totalCount += qty;
    return normalizedItem;
  });

  if (totalCount > 50) {
    throw createError_("一度に注文できる数は50個までです。", "TOO_MANY_ITEMS");
  }

  return {
    name: name,
    grade: grade,
    items: items,
    totalAmount: totalAmount
  };
}

function decodePayload_(payloadBase64) {
  try {
    const bytes = Utilities.base64DecodeWebSafe(payloadBase64);
    const json = Utilities.newBlob(bytes).getDataAsString("UTF-8");
    return JSON.parse(json);
  } catch (error) {
    throw createError_("注文データを読み取れませんでした。", "INVALID_PAYLOAD");
  }
}

function findRowByToken_(token) {
  const rows = getSheet_().getDataRange().getValues();
  for (var rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    if (String(rows[rowIndex][1]) === token) {
      return {
        row: rowIndex + 1,
        values: rows[rowIndex]
      };
    }
  }
  return null;
}

function findRowByOrderNumber_(orderNumber) {
  const rows = getSheet_().getDataRange().getValues();
  for (var rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    if (String(rows[rowIndex][0]) === orderNumber) {
      return {
        row: rowIndex + 1,
        values: rows[rowIndex]
      };
    }
  }
  return null;
}

function nextOrderNumber_() {
  const properties = PropertiesService.getScriptProperties();
  const lockValue = Number(properties.getProperty(SCRIPT_PROPERTY_LAST_NUMBER) || 0);
  let nextValue = lockValue;

  if (!nextValue) {
    const rows = getSheet_().getDataRange().getValues().slice(1);
    nextValue = rows.reduce(function (maxValue, row) {
      return Math.max(maxValue, orderNumberToInt_(row[0]));
    }, 100);
  }

  nextValue += 1;
  properties.setProperty(SCRIPT_PROPERTY_LAST_NUMBER, String(nextValue));
  return "#" + nextValue;
}

function orderNumberToInt_(value) {
  return Number(String(value || "").replace(/[^\d]/g, "")) || 0;
}

function buildStats_(orders) {
  return orders.reduce(
    function (stats, order) {
      stats.total += 1;
      stats[order.status] = (stats[order.status] || 0) + 1;
      return stats;
    },
    { total: 0, "受付中": 0, "調理中": 0, "完成": 0, "受取済み": 0, "キャンセル": 0 }
  );
}

function requireAdminSession_(request) {
  const sessionToken = requireParam_(request, "sessionToken");
  const session = CacheService.getScriptCache().get(sessionToken);
  if (!session) {
    throw createError_("セッションの有効期限が切れました。再ログインしてください。", "UNAUTHORIZED");
  }
  return sessionToken;
}

function ensureSheet_() {
  const spreadsheet = getSpreadsheet_();
  if (!spreadsheet) {
    throw createError_("スプレッドシートに接続できません。紐づけ型で実行するか、SPREADSHEET_ID を設定してください。", "NO_SPREADSHEET");
  }

  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    sheet.setFrozenRows(1);
  } else {
    const firstRow = sheet.getRange(1, 1, 1, HEADER.length).getValues()[0];
    if (String(firstRow[0]) !== HEADER[0]) {
      sheet.insertRows(1, 1);
      sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
      sheet.setFrozenRows(1);
    }
  }
}

function getSheet_() {
  return getSpreadsheet_().getSheetByName(SHEET_NAME);
}

function getSpreadsheet_() {
  if (SPREADSHEET_ID && SPREADSHEET_ID !== "PASTE_SPREADSHEET_ID_HERE") {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }

  return SpreadsheetApp.getActiveSpreadsheet();
}

function buildResponse_(payload, callback) {
  const json = JSON.stringify(payload);
  if (callback) {
    if (!/^[a-zA-Z0-9_$.]+$/.test(callback)) {
      throw createError_("コールバック名が不正です。", "INVALID_CALLBACK");
    }
    return ContentService.createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function generateEditToken_() {
  return [
    Utilities.getUuid().replace(/-/g, ""),
    Utilities.getUuid().replace(/-/g, "")
  ].join("");
}

function requireParam_(request, key) {
  const value = request[key];
  if (value === undefined || value === null || value === "") {
    throw createError_(key + " が指定されていません。", "MISSING_PARAM");
  }
  return value;
}

function createError_(message, code) {
  const error = new Error(message);
  error.code = code || "ERROR";
  return error;
}
