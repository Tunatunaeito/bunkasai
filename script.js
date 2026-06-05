(function () {
  const APP_CONFIG = {
    gasWebAppUrl: "https://script.google.com/macros/s/AKfycby5RqvOCMNI3C34NdgRIiLQ_tyvkNx_bzG_uuqbEJiGDcO8cIPK2gqe3FZbD4Z85FWJHw/exec",
    storeName: "Un Deux Crois",
    products: [
      {
        id: "croffle_sugar",
        name: "シュガーバタークロッフル",
        description: "焼きたての香ばしさに、バターとシュガーのやさしい甘さを重ねた定番フレーバー。",
        price: 400,
        image: "./assets/product-croffle-sugar.svg"
      },
      {
        id: "croffle_choco",
        name: "チョコクロッフル",
        description: "サクッと焼いたクロッフルにチョコソースをたっぷり。写真映えもする人気メニュー。",
        price: 450,
        image: "./assets/product-croffle-choco.svg"
      },
      {
        id: "croffle_berry",
        name: "ベリークリームクロッフル",
        description: "甘酸っぱいベリーソースとふんわりクリームで仕上げた、文化祭らしい華やかな一品。",
        price: 500,
        image: "./assets/product-croffle-berry.svg"
      }
    ],
    statuses: ["受付中", "調理中", "完成", "受取済み", "キャンセル"]
  };

  const ADMIN_SESSION_KEY = "festival_admin_session_token";
  const currencyFormatter = new Intl.NumberFormat("ja-JP");

  document.addEventListener("DOMContentLoaded", () => {
    applySharedUi();
    registerServiceWorker();

    const page = document.body.dataset.page;
    const pageBootMap = {
      order: bootOrderPage,
      edit: bootEditPage,
      admin: bootAdminPage,
      display: bootDisplayPage
    };

    if (pageBootMap[page]) {
      pageBootMap[page]();
    }
  });

  function applySharedUi() {
    document.querySelectorAll("[data-store-name]").forEach((node) => {
      node.textContent = APP_CONFIG.storeName;
    });

    document.querySelectorAll("[data-api-config-status]").forEach((node) => {
      const configured = hasApiConfig();
      node.textContent = configured
        ? "Apps Script接続OK"
        : "API URL未設定";
      node.dataset.ready = String(configured);
    });

    const yearNode = document.getElementById("currentYear");
    if (yearNode) {
      yearNode.textContent = String(new Date().getFullYear());
    }
  }

  function bootOrderPage() {
    const form = document.getElementById("orderForm");
    const grid = document.getElementById("productGrid");
    const nameInput = document.getElementById("customerName");
    const gradeInput = document.getElementById("customerGrade");
    const totalAmount = document.getElementById("orderTotalAmount");
    const totalItems = document.getElementById("orderTotalItems");
    const summaryList = document.getElementById("orderSummaryList");
    const submitButton = document.getElementById("submitOrderButton");
    const message = document.getElementById("orderMessage");
    const receiptPanel = document.getElementById("receiptPanel");
    const receiptOrderNumber = document.getElementById("receiptOrderNumber");
    const receiptStatus = document.getElementById("receiptStatus");
    const receiptEditLink = document.getElementById("receiptEditLink");
    const openEditPageButton = document.getElementById("openEditPageButton");
    const copyEditLinkButton = document.getElementById("copyEditLinkButton");

    const quantities = createEmptyQuantities();

    mountProductGrid(grid, quantities, updateSummary);
    updateSummary();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage(message);

      const payload = buildOrderPayload(nameInput.value, gradeInput.value, quantities);
      if (!payload.ok) {
        setMessage(message, payload.message, "error");
        return;
      }

      try {
        setLoading(submitButton, true, "送信中...");
        const response = await requestApi("createOrder", {
          payload: toBase64Url(payload.data)
        });
        const editUrl = buildEditUrl(response.editToken);

        receiptOrderNumber.textContent = response.orderNumber;
        receiptStatus.textContent = response.status;
        receiptEditLink.textContent = editUrl;
        receiptEditLink.href = editUrl;
        openEditPageButton.href = editUrl;
        receiptPanel.hidden = false;
        receiptPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        setMessage(message, "予約を保存しました。注文番号と編集URLを控えてください。", "success");
      } catch (error) {
        setMessage(message, error.message, "error");
      } finally {
        setLoading(submitButton, false);
      }
    });

    copyEditLinkButton.addEventListener("click", async () => {
      const url = receiptEditLink.href;
      if (!url || url === "#") {
        setMessage(message, "先に注文を完了してください。", "warn");
        return;
      }

      try {
        await copyText(url);
        setMessage(message, "編集URLをコピーしました。", "success");
      } catch (error) {
        setMessage(message, "コピーできなかったため、URLを長押しして共有してください。", "warn");
      }
    });

    if (!hasApiConfig()) {
      setMessage(message, "Apps Script の WebアプリURLを script.js に設定してください。", "warn");
    }

    function updateSummary() {
      renderSummary(quantities, totalAmount, totalItems, summaryList, submitButton);
    }
  }

  function bootEditPage() {
    const loadingCard = document.getElementById("editLoadingCard");
    const errorCard = document.getElementById("editErrorCard");
    const errorMessage = document.getElementById("editErrorMessage");
    const content = document.getElementById("editContent");
    const form = document.getElementById("editForm");
    const grid = document.getElementById("editProductGrid");
    const nameInput = document.getElementById("editCustomerName");
    const gradeInput = document.getElementById("editCustomerGrade");
    const saveButton = document.getElementById("saveEditButton");
    const cancelButton = document.getElementById("cancelOrderButton");
    const totalAmount = document.getElementById("editTotalAmount");
    const totalItems = document.getElementById("editTotalItems");
    const summaryList = document.getElementById("editSummaryList");
    const message = document.getElementById("editMessage");
    const pageOrderNumber = document.getElementById("editPageOrderNumber");
    const pageStatus = document.getElementById("editPageStatus");
    const infoOrderNumber = document.getElementById("editInfoOrderNumber");
    const infoUpdatedAt = document.getElementById("editInfoUpdatedAt");

    const quantities = createEmptyQuantities();
    const token = new URLSearchParams(window.location.search).get("token");
    let currentOrder = null;

    mountProductGrid(grid, quantities, updateSummary);
    updateSummary();

    if (!token) {
      showError("編集トークンがありません。注文完了画面のURLから開き直してください。");
      return;
    }

    if (!hasApiConfig()) {
      showError("script.js の `gasWebAppUrl` が未設定です。");
      return;
    }

    loadOrder();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage(message);

      const payload = buildOrderPayload(nameInput.value, gradeInput.value, quantities);
      if (!payload.ok) {
        setMessage(message, payload.message, "error");
        return;
      }

      try {
        setLoading(saveButton, true, "更新中...");
        const response = await requestApi("updateOrder", {
          token,
          payload: toBase64Url(payload.data)
        });
        applyLoadedOrder(response.order);
        setMessage(message, "注文内容を更新しました。ステータスは受付中に戻りました。", "success");
      } catch (error) {
        setMessage(message, error.message, "error");
      } finally {
        setLoading(saveButton, false);
        if (currentOrder && !currentOrder.editable) {
          setEditLockState(currentOrder);
        }
      }
    });

    cancelButton.addEventListener("click", async () => {
      clearMessage(message);
      if (!window.confirm("この注文をキャンセルします。よろしいですか？")) {
        return;
      }

      try {
        setLoading(cancelButton, true, "キャンセル中...");
        const response = await requestApi("cancelOrder", { token });
        applyLoadedOrder(response.order);
        setMessage(message, "注文をキャンセルしました。", "success");
      } catch (error) {
        setMessage(message, error.message, "error");
      } finally {
        setLoading(cancelButton, false);
        if (currentOrder && !currentOrder.editable) {
          setEditLockState(currentOrder);
        }
      }
    });

    function updateSummary() {
      renderSummary(quantities, totalAmount, totalItems, summaryList, saveButton);
    }

    async function loadOrder() {
      try {
        const response = await requestApi("getOrder", { token });
        applyLoadedOrder(response.order);
        loadingCard.hidden = true;
        errorCard.hidden = true;
        content.hidden = false;
      } catch (error) {
        showError(error.message);
      }
    }

    function applyLoadedOrder(order) {
      currentOrder = order;
      pageOrderNumber.textContent = order.orderNumber;
      pageStatus.textContent = order.status;
      infoOrderNumber.textContent = order.orderNumber;
      infoUpdatedAt.textContent = formatDateTime(order.updatedAt);
      nameInput.value = order.name;
      gradeInput.value = order.grade || "";

      Object.keys(quantities).forEach((key) => {
        quantities[key] = 0;
      });

      order.items.forEach((item) => {
        if (Object.prototype.hasOwnProperty.call(quantities, item.id)) {
          quantities[item.id] = item.qty;
        }
      });

      syncProductGrid(grid, quantities);
      updateSummary();
      setEditLockState(order);
    }

    function setEditLockState(order) {
      const locked = !order.editable;
      grid.querySelectorAll("button").forEach((button) => {
        button.disabled = locked;
      });
      nameInput.disabled = locked;
      gradeInput.disabled = locked;
      saveButton.disabled = locked;
      cancelButton.disabled = locked || order.status === "キャンセル";

      if (order.status === "キャンセル") {
        setMessage(message, "この注文はキャンセル済みです。", "warn");
      } else if (order.status === "受取済み") {
        setMessage(message, "受取済みの注文は変更できません。", "warn");
      } else if (currentOrder) {
        clearMessage(message);
      }
    }

    function showError(text) {
      loadingCard.hidden = true;
      content.hidden = true;
      errorMessage.textContent = text;
      errorCard.hidden = false;
    }
  }

  function bootAdminPage() {
    const loginCard = document.getElementById("adminLoginCard");
    const loginForm = document.getElementById("adminLoginForm");
    const loginMessage = document.getElementById("adminLoginMessage");
    const passwordInput = document.getElementById("adminPassword");
    const loginButton = document.getElementById("adminLoginButton");
    const dashboard = document.getElementById("adminDashboard");
    const dashboardMessage = document.getElementById("adminDashboardMessage");
    const searchInput = document.getElementById("adminSearchInput");
    const refreshButton = document.getElementById("adminRefreshButton");
    const logoutButton = document.getElementById("adminLogoutButton");
    const stats = document.getElementById("adminStats");
    const orderList = document.getElementById("adminOrderList");
    const updatedAt = document.getElementById("adminUpdatedAt");

    const state = {
      sessionToken: sessionStorage.getItem(ADMIN_SESSION_KEY) || "",
      orders: []
    };

    if (!hasApiConfig()) {
      setMessage(loginMessage, "Apps Script の WebアプリURLを script.js に設定してください。", "warn");
    }

    if (state.sessionToken && hasApiConfig()) {
      showDashboard();
      loadOrders();
    }

    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage(loginMessage);

      const password = passwordInput.value.trim();
      if (!password) {
        setMessage(loginMessage, "管理パスワードを入力してください。", "error");
        return;
      }

      try {
        setLoading(loginButton, true, "ログイン中...");
        const passwordHash = await sha256Hex(password);
        const response = await requestApi("adminLogin", { passwordHash });
        state.sessionToken = response.sessionToken;
        sessionStorage.setItem(ADMIN_SESSION_KEY, response.sessionToken);
        passwordInput.value = "";
        showDashboard();
        setMessage(dashboardMessage, "ログインしました。", "success");
        await loadOrders();
      } catch (error) {
        setMessage(loginMessage, error.message, "error");
      } finally {
        setLoading(loginButton, false);
      }
    });

    searchInput.addEventListener("input", () => {
      renderOrders();
    });

    refreshButton.addEventListener("click", () => {
      loadOrders();
    });

    logoutButton.addEventListener("click", () => {
      state.sessionToken = "";
      state.orders = [];
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      dashboard.hidden = true;
      loginCard.hidden = false;
      passwordInput.focus();
      clearMessage(dashboardMessage);
    });

    orderList.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-status-action]");
      if (!button) {
        return;
      }

      const orderNumber = button.dataset.orderNumber;
      const nextStatus = button.dataset.statusAction;
      const currentStatus = button.dataset.currentStatus;
      if (!orderNumber || !nextStatus || nextStatus === currentStatus) {
        return;
      }

      try {
        setLoading(button, true, "更新中...");
        await requestApi("adminUpdateStatus", {
          sessionToken: state.sessionToken,
          orderNumber,
          status: nextStatus
        });
        setMessage(dashboardMessage, `${orderNumber} を「${nextStatus}」に更新しました。`, "success");
        await loadOrders(false);
      } catch (error) {
        if (isUnauthorized(error)) {
          handleExpiredSession(error.message);
          return;
        }
        setMessage(dashboardMessage, error.message, "error");
      } finally {
        setLoading(button, false);
      }
    });

    async function loadOrders(showMessage) {
      try {
        const response = await requestApi("adminList", { sessionToken: state.sessionToken });
        state.orders = response.orders || [];
        renderStats(response.stats || buildStats(state.orders));
        renderOrders();
        updatedAt.textContent = `最終更新: ${formatDateTime(response.updatedAt)}`;
        if (showMessage !== false) {
          clearMessage(dashboardMessage);
        }
      } catch (error) {
        if (isUnauthorized(error)) {
          handleExpiredSession(error.message);
          return;
        }
        setMessage(dashboardMessage, error.message, "error");
      }
    }

    function renderStats(data) {
      const entries = [
        { label: "総注文", value: data.total || 0 },
        { label: "受付中", value: data["受付中"] || 0 },
        { label: "調理中", value: data["調理中"] || 0 },
        { label: "完成", value: data["完成"] || 0 },
        { label: "受取済み", value: data["受取済み"] || 0 }
      ];

      stats.innerHTML = entries
        .map(
          (entry) => `
            <article class="stat-card">
              <span>${escapeHtml(entry.label)}</span>
              <strong>${escapeHtml(String(entry.value))}</strong>
            </article>
          `
        )
        .join("");
    }

    function renderOrders() {
      const keyword = searchInput.value.trim().toLowerCase();
      const filteredOrders = state.orders.filter((order) => {
        if (!keyword) {
          return true;
        }

        const searchTarget = [
          order.orderNumber,
          order.name,
          order.grade,
          order.status,
          (order.items || []).map((item) => `${item.name} ${item.qty}`).join(" ")
        ]
          .join(" ")
          .toLowerCase();

        return searchTarget.includes(keyword);
      });

      if (!filteredOrders.length) {
        orderList.innerHTML = `
          <article class="panel-card centered-card">
            <h2>該当する注文がありません</h2>
            <p class="small-note">検索条件を変えるか、再読み込みしてください。</p>
          </article>
        `;
        return;
      }

      orderList.innerHTML = filteredOrders
        .map((order) => {
          const lineItems = (order.items || [])
            .map(
              (item) =>
                `<span class="line-item-pill">${escapeHtml(item.name)} × ${escapeHtml(String(item.qty))}</span>`
            )
            .join("");

          const statusButtons = APP_CONFIG.statuses
            .map(
              (status) => `
                <button
                  type="button"
                  class="status-button ${order.status === status ? "is-active" : ""}"
                  data-order-number="${escapeHtml(order.orderNumber)}"
                  data-current-status="${escapeHtml(order.status)}"
                  data-status-action="${escapeHtml(status)}"
                >
                  ${escapeHtml(status)}
                </button>
              `
            )
            .join("");

          return `
            <article class="admin-order-card">
              <div class="admin-order-head">
                <div>
                  <h3>${escapeHtml(order.orderNumber)}</h3>
                  <p class="small-note">${escapeHtml(order.name)}${order.grade ? ` / ${escapeHtml(order.grade)}` : ""}</p>
                </div>
                <span class="status-pill" data-status="${escapeHtml(order.status)}">${escapeHtml(order.status)}</span>
              </div>
              <div class="admin-order-meta">
                <span>合計: ${formatCurrency(order.totalAmount)}</span>
                <span>注文時刻: ${escapeHtml(formatDateTime(order.orderedAt))}</span>
                <span>更新時刻: ${escapeHtml(formatDateTime(order.updatedAt))}</span>
              </div>
              <div class="line-item-list">${lineItems}</div>
              <div class="status-button-row">${statusButtons}</div>
            </article>
          `;
        })
        .join("");
    }

    function showDashboard() {
      loginCard.hidden = true;
      dashboard.hidden = false;
    }

    function handleExpiredSession(messageText) {
      state.sessionToken = "";
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      dashboard.hidden = true;
      loginCard.hidden = false;
      setMessage(loginMessage, messageText || "セッションの有効期限が切れました。再ログインしてください。", "warn");
    }
  }

  function bootDisplayPage() {
    const orderList = document.getElementById("displayOrderList");
    const updatedAt = document.getElementById("displayUpdatedAt");
    const count = document.getElementById("displayCount");
    const message = document.getElementById("displayMessage");

    if (!hasApiConfig()) {
      setMessage(message, "Apps Script の WebアプリURLを設定すると注文番号が表示されます。", "warn");
      message.hidden = false;
      return;
    }

    loadDisplayOrders();
    window.setInterval(loadDisplayOrders, 5000);

    async function loadDisplayOrders() {
      try {
        const response = await requestApi("displayList");
        clearMessage(message);
        renderDisplayOrders(response.orders || []);
        updatedAt.textContent = `最終更新 ${formatDateTime(response.updatedAt)}`;
      } catch (error) {
        setMessage(message, error.message, "error");
      }
    }

    function renderDisplayOrders(orders) {
      count.textContent = `${orders.length}件`;

      if (!orders.length) {
        orderList.innerHTML = `
          <article class="display-empty">
            <div>
              <h2>ただいま呼び出し中の注文はありません</h2>
              <p>完成したらこの画面に注文番号が表示されます。</p>
            </div>
          </article>
        `;
        return;
      }

      orderList.innerHTML = orders
        .map(
          (order) => `
            <article class="display-order-card">
              <strong class="display-number">${escapeHtml(order.orderNumber)}</strong>
            </article>
          `
        )
        .join("");
    }
  }

  function mountProductGrid(container, quantities, onChange) {
    container.innerHTML = APP_CONFIG.products
      .map((product) => {
        const qty = quantities[product.id] || 0;
        return `
          <article class="product-card ${qty > 0 ? "is-selected" : ""}" data-product-card="${escapeHtml(product.id)}">
            <div class="product-image-wrap">
              <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}">
            </div>
            <div class="product-header">
              <div>
                <h3>${escapeHtml(product.name)}</h3>
                <p>${escapeHtml(product.description)}</p>
              </div>
              <span class="product-price">${formatCurrency(product.price)}</span>
            </div>
            <div class="qty-control">
              <button type="button" class="qty-button" data-product-id="${escapeHtml(product.id)}" data-delta="-1" aria-label="${escapeHtml(product.name)}を減らす">−</button>
              <div class="qty-value" data-qty-for="${escapeHtml(product.id)}">${qty}</div>
              <button type="button" class="qty-button" data-product-id="${escapeHtml(product.id)}" data-delta="1" aria-label="${escapeHtml(product.name)}を増やす">＋</button>
            </div>
          </article>
        `;
      })
      .join("");

    container.onclick = (event) => {
      const button = event.target.closest("[data-delta]");
      if (!button || button.disabled) {
        return;
      }

      const productId = button.dataset.productId;
      const delta = Number(button.dataset.delta);
      const current = quantities[productId] || 0;
      const next = clampQuantity(current + delta);

      if (next === current) {
        return;
      }

      quantities[productId] = next;
      syncProductGrid(container, quantities);
      onChange();
    };
  }

  function syncProductGrid(container, quantities) {
    APP_CONFIG.products.forEach((product) => {
      const qty = quantities[product.id] || 0;
      const qtyNode = container.querySelector(`[data-qty-for="${product.id}"]`);
      const card = container.querySelector(`[data-product-card="${product.id}"]`);
      if (qtyNode) {
        qtyNode.textContent = String(qty);
      }
      if (card) {
        card.classList.toggle("is-selected", qty > 0);
      }
    });
  }

  function renderSummary(quantities, totalAmountNode, totalItemsNode, summaryListNode, submitButton) {
    const summary = collectOrderSummary(quantities);
    totalAmountNode.textContent = formatCurrency(summary.totalAmount);
    totalItemsNode.textContent = `${summary.totalCount}個`;

    if (!summary.items.length) {
      summaryListNode.innerHTML = `<li class="empty-state">まだ商品が選ばれていません</li>`;
    } else {
      summaryListNode.innerHTML = summary.items
        .map(
          (item) => `
            <li>
              <span>${escapeHtml(item.name)} × ${escapeHtml(String(item.qty))}</span>
              <strong>${formatCurrency(item.subtotal)}</strong>
            </li>
          `
        )
        .join("");
    }

    if (submitButton) {
      submitButton.disabled = summary.totalCount === 0;
    }
  }

  function buildOrderPayload(name, grade, quantities) {
    const trimmedName = String(name || "").trim();
    const trimmedGrade = String(grade || "").trim();
    const items = collectOrderSummary(quantities).items.map((item) => ({
      id: item.id,
      qty: item.qty
    }));

    if (!trimmedName) {
      return { ok: false, message: "名前を入力してください。" };
    }

    if (trimmedName.length > 40) {
      return { ok: false, message: "名前は40文字以内で入力してください。" };
    }

    if (trimmedGrade.length > 20) {
      return { ok: false, message: "学年は20文字以内で入力してください。" };
    }

    if (!items.length) {
      return { ok: false, message: "1つ以上の商品を選んでください。" };
    }

    return {
      ok: true,
      data: {
        name: trimmedName,
        grade: trimmedGrade,
        items
      }
    };
  }

  function collectOrderSummary(quantities) {
    const items = [];
    let totalAmount = 0;
    let totalCount = 0;

    APP_CONFIG.products.forEach((product) => {
      const qty = clampQuantity(quantities[product.id] || 0);
      if (!qty) {
        return;
      }

      const subtotal = product.price * qty;
      items.push({
        id: product.id,
        name: product.name,
        price: product.price,
        qty,
        subtotal
      });
      totalAmount += subtotal;
      totalCount += qty;
    });

    return {
      items,
      totalAmount,
      totalCount
    };
  }

  function buildStats(orders) {
    return orders.reduce(
      (stats, order) => {
        stats.total += 1;
        stats[order.status] = (stats[order.status] || 0) + 1;
        return stats;
      },
      { total: 0, "受付中": 0, "調理中": 0, "完成": 0, "受取済み": 0, "キャンセル": 0 }
    );
  }

  async function requestApi(action, params) {
    if (!hasApiConfig()) {
      throw new Error("Apps Script のWebアプリURLが未設定です。");
    }

    const response = await jsonpRequest(Object.assign({ action }, params));
    if (!response || response.ok !== true) {
      const error = new Error((response && response.error) || "通信に失敗しました。");
      if (response && response.code) {
        error.code = response.code;
      }
      throw error;
    }
    return response;
  }

  function jsonpRequest(params) {
    return new Promise((resolve, reject) => {
      const callbackName = `festivalCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const url = new URL(APP_CONFIG.gasWebAppUrl);
      const script = document.createElement("script");
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("通信がタイムアウトしました。Apps Script のURLを確認してください。"));
      }, 15000);

      Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") {
          return;
        }
        url.searchParams.set(key, String(value));
      });
      url.searchParams.set("callback", callbackName);

      window[callbackName] = (payload) => {
        cleanup();
        resolve(payload);
      };

      script.onerror = () => {
        cleanup();
        reject(new Error("Apps Script に接続できませんでした。デプロイURLを確認してください。"));
      };
      script.src = url.toString();
      document.head.appendChild(script);

      function cleanup() {
        window.clearTimeout(timeout);
        delete window[callbackName];
        script.remove();
      }
    });
  }

  function buildEditUrl(token) {
    const url = new URL("./edit.html", window.location.href);
    url.searchParams.set("token", token);
    return url.toString();
  }

  function createEmptyQuantities() {
    return APP_CONFIG.products.reduce((result, product) => {
      result[product.id] = 0;
      return result;
    }, {});
  }

  function hasApiConfig() {
    return /^https:\/\/.+/i.test(APP_CONFIG.gasWebAppUrl);
  }

  function formatCurrency(value) {
    return `¥${currencyFormatter.format(Number(value) || 0)}`;
  }

  function formatDateTime(value) {
    if (!value) {
      return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function setMessage(node, text, tone) {
    if (!node) {
      return;
    }
    node.hidden = false;
    node.dataset.tone = tone || "info";
    node.textContent = text;
  }

  function clearMessage(node) {
    if (!node) {
      return;
    }
    node.hidden = true;
    node.textContent = "";
    delete node.dataset.tone;
  }

  function setLoading(target, loading, label) {
    if (!target) {
      return;
    }
    if (!target.dataset.defaultLabel) {
      target.dataset.defaultLabel = target.textContent;
    }
    target.disabled = Boolean(loading);
    target.textContent = loading ? label || "処理中..." : target.dataset.defaultLabel;
  }

  function clampQuantity(value) {
    return Math.max(0, Math.min(20, Number(value) || 0));
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function toBase64Url(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isUnauthorized(error) {
    return error && (error.code === "UNAUTHORIZED" || /ログイン|認証|セッション/i.test(error.message));
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const isHttp = window.location.protocol === "http:" || window.location.protocol === "https:";
    if (!isHttp) {
      return;
    }

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        return undefined;
      });
    });
  }
})();
