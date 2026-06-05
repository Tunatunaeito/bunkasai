const SPREADSHEET_ID = "1TlQDRejU8clGrLVQbPl6rHaTNsfrcmIur4rtvKNyT8Q";
const ADMIN_PASSWORD_HASH = "615ed7fb1504b0c724a296d7a69e6c7b2f9ea2c57c1d8206c5afdf392ebdfd25";
const PUBLIC_SITE_URL = "https://tunatunaeito.github.io/bunkasai/";
const NOTIFICATION_EMAIL = "tunaeito@gmail.com";

const SHEETS = {
  settings: "Settings",
  products: "Products",
  timeSlots: "TimeSlots",
  orders: "Orders"
};

const ORDER_HEADER = [
  "注文番号",
  "参照トークン",
  "名前",
  "学年",
  "受取枠ID",
  "受取枠ラベル",
  "受取開始",
  "受取終了",
  "商品一覧",
  "個数一覧",
  "商品総数",
  "合計金額",
  "注文時刻",
  "更新時刻",
  "ステータス",
  "決済時刻",
  "完成時刻",
  "受取時刻",
  "キャンセル時刻",
  "注文JSON"
];

const SETTINGS_HEADER = ["key", "value", "note"];
const PRODUCTS_HEADER = ["active", "productId", "name", "description", "price", "imageUrl", "sortOrder"];
const TIME_SLOTS_HEADER = ["active", "slotId", "label", "startTime", "endTime", "capacity", "sortOrder"];

const STATUS = {
  PAYMENT_PENDING: "決済待ち",
  COOKING_WAIT: "調理待ち",
  READY: "完成",
  PICKED_UP: "受取済",
  CANCELED: "キャンセル"
};

const PAID_STATUSES = [STATUS.COOKING_WAIT, STATUS.READY, STATUS.PICKED_UP];
const ACTIVE_SLOT_STATUSES = [STATUS.PAYMENT_PENDING, STATUS.COOKING_WAIT, STATUS.READY, STATUS.PICKED_UP];
const QUEUE_STATUSES = [STATUS.PAYMENT_PENDING, STATUS.COOKING_WAIT];
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 8;
const LAST_ORDER_NUMBER_KEY = "LAST_ORDER_NUMBER";

const DEFAULT_PRODUCTS = [
  {
    active: true,
    productId: "croffle_sugar",
    name: "シュガーバタークロッフル",
    description: "バターの香りとやさしい甘さが人気の定番クロッフルです。",
    price: 400,
    imageUrl: "https://tunatunaeito.github.io/bunkasai/assets/product-croffle-sugar.svg",
    sortOrder: 1
  },
  {
    active: true,
    productId: "croffle_choco",
    name: "チョコクロッフル",
    description: "サクッとした生地にチョコソースを重ねた写真映えメニューです。",
    price: 450,
    imageUrl: "https://tunatunaeito.github.io/bunkasai/assets/product-croffle-choco.svg",
    sortOrder: 2
  },
  {
    active: true,
    productId: "croffle_berry",
    name: "いちごベリークロッフル",
    description: "甘酸っぱいベリーソースとクリームで仕上げた華やかな一品です。",
    price: 500,
    imageUrl: "https://tunatunaeito.github.io/bunkasai/assets/product-croffle-berry.svg",
    sortOrder: 3
  }
];

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("文化祭クロッフル")
    .addItem("初期セットアップ", "setupFestivalSheets")
    .addItem("時間枠を再生成", "refreshTimeSlotsFromSettings")
    .addToUi();
}

function setupFestivalSheets() {
  ensureFestivalSheets_();
  refreshTimeSlotsFromSettings();
  SpreadsheetApp.getUi().alert("シートの初期設定が完了しました。");
}

function refreshTimeSlotsFromSettings() {
  ensureFestivalSheets_();

  const settings = getSettingsMap_();
  const rows = generateTimeSlotRowsFromSettings_(settings);
  const sheet = getTimeSlotsSheet_();
  const maxRows = Math.max(sheet.getLastRow() - 1, 0);

  if (maxRows > 0) {
    sheet.getRange(2, 1, maxRows, TIME_SLOTS_HEADER.length).clearContent();
  }
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, TIME_SLOTS_HEADER.length).setValues(rows);
  }
}

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  let request = {};

  try {
    ensureFestivalSheets_();
    autoCancelExpiredOrders_();
    request = normalizeRequest_(e);
    const action = String(request.action || "").trim();
    let result;

    switch (action) {
      case "publicConfig":
        result = publicConfig_();
        break;
      case "createOrder":
        result = createOrder_(request);
        break;
      case "getCustomerOrder":
        result = getCustomerOrder_(request);
        break;
      case "adminLogin":
        result = adminLogin_(request);
        break;
      case "adminDashboard":
        result = adminDashboard_(request);
        break;
      case "adminUpdateStatus":
        result = adminUpdateStatus_(request);
        break;
      case "adminUpdateOperations":
        result = adminUpdateOperations_(request);
        break;
      case "displayReadyOrders":
        result = displayReadyOrders_();
        break;
      default:
        result = {
          ok: true,
          message: "Festival croffle API is running.",
          updatedAt: isoNow_()
        };
    }

    return buildResponse_(result, request.callback);
  } catch (error) {
    return buildResponse_(
      {
        ok: false,
        error: error.message || "Unexpected error",
        code: error.code || "ERROR",
        updatedAt: isoNow_()
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

function publicConfig_() {
  return {
    ok: true,
    config: buildPublicConfig_(),
    updatedAt: isoNow_()
  };
}

function createOrder_(request) {
  const tokenPayload = decodePayload_(requireParam_(request, "payload"));
  const selectedSlotId = requireParam_(request, "slotId");
  const products = getProducts_();
  const payload = validateOrderPayload_(tokenPayload, products);
  const lock = LockService.getScriptLock();
  let response = null;
  let createdOrder = null;
  let customerToken = "";

  lock.waitLock(30000);

  try {
    autoCancelExpiredOrders_();
    const publicConfig = buildPublicConfig_();
    ensureOrderingOpen_(publicConfig.orderingState);

    const assignedSlot = chooseAvailableSlot_(publicConfig.slots, selectedSlotId, payload.totalCount);
    const orderNumber = nextOrderNumber_();
    customerToken = generateToken_();
    const now = isoNow_();
    const row = buildOrderRow_(orderNumber, customerToken, payload, assignedSlot, now, STATUS.PAYMENT_PENDING);

    getOrdersSheet_().appendRow(row);
    createdOrder = rowToOrder_(row);
    response = {
      ok: true,
      orderNumber: orderNumber,
      customerToken: customerToken,
      customerUrl: buildCustomerUrl_(customerToken),
      status: STATUS.PAYMENT_PENDING,
      totalAmount: payload.totalAmount,
      totalCount: payload.totalCount,
      pickupSlot: buildSlotResponse_(assignedSlot),
      slotAdjusted: assignedSlot.id !== selectedSlotId,
      updatedAt: now
    };
  } finally {
    lock.releaseLock();
  }

  sendNewOrderNotification_(createdOrder);
  return response;
}

function getCustomerOrder_(request) {
  const token = requireParam_(request, "token");
  const match = findOrderRowByToken_(token);

  if (!match) {
    throw createError_("注文情報が見つかりません。URLを確認してください。", "NOT_FOUND");
  }

  const orders = getOrders_();
  const order = rowToOrder_(match.values);
  const queueAhead = calculateGroupsAhead_(order, orders);
  const publicConfig = buildPublicConfig_();

  return {
    ok: true,
    storeName: publicConfig.storeName,
    order: order,
    groupsAhead: queueAhead,
    statusMessage: buildCustomerStatusMessage_(order, publicConfig),
    updatedAt: isoNow_()
  };
}

function adminLogin_(request) {
  const passwordHash = String(requireParam_(request, "passwordHash")).toLowerCase();
  if (passwordHash !== String(ADMIN_PASSWORD_HASH).toLowerCase()) {
    throw createError_("管理パスワードが正しくありません。", "UNAUTHORIZED");
  }

  const sessionToken = generateToken_();
  CacheService.getScriptCache().put(sessionToken, "1", ADMIN_SESSION_TTL_SECONDS);
  return {
    ok: true,
    sessionToken: sessionToken,
    expiresInSeconds: ADMIN_SESSION_TTL_SECONDS
  };
}

function adminDashboard_(request) {
  requireAdminSession_(request);

  const orders = getOrders_().sort(compareOrdersByQueue_);
  const publicConfig = buildPublicConfig_();
  const slotStats = buildSlotStats_(publicConfig.slots, orders);

  return {
    ok: true,
    storeName: publicConfig.storeName,
    orders: orders,
    stats: buildAdminStats_(orders),
    slotStats: slotStats,
    operations: {
      acceptingOrders: publicConfig.orderingState.acceptingOrders,
      soldOut: publicConfig.orderingState.soldOut,
      announcementMessage: publicConfig.announcementMessage,
      saleWindowLabel: publicConfig.saleWindowLabel
    },
    products: publicConfig.products,
    spreadsheetUrl: getSpreadsheet_().getUrl(),
    updatedAt: isoNow_()
  };
}

function adminUpdateStatus_(request) {
  requireAdminSession_(request);

  const orderNumber = requireParam_(request, "orderNumber");
  const nextStatus = requireParam_(request, "status");
  const match = findOrderRowByOrderNumber_(orderNumber);

  if (!match) {
    throw createError_("注文番号が見つかりません。", "NOT_FOUND");
  }
  if (Object.values(STATUS).indexOf(nextStatus) === -1) {
    throw createError_("不正なステータスです。", "INVALID_STATUS");
  }

  const row = match.values.slice();
  const currentOrder = rowToOrder_(row);

  if (currentOrder.status === nextStatus) {
    return {
      ok: true,
      order: currentOrder,
      updatedAt: currentOrder.updatedAt
    };
  }
  if (!isAllowedStatusTransition_(currentOrder.status, nextStatus)) {
    throw createError_("このステータス変更はできません。", "INVALID_TRANSITION");
  }

  const now = isoNow_();
  row[13] = now;
  row[14] = nextStatus;

  if (nextStatus === STATUS.COOKING_WAIT && !row[15]) {
    row[15] = now;
  }
  if (nextStatus === STATUS.READY && !row[16]) {
    row[16] = now;
  }
  if (nextStatus === STATUS.PICKED_UP && !row[17]) {
    row[17] = now;
  }
  if (nextStatus === STATUS.CANCELED && !row[18]) {
    row[18] = now;
  }

  getOrdersSheet_().getRange(match.row, 1, 1, row.length).setValues([row]);

  const updatedOrder = rowToOrder_(row);
  if (nextStatus === STATUS.READY) {
    sendReadyNotification_(updatedOrder);
  }

  return {
    ok: true,
    order: updatedOrder,
    updatedAt: now
  };
}

function adminUpdateOperations_(request) {
  requireAdminSession_(request);

  if (request.acceptingOrders !== undefined && request.acceptingOrders !== "") {
    setSettingValue_("accepting_orders", normalizeBooleanString_(request.acceptingOrders));
  }
  if (request.soldOut !== undefined && request.soldOut !== "") {
    setSettingValue_("sold_out", normalizeBooleanString_(request.soldOut));
  }
  if (request.announcementMessage !== undefined) {
    setSettingValue_("announcement_message", String(request.announcementMessage || ""));
  }

  return {
    ok: true,
    config: buildPublicConfig_(),
    updatedAt: isoNow_()
  };
}

function displayReadyOrders_() {
  const readyOrders = getOrders_()
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
    storeName: getSettingsMap_().store_name || "Un Deux Crois",
    orders: readyOrders,
    updatedAt: isoNow_()
  };
}

function buildPublicConfig_() {
  const settings = getSettingsMap_();
  const products = getProducts_();
  const orders = getOrders_();
  const slots = getTimeSlots_(settings);
  const slotStats = buildSlotStats_(slots, orders);
  const publicSlots = slots.map(function (slot) {
    const stats = slotStats.find(function (entry) {
      return entry.id === slot.id;
    }) || buildEmptySlotStats_(slot);

    return {
      id: slot.id,
      label: slot.label,
      startAt: slot.startAt,
      endAt: slot.endAt,
      capacity: slot.capacity,
      reserved: stats.reservedQuantity,
      remaining: stats.remaining,
      pendingQuantity: stats.pendingQuantity,
      paidQuantity: stats.paidQuantity
    };
  });

  const orderingState = buildOrderingState_(settings, products, publicSlots);

  return {
    storeName: settings.store_name || "Un Deux Crois",
    heroTitle: settings.hero_title || "クロッフル受け取り注文",
    heroMessage: settings.hero_message || "商品を選んで受取時間を予約し、現地でAirペイ決済してください。",
    announcementMessage: settings.announcement_message || "",
    paymentMessage: settings.payment_message || "指定時間内にレジでAirペイ決済をお願いします。",
    saleWindowLabel: buildSaleWindowLabel_(publicSlots),
    orderingState: orderingState,
    products: products.map(function (product) {
      return {
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        imageUrl: product.imageUrl
      };
    }),
    slots: publicSlots
  };
}

function buildOrderingState_(settings, products, slots) {
  const now = new Date();
  const acceptingOrders = coerceBoolean_(settings.accepting_orders, true);
  const soldOut = coerceBoolean_(settings.sold_out, false);
  const firstSlot = slots[0] || null;
  const lastSlot = slots.length ? slots[slots.length - 1] : null;
  const openSlots = slots.filter(function (slot) {
    return new Date(slot.endAt).getTime() > now.getTime();
  });
  const hasCapacity = openSlots.some(function (slot) {
    return slot.remaining > 0;
  });

  if (!products.length) {
    return {
      isOpen: false,
      mode: "no_products",
      message: "販売商品が設定されていません。",
      acceptingOrders: false,
      soldOut: soldOut
    };
  }
  if (!slots.length) {
    return {
      isOpen: false,
      mode: "no_slots",
      message: "時間枠が設定されていません。",
      acceptingOrders: false,
      soldOut: soldOut
    };
  }
  if (soldOut) {
    return {
      isOpen: false,
      mode: "sold_out",
      message: settings.sold_out_message || "本日の販売は完売しました。",
      acceptingOrders: acceptingOrders,
      soldOut: true
    };
  }
  if (!acceptingOrders) {
    return {
      isOpen: false,
      mode: "paused",
      message: settings.order_stop_message || "ただいま受付を停止しています。",
      acceptingOrders: false,
      soldOut: false
    };
  }
  if (firstSlot && now.getTime() < new Date(firstSlot.startAt).getTime()) {
    return {
      isOpen: false,
      mode: "before_sale",
      message: "受付開始は " + formatTime_(firstSlot.startAt) + " です。",
      acceptingOrders: true,
      soldOut: false
    };
  }
  if (!openSlots.length || (lastSlot && now.getTime() >= new Date(lastSlot.endAt).getTime())) {
    return {
      isOpen: false,
      mode: "after_sale",
      message: settings.order_closed_message || "本日の受付は終了しました。",
      acceptingOrders: true,
      soldOut: false
    };
  }
  if (!hasCapacity) {
    return {
      isOpen: false,
      mode: "slot_full",
      message: settings.sold_out_message || "空いている時間枠がありません。",
      acceptingOrders: true,
      soldOut: false
    };
  }

  return {
    isOpen: true,
    mode: "open",
    message: settings.announcement_message || "",
    acceptingOrders: true,
    soldOut: false
  };
}

function ensureOrderingOpen_(orderingState) {
  if (!orderingState || !orderingState.isOpen) {
    throw createError_((orderingState && orderingState.message) || "ただいま受付できません。", "ORDER_CLOSED");
  }
}

function chooseAvailableSlot_(slots, selectedSlotId, requiredQuantity) {
  const nowMs = Date.now();
  const usableSlots = slots.filter(function (slot) {
    return new Date(slot.endAt).getTime() > nowMs;
  });
  const selectedIndex = usableSlots.findIndex(function (slot) {
    return slot.id === selectedSlotId;
  });
  const startIndex = selectedIndex >= 0 ? selectedIndex : 0;

  for (let index = startIndex; index < usableSlots.length; index += 1) {
    if (usableSlots[index].remaining >= requiredQuantity) {
      return usableSlots[index];
    }
  }

  throw createError_("希望数を受け取れる時間枠がありません。個数を減らすか次の枠を確認してください。", "SLOT_UNAVAILABLE");
}

function validateOrderPayload_(payload, products) {
  const productMap = products.reduce(function (result, product) {
    result[product.id] = product;
    return result;
  }, {});
  const name = String((payload && payload.name) || "").trim();
  const grade = String((payload && payload.grade) || "").trim();
  const inputItems = Array.isArray(payload && payload.items) ? payload.items : [];

  if (!name) {
    throw createError_("名前を入力してください。", "INVALID_NAME");
  }
  if (name.length > 40) {
    throw createError_("名前は40文字以内で入力してください。", "INVALID_NAME");
  }
  if (grade.length > 20) {
    throw createError_("学年は20文字以内で入力してください。", "INVALID_GRADE");
  }
  if (!inputItems.length) {
    throw createError_("商品を1つ以上選んでください。", "INVALID_ITEMS");
  }

  const mergedItems = {};
  inputItems.forEach(function (item) {
    const productId = String(item.id || "");
    const quantity = Number(item.qty || 0);

    if (!productMap[productId]) {
      throw createError_("無効な商品が含まれています。", "INVALID_PRODUCT");
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw createError_("数量は1〜20の整数で指定してください。", "INVALID_QUANTITY");
    }
    mergedItems[productId] = (mergedItems[productId] || 0) + quantity;
  });

  let totalCount = 0;
  let totalAmount = 0;
  const items = Object.keys(mergedItems).map(function (productId) {
    const product = productMap[productId];
    const qty = mergedItems[productId];
    const subtotal = product.price * qty;
    totalCount += qty;
    totalAmount += subtotal;
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      price: product.price,
      qty: qty,
      subtotal: subtotal
    };
  });

  if (totalCount > 50) {
    throw createError_("一度に注文できるのは50個までです。", "TOO_MANY_ITEMS");
  }

  return {
    name: name,
    grade: grade,
    items: items,
    totalCount: totalCount,
    totalAmount: totalAmount
  };
}

function buildOrderRow_(orderNumber, token, payload, slot, now, status) {
  return [
    orderNumber,
    token,
    payload.name,
    payload.grade,
    slot.id,
    slot.label,
    slot.startAt,
    slot.endAt,
    payload.items.map(function (item) {
      return item.name;
    }).join(" / "),
    payload.items.map(function (item) {
      return String(item.qty);
    }).join(" / "),
    payload.totalCount,
    payload.totalAmount,
    now,
    now,
    status,
    "",
    "",
    "",
    "",
    JSON.stringify(payload.items)
  ];
}

function rowToOrder_(row) {
  const order = {
    orderNumber: String(row[0] || ""),
    customerToken: String(row[1] || ""),
    customerUrl: buildCustomerUrl_(row[1]),
    name: String(row[2] || ""),
    grade: String(row[3] || ""),
    slotId: String(row[4] || ""),
    slotLabel: String(row[5] || ""),
    slotStart: row[6],
    slotEnd: row[7],
    totalCount: Number(row[10] || 0),
    totalAmount: Number(row[11] || 0),
    orderedAt: row[12],
    updatedAt: row[13],
    status: String(row[14] || STATUS.PAYMENT_PENDING),
    paidAt: row[15] || "",
    readyAt: row[16] || "",
    pickedUpAt: row[17] || "",
    canceledAt: row[18] || "",
    items: parseItemsJson_(row[19])
  };
  return order;
}

function parseItemsJson_(jsonValue) {
  if (!jsonValue) {
    return [];
  }

  try {
    return JSON.parse(jsonValue);
  } catch (error) {
    return [];
  }
}

function calculateGroupsAhead_(currentOrder, orders) {
  if (QUEUE_STATUSES.indexOf(currentOrder.status) === -1) {
    return 0;
  }

  const queue = orders
    .filter(function (order) {
      return QUEUE_STATUSES.indexOf(order.status) !== -1;
    })
    .sort(compareOrdersByQueue_);

  const index = queue.findIndex(function (order) {
    return order.orderNumber === currentOrder.orderNumber;
  });
  return index >= 0 ? index : 0;
}

function compareOrdersByQueue_(a, b) {
  const slotCompare = new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime();
  if (slotCompare !== 0) {
    return slotCompare;
  }
  return orderNumberToInt_(a.orderNumber) - orderNumberToInt_(b.orderNumber);
}

function buildCustomerStatusMessage_(order, publicConfig) {
  if (order.status === STATUS.PAYMENT_PENDING) {
    return publicConfig.paymentMessage || "指定時間内にレジでAirペイ決済をお願いします。";
  }
  if (order.status === STATUS.COOKING_WAIT) {
    return "決済が完了しました。商品を準備しています。";
  }
  if (order.status === STATUS.READY) {
    return "商品が完成しました。受取カウンターへお越しください。";
  }
  if (order.status === STATUS.PICKED_UP) {
    return "受け取り完了です。ご利用ありがとうございました。";
  }
  if (order.status === STATUS.CANCELED) {
    return "時間枠終了までに決済が確認できなかったため、自動キャンセルになりました。";
  }
  return "";
}

function buildAdminStats_(orders) {
  return orders.reduce(
    function (stats, order) {
      stats.totalOrders += 1;
      stats.totalQuantity += order.totalCount;
      if (order.status !== STATUS.CANCELED) {
        stats.projectedRevenue += order.totalAmount;
      }
      if (PAID_STATUSES.indexOf(order.status) !== -1) {
        stats.paidRevenue += order.totalAmount;
        stats.paidQuantity += order.totalCount;
      }
      if (order.status === STATUS.PAYMENT_PENDING) {
        stats.pendingCount += 1;
      }
      if (order.status === STATUS.COOKING_WAIT) {
        stats.cookingCount += 1;
      }
      if (order.status === STATUS.READY) {
        stats.readyCount += 1;
      }
      if (order.status === STATUS.PICKED_UP) {
        stats.pickedUpCount += 1;
      }
      if (order.status === STATUS.CANCELED) {
        stats.canceledCount += 1;
        stats.canceledQuantity += order.totalCount;
      }
      return stats;
    },
    {
      totalOrders: 0,
      totalQuantity: 0,
      paidQuantity: 0,
      canceledQuantity: 0,
      projectedRevenue: 0,
      paidRevenue: 0,
      pendingCount: 0,
      cookingCount: 0,
      readyCount: 0,
      pickedUpCount: 0,
      canceledCount: 0
    }
  );
}

function buildSlotStats_(slots, orders) {
  return slots.map(function (slot) {
    const stats = buildEmptySlotStats_(slot);

    orders.forEach(function (order) {
      if (order.slotId !== slot.id) {
        return;
      }

      if (ACTIVE_SLOT_STATUSES.indexOf(order.status) !== -1) {
        stats.reservedQuantity += order.totalCount;
      }
      if (order.status === STATUS.PAYMENT_PENDING) {
        stats.pendingQuantity += order.totalCount;
      }
      if (PAID_STATUSES.indexOf(order.status) !== -1) {
        stats.paidQuantity += order.totalCount;
        stats.paidRevenue += order.totalAmount;
      }
      if (order.status === STATUS.CANCELED) {
        stats.canceledQuantity += order.totalCount;
      }
    });

    stats.remaining = Math.max(0, slot.capacity - stats.reservedQuantity);
    return stats;
  });
}

function buildEmptySlotStats_(slot) {
  return {
    id: slot.id,
    label: slot.label,
    startAt: slot.startAt,
    endAt: slot.endAt,
    capacity: slot.capacity,
    reservedQuantity: 0,
    pendingQuantity: 0,
    paidQuantity: 0,
    paidRevenue: 0,
    canceledQuantity: 0,
    remaining: slot.capacity
  };
}

function autoCancelExpiredOrders_() {
  const sheet = getOrdersSheet_();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) {
    return;
  }

  const nowMs = Date.now();
  const updates = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const status = String(row[14] || STATUS.PAYMENT_PENDING);
    const slotEndMs = new Date(row[7]).getTime();

    if (status === STATUS.PAYMENT_PENDING && slotEndMs && slotEndMs <= nowMs) {
      row[13] = isoNow_();
      row[14] = STATUS.CANCELED;
      if (!row[18]) {
        row[18] = row[13];
      }
      updates.push({
        row: rowIndex + 1,
        values: row
      });
    }
  }

  updates.forEach(function (update) {
    sheet.getRange(update.row, 1, 1, update.values.length).setValues([update.values]);
  });
}

function isAllowedStatusTransition_(currentStatus, nextStatus) {
  const transitionMap = {};
  transitionMap[STATUS.PAYMENT_PENDING] = [STATUS.COOKING_WAIT, STATUS.CANCELED];
  transitionMap[STATUS.COOKING_WAIT] = [STATUS.READY, STATUS.CANCELED];
  transitionMap[STATUS.READY] = [STATUS.PICKED_UP];
  transitionMap[STATUS.PICKED_UP] = [];
  transitionMap[STATUS.CANCELED] = [];

  return (transitionMap[currentStatus] || []).indexOf(nextStatus) !== -1;
}

function getOrders_() {
  const rows = getOrdersSheet_().getDataRange().getValues().slice(1);
  return rows.map(function (row) {
    return rowToOrder_(row);
  });
}

function getProducts_() {
  const rows = getProductsSheet_().getDataRange().getValues().slice(1);

  return rows
    .map(function (row, index) {
      const active = coerceBoolean_(row[0], true);
      const productId = String(row[1] || "product_" + (index + 1)).trim();
      const name = String(row[2] || "").trim();
      const description = String(row[3] || "").trim();
      const price = Number(row[4] || 0);
      const imageUrl = String(row[5] || "").trim();
      const sortOrder = Number(row[6] || index + 1);

      return {
        active: active,
        id: productId,
        name: name,
        description: description,
        price: price,
        imageUrl: imageUrl,
        sortOrder: sortOrder
      };
    })
    .filter(function (product) {
      return product.active && product.id && product.name && product.price > 0;
    })
    .sort(function (a, b) {
      return a.sortOrder - b.sortOrder;
    });
}

function getTimeSlots_(settings) {
  const rows = getTimeSlotsSheet_().getDataRange().getValues().slice(1);
  const saleDate = normalizeDateString_(settings.sale_date || formatDate_(new Date(), "yyyy-MM-dd"));

  if (!rows.length || rows.every(function (row) {
    return !String(row[1] || "").trim();
  })) {
    const generatedRows = generateTimeSlotRowsFromSettings_(settings);
    if (generatedRows.length) {
      getTimeSlotsSheet_().getRange(2, 1, generatedRows.length, TIME_SLOTS_HEADER.length).setValues(generatedRows);
      return getTimeSlots_(settings);
    }
  }

  return rows
    .map(function (row, index) {
      const active = coerceBoolean_(row[0], true);
      const slotId = String(row[1] || "slot_" + (index + 1)).trim();
      const startTime = normalizeTimeText_(row[3]);
      const endTime = normalizeTimeText_(row[4]);
      const label = String(row[2] || buildSlotLabel_(startTime, endTime)).trim();
      const capacity = Number(row[5] || 0);
      const sortOrder = Number(row[6] || index + 1);

      return {
        active: active,
        id: slotId,
        label: label || buildSlotLabel_(startTime, endTime),
        startAt: buildIsoDateTime_(saleDate, startTime),
        endAt: buildIsoDateTime_(saleDate, endTime),
        capacity: capacity,
        sortOrder: sortOrder
      };
    })
    .filter(function (slot) {
      return slot.active && slot.id && slot.capacity > 0 && slot.startAt && slot.endAt;
    })
    .sort(function (a, b) {
      return a.sortOrder - b.sortOrder;
    });
}

function generateTimeSlotRowsFromSettings_(settings) {
  const startTime = normalizeTimeText_(settings.sale_start_time || "12:00");
  const endTime = normalizeTimeText_(settings.sale_end_time || "15:00");
  const slotMinutes = Number(settings.slot_minutes || 30);
  const capacity = Number(settings.default_slot_capacity || 100);
  const startMinutes = timeTextToMinutes_(startTime);
  const endMinutes = timeTextToMinutes_(endTime);

  if (!startTime || !endTime || !slotMinutes || !capacity || endMinutes <= startMinutes) {
    throw createError_("Settings シートの販売時間または時間枠設定が不正です。", "INVALID_SETTINGS");
  }

  const rows = [];
  let sortOrder = 1;

  for (let cursor = startMinutes; cursor < endMinutes; cursor += slotMinutes) {
    const next = Math.min(cursor + slotMinutes, endMinutes);
    const slotStart = minutesToTimeText_(cursor);
    const slotEnd = minutesToTimeText_(next);
    rows.push([
      true,
      "slot_" + Utilities.formatString("%02d", sortOrder),
      buildSlotLabel_(slotStart, slotEnd),
      slotStart,
      slotEnd,
      capacity,
      sortOrder
    ]);
    sortOrder += 1;
  }

  return rows;
}

function buildSaleWindowLabel_(slots) {
  if (!slots.length) {
    return "-";
  }
  return formatTime_(slots[0].startAt) + "〜" + formatTime_(slots[slots.length - 1].endAt);
}

function buildSlotResponse_(slot) {
  return {
    id: slot.id,
    label: slot.label,
    startAt: slot.startAt,
    endAt: slot.endAt,
    capacity: slot.capacity,
    remaining: slot.remaining
  };
}

function findOrderRowByToken_(token) {
  const rows = getOrdersSheet_().getDataRange().getValues();
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    if (String(rows[rowIndex][1] || "") === token) {
      return {
        row: rowIndex + 1,
        values: rows[rowIndex]
      };
    }
  }
  return null;
}

function findOrderRowByOrderNumber_(orderNumber) {
  const rows = getOrdersSheet_().getDataRange().getValues();
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    if (String(rows[rowIndex][0] || "") === orderNumber) {
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
  let current = Number(properties.getProperty(LAST_ORDER_NUMBER_KEY) || 0);

  if (!current) {
    current = getOrders_().reduce(function (maxValue, order) {
      return Math.max(maxValue, orderNumberToInt_(order.orderNumber));
    }, 100);
  }

  current += 1;
  properties.setProperty(LAST_ORDER_NUMBER_KEY, String(current));
  return "#" + current;
}

function requireAdminSession_(request) {
  const sessionToken = requireParam_(request, "sessionToken");
  const active = CacheService.getScriptCache().get(sessionToken);
  if (!active) {
    throw createError_("セッションが切れました。再ログインしてください。", "UNAUTHORIZED");
  }
}

function ensureFestivalSheets_() {
  const spreadsheet = getSpreadsheet_();
  if (!spreadsheet) {
    throw createError_("スプレッドシートに接続できません。SPREADSHEET_ID を確認してください。", "NO_SPREADSHEET");
  }

  ensureSheetWithHeader_(SHEETS.settings, SETTINGS_HEADER);
  ensureSheetWithHeader_(SHEETS.products, PRODUCTS_HEADER);
  ensureSheetWithHeader_(SHEETS.timeSlots, TIME_SLOTS_HEADER);
  ensureSheetWithHeader_(SHEETS.orders, ORDER_HEADER);
  seedSettingsSheet_();
  seedProductsSheet_();
  seedTimeSlotsSheet_();
}

function ensureSheetWithHeader_(name, header) {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const currentHeader = sheet.getRange(1, 1, 1, header.length).getValues()[0];
  if (String(currentHeader[0] || "") !== header[0]) {
    sheet.insertRows(1, 1);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function seedSettingsSheet_() {
  const sheet = getSettingsSheet_();
  if (sheet.getLastRow() > 1) {
    return;
  }

  const saleDate = formatDate_(new Date(), "yyyy-MM-dd");
  const rows = [
    ["store_name", "Un Deux Crois", "店舗名"],
    ["hero_title", "クロッフル受け取り注文", "注文画面のタイトル"],
    ["hero_message", "商品を選んで受取時間を予約し、現地でAirペイ決済してください。", "注文画面説明文"],
    ["announcement_message", "注文番号はスクリーンショットで保存してください。", "上部のお知らせ"],
    ["payment_message", "指定時間内にレジでAirペイ決済をお願いします。", "お客様待機画面の決済案内"],
    ["order_stop_message", "ただいま受付を停止しています。", "受付停止時メッセージ"],
    ["order_closed_message", "本日の受付は終了しました。", "販売終了時メッセージ"],
    ["sold_out_message", "本日のクロッフルは完売しました。", "完売時メッセージ"],
    ["sale_date", saleDate, "販売日 yyyy-mm-dd"],
    ["sale_start_time", "12:00", "販売開始 HH:mm"],
    ["sale_end_time", "15:00", "販売終了 HH:mm"],
    ["slot_minutes", "30", "時間枠の長さ（分）"],
    ["default_slot_capacity", "100", "各時間枠の初期上限数"],
    ["accepting_orders", "TRUE", "TRUE/FALSE で受付停止・再開"],
    ["sold_out", "FALSE", "TRUE/FALSE で完売切替"]
  ];

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function seedProductsSheet_() {
  const sheet = getProductsSheet_();
  if (sheet.getLastRow() > 1) {
    return;
  }

  const rows = DEFAULT_PRODUCTS.map(function (product) {
    return [
      product.active,
      product.productId,
      product.name,
      product.description,
      product.price,
      product.imageUrl,
      product.sortOrder
    ];
  });
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function seedTimeSlotsSheet_() {
  const sheet = getTimeSlotsSheet_();
  if (sheet.getLastRow() > 1) {
    return;
  }
  const rows = generateTimeSlotRowsFromSettings_(getSettingsMap_());
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function getSettingsMap_() {
  const rows = getSettingsSheet_().getDataRange().getValues().slice(1);
  return rows.reduce(function (result, row) {
    const key = String(row[0] || "").trim();
    if (key) {
      result[key] = row[1];
    }
    return result;
  }, {});
}

function setSettingValue_(key, value) {
  const sheet = getSettingsSheet_();
  const rows = sheet.getDataRange().getValues();

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    if (String(rows[rowIndex][0] || "").trim() === key) {
      sheet.getRange(rowIndex + 1, 2).setValue(value);
      return;
    }
  }

  sheet.appendRow([key, value, ""]);
}

function getSettingsSheet_() {
  return getSpreadsheet_().getSheetByName(SHEETS.settings);
}

function getProductsSheet_() {
  return getSpreadsheet_().getSheetByName(SHEETS.products);
}

function getTimeSlotsSheet_() {
  return getSpreadsheet_().getSheetByName(SHEETS.timeSlots);
}

function getOrdersSheet_() {
  return getSpreadsheet_().getSheetByName(SHEETS.orders);
}

function getSpreadsheet_() {
  if (SPREADSHEET_ID && SPREADSHEET_ID !== "PASTE_SPREADSHEET_ID_HERE") {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sendNewOrderNotification_(order) {
  sendOrderNotificationSafely_("new", order);
}

function sendReadyNotification_(order) {
  sendOrderNotificationSafely_("ready", order);
}

function sendOrderNotificationSafely_(kind, order) {
  if (!NOTIFICATION_EMAIL || !order) {
    return;
  }

  try {
    MailApp.sendEmail({
      to: NOTIFICATION_EMAIL,
      subject: buildNotificationSubject_(kind, order),
      body: buildNotificationBody_(kind, order)
    });
  } catch (error) {
    Logger.log("Notification email failed: " + error);
  }
}

function buildNotificationSubject_(kind, order) {
  const prefix = "[" + (getSettingsMap_().store_name || "Un Deux Crois") + "]";
  if (kind === "ready") {
    return prefix + " 商品が完成しました " + order.orderNumber;
  }
  return prefix + " 新しい注文 " + order.orderNumber;
}

function buildNotificationBody_(kind, order) {
  const lines = [
    kind === "ready" ? "注文が完成になりました。" : "新しい注文が入りました。",
    "",
    "注文番号: " + order.orderNumber,
    "名前: " + order.name,
    "学年: " + (order.grade || "-"),
    "受取時間: " + order.slotLabel,
    "ステータス: " + order.status,
    "合計金額: " + formatCurrencyYen_(order.totalAmount),
    "",
    "注文内容:"
  ];

  order.items.forEach(function (item) {
    lines.push("- " + item.name + " × " + item.qty + " (" + formatCurrencyYen_(item.subtotal) + ")");
  });

  lines.push("");
  lines.push("お客様ページ: " + buildCustomerUrl_(order.customerToken));
  return lines.join("\n");
}

function buildCustomerUrl_(token) {
  if (!PUBLIC_SITE_URL || !token) {
    return "";
  }
  return String(PUBLIC_SITE_URL).replace(/\/+$/, "") + "/customer.html?token=" + encodeURIComponent(token);
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

function decodePayload_(payloadBase64) {
  try {
    const bytes = Utilities.base64DecodeWebSafe(payloadBase64);
    const json = Utilities.newBlob(bytes).getDataAsString("UTF-8");
    return JSON.parse(json);
  } catch (error) {
    throw createError_("注文データを読み取れませんでした。", "INVALID_PAYLOAD");
  }
}

function generateToken_() {
  return Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
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

function isoNow_() {
  return new Date().toISOString();
}

function orderNumberToInt_(value) {
  return Number(String(value || "").replace(/[^\d]/g, "")) || 0;
}

function coerceBoolean_(value, fallback) {
  if (value === true || value === false) {
    return value;
  }
  const normalized = String(value || "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].indexOf(normalized) !== -1) {
    return true;
  }
  if (["false", "0", "no", "off"].indexOf(normalized) !== -1) {
    return false;
  }
  return Boolean(fallback);
}

function normalizeBooleanString_(value) {
  return coerceBoolean_(value, false) ? "TRUE" : "FALSE";
}

function normalizeDateString_(value) {
  if (value instanceof Date) {
    return formatDate_(value, "yyyy-MM-dd");
  }
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const date = new Date(raw);
  return isNaN(date.getTime()) ? formatDate_(new Date(), "yyyy-MM-dd") : formatDate_(date, "yyyy-MM-dd");
}

function normalizeTimeText_(value) {
  if (value instanceof Date) {
    return formatDate_(value, "HH:mm");
  }
  const raw = String(value || "").trim();
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const parts = raw.split(":");
    return Utilities.formatString("%02d:%02d", Number(parts[0]), Number(parts[1]));
  }
  return "";
}

function timeTextToMinutes_(timeText) {
  const parts = String(timeText || "00:00").split(":");
  return Number(parts[0] || 0) * 60 + Number(parts[1] || 0);
}

function minutesToTimeText_(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return Utilities.formatString("%02d:%02d", hour, minute);
}

function buildSlotLabel_(startTime, endTime) {
  return String(startTime || "") + "〜" + String(endTime || "");
}

function buildIsoDateTime_(dateText, timeText) {
  if (!dateText || !timeText) {
    return "";
  }
  return dateText + "T" + timeText + ":00";
}

function formatDate_(date, pattern) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), pattern);
}

function formatTime_(value) {
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return String(value || "-");
  }
  return formatDate_(date, "HH:mm");
}

function formatCurrencyYen_(value) {
  return "¥" + Number(value || 0).toLocaleString("ja-JP");
}
