(function () {
  const APP_CONFIG = {
    gasWebAppUrl: "https://script.google.com/macros/s/AKfycby5RqvOCMNI3C34NdgRIiLQ_tyvkNx_bzG_uuqbEJiGDcO8cIPK2gqe3FZbD4Z85FWJHw/exec",
    fallbackStoreName: "Un Deux Crois"
  };

  const STORAGE_KEYS = {
    opsSession: "festival_ops_session_token",
    orderDraft: "festival_croffle_order_draft_v2",
    lastOrder: "festival_croffle_last_order_v2"
  };

  const STATUS = {
    PAYMENT_PENDING: "決済待ち",
    COOKING_WAIT: "調理待ち",
    READY: "完成",
    PICKED_UP: "受取済",
    CANCELED: "キャンセル"
  };

  const STATUS_FLOW = [
    STATUS.PAYMENT_PENDING,
    STATUS.COOKING_WAIT,
    STATUS.READY,
    STATUS.PICKED_UP
  ];

  const currencyFormatter = new Intl.NumberFormat("ja-JP");

  document.addEventListener("DOMContentLoaded", () => {
    applySharedUi();
    registerServiceWorker();

    const page = document.body.dataset.page;
    const pageBootMap = {
      order: bootOrderPage,
      customer: bootCustomerPage,
      cashier: bootCashierPage,
      handover: bootHandoverPage,
      admin: bootAdminPage,
      display: bootDisplayPage
    };

    if (pageBootMap[page]) {
      pageBootMap[page]();
    }
  });

  function applySharedUi(storeName) {
    const safeStoreName = storeName || APP_CONFIG.fallbackStoreName;
    document.querySelectorAll("[data-store-name]").forEach((node) => {
      node.textContent = safeStoreName;
    });

    const yearNode = document.getElementById("currentYear");
    if (yearNode) {
      yearNode.textContent = String(new Date().getFullYear());
    }
  }

  async function bootOrderPage() {
    const form = document.getElementById("orderForm");
    const productGrid = document.getElementById("productGrid");
    const slotGrid = document.getElementById("slotGrid");
    const slotNotice = document.getElementById("slotNotice");
    const orderMessage = document.getElementById("orderMessage");
    const publicNotice = document.getElementById("publicNotice");
    const nameInput = document.getElementById("customerName");
    const gradeInput = document.getElementById("customerGrade");
    const submitButton = document.getElementById("submitOrderButton");
    const totalAmountNode = document.getElementById("orderTotalAmount");
    const totalItemsNode = document.getElementById("orderTotalItems");
    const summaryListNode = document.getElementById("orderSummaryList");
    const selectedSlotLabelNode = document.getElementById("selectedSlotLabel");
    const paymentNoticeNode = document.getElementById("paymentNotice");
    const saleWindowPill = document.getElementById("saleWindowPill");
    const orderStatePill = document.getElementById("orderStatePill");
    const heroTitle = document.getElementById("heroTitle");
    const heroCopy = document.getElementById("heroCopy");
    const receiptPanel = document.getElementById("receiptPanel");
    const receiptOrderNumber = document.getElementById("receiptOrderNumber");
    const receiptStatus = document.getElementById("receiptStatus");
    const receiptSlotLabel = document.getElementById("receiptSlotLabel");
    const receiptCustomerLink = document.getElementById("receiptCustomerLink");
    const openCustomerPageButton = document.getElementById("openCustomerPageButton");
    const copyCustomerLinkButton = document.getElementById("copyCustomerLinkButton");

    const state = {
      config: null,
      quantities: {},
      selectedSlotId: "",
      hydratedDraft: false,
      slotsHintTone: "info"
    };

    renderStoredReceipt(loadLastOrder());

    productGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-delta]");
      if (!button || button.disabled || !state.config) {
        return;
      }

      const productId = button.dataset.productId;
      const delta = Number(button.dataset.delta);
      state.quantities[productId] = clampQuantity((state.quantities[productId] || 0) + delta);
      synchronizeSelectedSlot();
      renderOrderPage();
    });

    slotGrid.addEventListener("click", (event) => {
      const card = event.target.closest("[data-slot-id]");
      if (!card || !state.config) {
        return;
      }

      const selectedSlot = getSlotById(state.config.slots, card.dataset.slotId);
      const summary = collectOrderSummary(state.config.products, state.quantities);
      if (!selectedSlot || !canSlotFit(selectedSlot, summary.totalCount)) {
        return;
      }

      state.selectedSlotId = selectedSlot.id;
      state.slotsHintTone = "info";
      persistDraft();
      renderOrderPage();
    });

    nameInput.addEventListener("input", persistDraft);
    gradeInput.addEventListener("input", persistDraft);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage(orderMessage);

      if (!state.config) {
        setMessage(orderMessage, "設定の読み込みを待ってからお試しください。", "warn");
        return;
      }

      const payload = buildOrderPayload(nameInput.value, gradeInput.value, state.quantities, state.config.products);
      if (!payload.ok) {
        setMessage(orderMessage, payload.message, "error");
        return;
      }
      if (!state.selectedSlotId) {
        setMessage(orderMessage, "受取時間枠を選択してください。", "error");
        return;
      }

      try {
        setLoading(submitButton, true, "送信中...");
        const response = await requestApi("createOrder", {
          slotId: state.selectedSlotId,
          payload: toBase64Url(payload.data)
        });

        const receipt = {
          orderNumber: response.orderNumber,
          customerUrl: response.customerUrl,
          status: response.status,
          slotLabel: response.pickupSlot ? response.pickupSlot.label : "",
          updatedAt: response.updatedAt || new Date().toISOString()
        };

        saveLastOrder(receipt);
        renderStoredReceipt(receipt);
        Object.keys(state.quantities).forEach((productId) => {
          state.quantities[productId] = 0;
        });
        state.selectedSlotId = "";
        persistDraft();
        await loadConfig();
        if (response.slotAdjusted) {
          setMessage(orderMessage, "選んだ枠が埋まったため、次に空いている時間枠で予約しました。", "warn");
        } else {
          setMessage(orderMessage, "注文を保存しました。注文番号をスクリーンショットで保存してください。", "success");
        }
        receiptPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        setMessage(orderMessage, error.message, "error");
        await loadConfig();
      } finally {
        setLoading(submitButton, false);
      }
    });

    copyCustomerLinkButton.addEventListener("click", async () => {
      const url = openCustomerPageButton.getAttribute("href");
      if (!url || url === "#") {
        setMessage(orderMessage, "注文完了後に待機画面URLをコピーできます。", "warn");
        return;
      }

      try {
        await copyText(url);
        setMessage(orderMessage, "待機画面URLをコピーしました。", "success");
      } catch (error) {
        setMessage(orderMessage, "コピーできなかったため、画面下のURLを長押ししてください。", "warn");
      }
    });

    if (!hasApiConfig()) {
      setMessage(orderMessage, "Apps Script の WebアプリURLが未設定です。", "warn");
      setLoading(submitButton, false);
      submitButton.disabled = true;
      return;
    }

    await loadConfig();
    window.setInterval(() => {
      loadConfig(false);
    }, 30000);

    async function loadConfig(showError = true) {
      try {
        const config = await fetchPublicConfig();
        state.config = config;
        applySharedUi(config.storeName);
        heroTitle.textContent = config.heroTitle;
        heroCopy.textContent = config.heroMessage;
        saleWindowPill.textContent = `販売時間 ${config.saleWindowLabel}`;
        paymentNoticeNode.textContent = config.paymentMessage;
        renderOrderingState(config, publicNotice, orderStatePill);

        if (!state.hydratedDraft) {
          hydrateDraftState(config.products);
          state.hydratedDraft = true;
        } else {
          state.quantities = normalizeQuantities(config.products, state.quantities);
        }

        synchronizeSelectedSlot();
        renderOrderPage();
      } catch (error) {
        if (showError !== false) {
          setMessage(orderMessage, error.message, "error");
        }
      }
    }

    function hydrateDraftState(products) {
      const draft = loadOrderDraft();
      state.quantities = normalizeQuantities(products, draft && draft.quantities);
      state.selectedSlotId = draft && draft.selectedSlotId ? String(draft.selectedSlotId) : "";
      if (draft) {
        nameInput.value = draft.name || "";
        gradeInput.value = draft.grade || "";
      }
    }

    function synchronizeSelectedSlot() {
      if (!state.config) {
        return;
      }

      const summary = collectOrderSummary(state.config.products, state.quantities);
      const previousSlotId = state.selectedSlotId;
      const recommendedSlot = findRecommendedSlot(state.config.slots, summary.totalCount);
      const currentSlot = getSlotById(state.config.slots, state.selectedSlotId);

      if (!summary.totalCount) {
        state.selectedSlotId = "";
        state.slotsHintTone = "info";
      } else if (!currentSlot || !canSlotFit(currentSlot, summary.totalCount)) {
        state.selectedSlotId = recommendedSlot ? recommendedSlot.id : "";
        state.slotsHintTone = previousSlotId && recommendedSlot ? "warn" : "info";
      }

      persistDraft();
    }

    function renderOrderPage() {
      if (!state.config) {
        return;
      }

      const summary = collectOrderSummary(state.config.products, state.quantities);
      const currentSlot = getSlotById(state.config.slots, state.selectedSlotId);
      const recommendedSlot = findRecommendedSlot(state.config.slots, summary.totalCount);

      renderProductGrid(productGrid, state.config.products, state.quantities);
      renderSlotGrid(slotGrid, state.config.slots, summary.totalCount, state.selectedSlotId);
      renderSummaryCard(summary, totalAmountNode, totalItemsNode, summaryListNode);

      selectedSlotLabelNode.textContent = currentSlot
        ? `${currentSlot.label}（残り${currentSlot.remaining}個）`
        : "まだ選択されていません";

      renderSlotHint(summary.totalCount, currentSlot, recommendedSlot);

      const isOpen = Boolean(state.config.orderingState && state.config.orderingState.isOpen);
      submitButton.disabled = !isOpen || !summary.totalCount || !currentSlot;
    }

    function renderSlotHint(totalCount, currentSlot, recommendedSlot) {
      if (!totalCount) {
        setMessage(slotNotice, "商品を選ぶと、入れる時間枠を自動で案内します。", "info");
        return;
      }
      if (currentSlot) {
        const tone = state.slotsHintTone === "warn" ? "warn" : "success";
        setMessage(slotNotice, `${currentSlot.label} を案内中です。残り ${currentSlot.remaining} 個。`, tone);
        return;
      }
      if (recommendedSlot) {
        setMessage(slotNotice, `${recommendedSlot.label} が選べます。残り ${recommendedSlot.remaining} 個です。`, "info");
        return;
      }
      setMessage(slotNotice, "この個数を受け取れる時間枠がありません。数量を減らしてください。", "error");
    }

    function renderStoredReceipt(receipt) {
      if (!receipt || !receipt.orderNumber || !receipt.customerUrl) {
        receiptPanel.hidden = true;
        receiptCustomerLink.textContent = "-";
        openCustomerPageButton.setAttribute("href", "#");
        return;
      }

      receiptOrderNumber.textContent = receipt.orderNumber;
      receiptStatus.textContent = receipt.status || STATUS.PAYMENT_PENDING;
      receiptSlotLabel.textContent = receipt.slotLabel || "-";
      receiptCustomerLink.textContent = receipt.customerUrl;
      openCustomerPageButton.setAttribute("href", receipt.customerUrl);
      openCustomerPageButton.setAttribute("target", "_blank");
      openCustomerPageButton.setAttribute("rel", "noopener noreferrer");
      receiptPanel.hidden = false;
    }

    function persistDraft() {
      saveOrderDraft({
        name: nameInput.value,
        grade: gradeInput.value,
        selectedSlotId: state.selectedSlotId,
        quantities: state.quantities
      });
    }
  }

  async function bootCustomerPage() {
    const loadingCard = document.getElementById("customerLoadingCard");
    const errorCard = document.getElementById("customerErrorCard");
    const errorMessage = document.getElementById("customerErrorMessage");
    const view = document.getElementById("customerView");
    const heroStatus = document.getElementById("customerHeroStatus");
    const orderNumber = document.getElementById("customerOrderNumber");
    const statusBadge = document.getElementById("customerStatusBadge");
    const statusMessage = document.getElementById("customerStatusMessage");
    const updatedAt = document.getElementById("customerUpdatedAt");
    const slotLabel = document.getElementById("customerSlotLabel");
    const queueCount = document.getElementById("customerQueueCount");
    const totalAmount = document.getElementById("customerTotalAmount");
    const orderedAt = document.getElementById("customerOrderedAt");
    const summaryList = document.getElementById("customerSummaryList");
    const statusSteps = document.getElementById("customerStatusSteps");

    if (!hasApiConfig()) {
      showError("Apps Script の WebアプリURLが未設定です。");
      return;
    }

    const token = resolveCustomerToken();
    if (!token) {
      showError("注文URLにトークンがありません。注文完了画面から開き直してください。");
      return;
    }

    await loadOrder();
    window.setInterval(loadOrder, 5000);

    async function loadOrder() {
      try {
        const response = await requestApi("getCustomerOrder", { token });
        if (!response || !response.order || !response.order.orderNumber) {
          throw new Error("Apps Script 側が旧版です。最新の Code.gs を貼り付けて再デプロイしてください。");
        }
        applySharedUi(response.storeName);
        renderCustomerOrder(response);
        loadingCard.hidden = true;
        errorCard.hidden = true;
        view.hidden = false;
      } catch (error) {
        showError(error.message);
      }
    }

    function renderCustomerOrder(response) {
      const order = response.order;
      heroStatus.textContent = order.status;
      heroStatus.dataset.status = order.status;
      orderNumber.textContent = order.orderNumber;
      statusBadge.textContent = order.status;
      statusBadge.dataset.status = order.status;
      statusMessage.textContent = response.statusMessage || "";
      statusMessage.dataset.tone = order.status === STATUS.CANCELED ? "error" : order.status === STATUS.READY ? "success" : "info";
      updatedAt.textContent = `最終更新: ${formatDateTime(response.updatedAt)}`;
      slotLabel.textContent = order.slotLabel || "-";
      queueCount.textContent = `あと${Math.max(0, Number(response.groupsAhead) || 0)}組`;
      totalAmount.textContent = formatCurrency(order.totalAmount);
      orderedAt.textContent = formatDateTime(order.orderedAt);
      statusSteps.innerHTML = buildStatusStepsHtml(order.status);

      if (!order.items || !order.items.length) {
        summaryList.innerHTML = `<li class="empty-state">注文内容がありません</li>`;
      } else {
        summaryList.innerHTML = order.items
          .map((item) => {
            return `
              <li>
                <span>${escapeHtml(item.name)} × ${escapeHtml(String(item.qty))}</span>
                <strong>${formatCurrency(item.subtotal)}</strong>
              </li>
            `;
          })
          .join("");
      }
    }

    function showError(text) {
      loadingCard.hidden = true;
      view.hidden = true;
      errorMessage.textContent = text;
      errorCard.hidden = false;
    }
  }

  function bootCashierPage() {
    const messageNode = document.getElementById("cashierMessage");
    const searchInput = document.getElementById("cashierSearchInput");
    const refreshButton = document.getElementById("cashierRefreshButton");
    const statsNode = document.getElementById("cashierStats");
    const orderList = document.getElementById("cashierOrderList");
    const updatedAtNode = document.getElementById("cashierUpdatedAt");
    const state = { orders: [], stats: null };

    const auth = createOperationsAuth({
      onAuthenticated: loadDashboard,
      onUnauthorizedMessage: (text) => setMessage(messageNode, text, "warn")
    });

    searchInput.addEventListener("input", renderOrders);
    refreshButton.addEventListener("click", () => loadDashboard(false));

    orderList.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-status-action]");
      if (!button) {
        return;
      }

      try {
        setLoading(button, true, "更新中...");
        await requestApi("adminUpdateStatus", {
          sessionToken: auth.getSessionToken(),
          orderNumber: button.dataset.orderNumber,
          status: button.dataset.statusAction
        });
        setMessage(messageNode, `${button.dataset.orderNumber} を決済完了にしました。`, "success");
        await loadDashboard(false);
      } catch (error) {
        if (error.code === "UNAUTHORIZED") {
          auth.handleUnauthorized(error.message);
          return;
        }
        setMessage(messageNode, error.message, "error");
      } finally {
        setLoading(button, false);
      }
    });

    window.setInterval(() => {
      if (auth.getSessionToken()) {
        loadDashboard(false);
      }
    }, 10000);

    async function loadDashboard(showMessage = true) {
      try {
        const response = await requestApi("adminDashboard", {
          sessionToken: auth.getSessionToken()
        });
        if (!response || !Array.isArray(response.orders) || !response.stats) {
          throw new Error("Apps Script 側が旧版です。最新の Code.gs を貼り付けて再デプロイしてください。");
        }
        state.orders = response.orders || [];
        state.stats = response.stats || null;
        updatedAtNode.textContent = `最終更新: ${formatDateTime(response.updatedAt)}`;
        renderCashierStats(state.stats, statsNode);
        renderOrders();
        if (showMessage) {
          clearMessage(messageNode);
        }
      } catch (error) {
        if (error.code === "UNAUTHORIZED") {
          auth.handleUnauthorized(error.message);
          return;
        }
        setMessage(messageNode, error.message, "error");
      }
    }

    function renderOrders() {
      const keyword = searchInput.value.trim().toLowerCase();
      let orders = state.orders.slice().sort(compareOrdersByQueue);

      if (keyword) {
        orders = orders.filter((order) => buildOrderSearchText(order).includes(keyword));
      } else {
        orders = orders.filter((order) => order.status === STATUS.PAYMENT_PENDING);
      }

      if (!orders.length) {
        orderList.innerHTML = buildEmptyCardHtml("該当する注文がありません", "未決済注文が入るとここに表示されます。");
        return;
      }

      orderList.innerHTML = orders
        .map((order) => {
          const items = (order.items || [])
            .map((item) => `<li>${escapeHtml(item.name)} × ${escapeHtml(String(item.qty))}</li>`)
            .join("");
          const actionButton = order.status === STATUS.PAYMENT_PENDING
            ? `
              <button
                type="button"
                class="primary-button"
                data-order-number="${escapeHtml(order.orderNumber)}"
                data-status-action="${escapeHtml(STATUS.COOKING_WAIT)}"
              >
                決済完了
              </button>
            `
            : `<span class="status-pill" data-status="${escapeHtml(order.status)}">${escapeHtml(order.status)}</span>`;

          return `
            <article class="compact-order-card">
              <div class="compact-order-head">
                <h3>${escapeHtml(order.orderNumber)}</h3>
                <span class="mini-chip">${escapeHtml(order.slotLabel)}</span>
              </div>
              <ul class="simple-line-list">${items}</ul>
              <div class="metric-row">
                <strong>${formatCurrency(order.totalAmount)}</strong>
                ${actionButton}
              </div>
            </article>
          `;
        })
        .join("");
    }
  }

  function bootHandoverPage() {
    const messageNode = document.getElementById("handoverMessage");
    const searchInput = document.getElementById("handoverSearchInput");
    const refreshButton = document.getElementById("handoverRefreshButton");
    const statsNode = document.getElementById("handoverStats");
    const updatedAtNode = document.getElementById("handoverUpdatedAt");
    const cookingList = document.getElementById("handoverCookingList");
    const readyList = document.getElementById("handoverReadyList");
    const state = { orders: [], stats: null };

    const auth = createOperationsAuth({
      onAuthenticated: loadDashboard,
      onUnauthorizedMessage: (text) => setMessage(messageNode, text, "warn")
    });

    searchInput.addEventListener("input", renderLists);
    refreshButton.addEventListener("click", () => loadDashboard(false));

    [cookingList, readyList].forEach((container) => {
      container.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-status-action]");
        if (!button) {
          return;
        }

        try {
          setLoading(button, true, "更新中...");
          await requestApi("adminUpdateStatus", {
            sessionToken: auth.getSessionToken(),
            orderNumber: button.dataset.orderNumber,
            status: button.dataset.statusAction
          });
          setMessage(messageNode, `${button.dataset.orderNumber} を更新しました。`, "success");
          await loadDashboard(false);
        } catch (error) {
          if (error.code === "UNAUTHORIZED") {
            auth.handleUnauthorized(error.message);
            return;
          }
          setMessage(messageNode, error.message, "error");
        } finally {
          setLoading(button, false);
        }
      });
    });

    window.setInterval(() => {
      if (auth.getSessionToken()) {
        loadDashboard(false);
      }
    }, 8000);

    async function loadDashboard(showMessage = true) {
      try {
        const response = await requestApi("adminDashboard", {
          sessionToken: auth.getSessionToken()
        });
        if (!response || !Array.isArray(response.orders) || !response.stats) {
          throw new Error("Apps Script 側が旧版です。最新の Code.gs を貼り付けて再デプロイしてください。");
        }
        state.orders = response.orders || [];
        state.stats = response.stats || null;
        updatedAtNode.textContent = `最終更新: ${formatDateTime(response.updatedAt)}`;
        renderHandoverStats(state.stats, statsNode);
        renderLists();
        if (showMessage) {
          clearMessage(messageNode);
        }
      } catch (error) {
        if (error.code === "UNAUTHORIZED") {
          auth.handleUnauthorized(error.message);
          return;
        }
        setMessage(messageNode, error.message, "error");
      }
    }

    function renderLists() {
      const keyword = searchInput.value.trim().toLowerCase();
      const matchesKeyword = (order) => !keyword || buildOrderSearchText(order).includes(keyword);
      const cookingOrders = state.orders
        .filter((order) => order.status === STATUS.COOKING_WAIT && matchesKeyword(order))
        .sort(compareOrdersByQueue);
      const readyOrders = state.orders
        .filter((order) => order.status === STATUS.READY && matchesKeyword(order))
        .sort(compareOrdersByQueue);

      renderActionOrderList(cookingList, cookingOrders, STATUS.READY, "完成");
      renderActionOrderList(readyList, readyOrders, STATUS.PICKED_UP, "受取完了");
    }
  }

  function bootAdminPage() {
    const messageNode = document.getElementById("adminMessage");
    const searchInput = document.getElementById("adminSearchInput");
    const refreshButton = document.getElementById("adminRefreshButton");
    const statsNode = document.getElementById("adminStats");
    const slotStatsNode = document.getElementById("slotStatsList");
    const orderList = document.getElementById("adminOrderList");
    const cancelList = document.getElementById("adminCancelList");
    const updatedAtNode = document.getElementById("adminUpdatedAt");
    const acceptingStateLabel = document.getElementById("acceptingStateLabel");
    const soldOutStateLabel = document.getElementById("soldOutStateLabel");
    const stopOrdersButton = document.getElementById("stopOrdersButton");
    const resumeOrdersButton = document.getElementById("resumeOrdersButton");
    const markSoldOutButton = document.getElementById("markSoldOutButton");
    const clearSoldOutButton = document.getElementById("clearSoldOutButton");
    const announcementInput = document.getElementById("announcementInput");
    const saveAnnouncementButton = document.getElementById("saveAnnouncementButton");
    const sheetOpenLink = document.getElementById("sheetOpenLink");
    const state = { orders: [], stats: null, slotStats: [], operations: null };

    const auth = createOperationsAuth({
      onAuthenticated: loadDashboard,
      onUnauthorizedMessage: (text) => setMessage(messageNode, text, "warn")
    });

    searchInput.addEventListener("input", renderOrders);
    refreshButton.addEventListener("click", () => loadDashboard(false));

    stopOrdersButton.addEventListener("click", () => updateOperations({ acceptingOrders: "FALSE" }, "受付を停止しました。", stopOrdersButton));
    resumeOrdersButton.addEventListener("click", () => updateOperations({ acceptingOrders: "TRUE" }, "受付を再開しました。", resumeOrdersButton));
    markSoldOutButton.addEventListener("click", () => updateOperations({ soldOut: "TRUE" }, "完売表示に切り替えました。", markSoldOutButton));
    clearSoldOutButton.addEventListener("click", () => updateOperations({ soldOut: "FALSE" }, "完売表示を解除しました。", clearSoldOutButton));
    saveAnnouncementButton.addEventListener("click", () => updateOperations({ announcementMessage: announcementInput.value }, "案内メッセージを保存しました。", saveAnnouncementButton));

    orderList.addEventListener("click", (event) => handleStatusAction(event));
    cancelList.addEventListener("click", (event) => handleStatusAction(event));

    window.setInterval(() => {
      if (auth.getSessionToken()) {
        loadDashboard(false);
      }
    }, 10000);

    async function loadDashboard(showMessage = true) {
      try {
        const response = await requestApi("adminDashboard", {
          sessionToken: auth.getSessionToken()
        });
        if (!response || !Array.isArray(response.orders) || !response.stats || !Array.isArray(response.slotStats)) {
          throw new Error("Apps Script 側が旧版です。最新の Code.gs を貼り付けて再デプロイしてください。");
        }
        state.orders = response.orders || [];
        state.stats = response.stats || null;
        state.slotStats = response.slotStats || [];
        state.operations = response.operations || null;
        updatedAtNode.textContent = `最終更新: ${formatDateTime(response.updatedAt)}`;
        if (sheetOpenLink && response.spreadsheetUrl) {
          sheetOpenLink.href = response.spreadsheetUrl;
        }
        renderAdminStats(state.stats, statsNode);
        renderSlotStats(state.slotStats, slotStatsNode);
        renderOrders();
        renderOperations();
        if (showMessage) {
          clearMessage(messageNode);
        }
      } catch (error) {
        if (error.code === "UNAUTHORIZED") {
          auth.handleUnauthorized(error.message);
          return;
        }
        setMessage(messageNode, error.message, "error");
      }
    }

    async function updateOperations(params, successMessage, button) {
      try {
        setLoading(button, true, "保存中...");
        await requestApi("adminUpdateOperations", Object.assign({
          sessionToken: auth.getSessionToken()
        }, params));
        setMessage(messageNode, successMessage, "success");
        await loadDashboard(false);
      } catch (error) {
        if (error.code === "UNAUTHORIZED") {
          auth.handleUnauthorized(error.message);
          return;
        }
        setMessage(messageNode, error.message, "error");
      } finally {
        setLoading(button, false);
      }
    }

    async function handleStatusAction(event) {
      const button = event.target.closest("[data-status-action]");
      if (!button) {
        return;
      }

      try {
        setLoading(button, true, "更新中...");
        await requestApi("adminUpdateStatus", {
          sessionToken: auth.getSessionToken(),
          orderNumber: button.dataset.orderNumber,
          status: button.dataset.statusAction
        });
        setMessage(messageNode, `${button.dataset.orderNumber} を更新しました。`, "success");
        await loadDashboard(false);
      } catch (error) {
        if (error.code === "UNAUTHORIZED") {
          auth.handleUnauthorized(error.message);
          return;
        }
        setMessage(messageNode, error.message, "error");
      } finally {
        setLoading(button, false);
      }
    }

    function renderOperations() {
      const operations = state.operations || {};
      acceptingStateLabel.textContent = operations.acceptingOrders ? "受付中" : "停止中";
      soldOutStateLabel.textContent = operations.soldOut ? "完売" : "販売中";
      announcementInput.value = operations.announcementMessage || "";
    }

    function renderOrders() {
      const keyword = searchInput.value.trim().toLowerCase();
      const activeOrders = state.orders.filter((order) => order.status !== STATUS.CANCELED);
      const canceledOrders = state.orders.filter((order) => order.status === STATUS.CANCELED);
      const filteredActive = activeOrders.filter((order) => !keyword || buildOrderSearchText(order).includes(keyword));
      const filteredCanceled = canceledOrders.filter((order) => !keyword || buildOrderSearchText(order).includes(keyword));

      orderList.innerHTML = filteredActive.length
        ? filteredActive.map(renderAdminOrderCard).join("")
        : buildEmptyCardHtml("表示できる注文がありません", "条件を変えるか、再読み込みしてください。");

      cancelList.innerHTML = filteredCanceled.length
        ? filteredCanceled.map(renderAdminOrderCard).join("")
        : buildEmptyCardHtml("キャンセル注文はありません", "自動キャンセルや手動キャンセルがあるとここに表示されます。");
    }
  }

  async function bootDisplayPage() {
    const countNode = document.getElementById("displayCount");
    const updatedAtNode = document.getElementById("displayUpdatedAt");
    const messageNode = document.getElementById("displayMessage");
    const orderList = document.getElementById("displayOrderList");

    if (!hasApiConfig()) {
      setMessage(messageNode, "Apps Script の WebアプリURLを設定すると完成番号が表示されます。", "warn");
      return;
    }

    await loadDisplay();
    window.setInterval(loadDisplay, 5000);

    async function loadDisplay() {
      try {
        const response = await requestApi("displayReadyOrders");
        if (!response || !Array.isArray(response.orders)) {
          throw new Error("Apps Script 側が旧版です。最新の Code.gs を貼り付けて再デプロイしてください。");
        }
        applySharedUi(response.storeName);
        updatedAtNode.textContent = `最終更新 ${formatDateTime(response.updatedAt)}`;
        renderDisplayOrders(response.orders || []);
        clearMessage(messageNode);
      } catch (error) {
        setMessage(messageNode, error.message, "error");
      }
    }

    function renderDisplayOrders(orders) {
      countNode.textContent = `${orders.length}件`;
      if (!orders.length) {
        orderList.innerHTML = `
          <article class="display-empty">
            <div>
              <h2>ただいま呼び出し中の注文はありません</h2>
              <p>完成した注文番号がここに表示されます。</p>
            </div>
          </article>
        `;
        return;
      }

      orderList.innerHTML = orders
        .map((order) => {
          return `
            <article class="display-order-card">
              <strong class="display-number">${escapeHtml(order.orderNumber)}</strong>
            </article>
          `;
        })
        .join("");
    }
  }

  function createOperationsAuth(options) {
    const loginCard = document.getElementById("opsLoginCard");
    const loginForm = document.getElementById("opsLoginForm");
    const loginButton = document.getElementById("opsLoginButton");
    const passwordInput = document.getElementById("opsPassword");
    const loginMessage = document.getElementById("opsLoginMessage");
    const dashboard = document.getElementById("opsDashboard");
    const logoutButton = document.getElementById("opsLogoutButton");
    const state = {
      sessionToken: sessionStorage.getItem(STORAGE_KEYS.opsSession) || ""
    };

    if (!hasApiConfig()) {
      setMessage(loginMessage, "Apps Script の WebアプリURLが未設定です。", "warn");
    }

    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage(loginMessage);

      const password = passwordInput.value.trim();
      if (!password) {
        setMessage(loginMessage, "パスワードを入力してください。", "error");
        return;
      }

      try {
        setLoading(loginButton, true, "ログイン中...");
        const passwordHash = await sha256Hex(password);
        const response = await requestApi("adminLogin", { passwordHash });
        state.sessionToken = response.sessionToken;
        sessionStorage.setItem(STORAGE_KEYS.opsSession, response.sessionToken);
        passwordInput.value = "";
        showDashboard();
        if (typeof options.onAuthenticated === "function") {
          await options.onAuthenticated();
        }
      } catch (error) {
        setMessage(loginMessage, error.message, "error");
      } finally {
        setLoading(loginButton, false);
      }
    });

    logoutButton.addEventListener("click", () => {
      state.sessionToken = "";
      sessionStorage.removeItem(STORAGE_KEYS.opsSession);
      dashboard.hidden = true;
      loginCard.hidden = false;
      clearMessage(loginMessage);
    });

    if (state.sessionToken && hasApiConfig()) {
      showDashboard();
      window.setTimeout(() => {
        if (typeof options.onAuthenticated === "function") {
          options.onAuthenticated();
        }
      }, 0);
    }

    function showDashboard() {
      loginCard.hidden = true;
      dashboard.hidden = false;
    }

    return {
      getSessionToken() {
        return state.sessionToken;
      },
      handleUnauthorized(messageText) {
        state.sessionToken = "";
        sessionStorage.removeItem(STORAGE_KEYS.opsSession);
        dashboard.hidden = true;
        loginCard.hidden = false;
        setMessage(loginMessage, messageText || "セッションが切れました。再ログインしてください。", "warn");
        if (typeof options.onUnauthorizedMessage === "function") {
          options.onUnauthorizedMessage(messageText || "セッションが切れました。");
        }
      }
    };
  }

  function renderOrderingState(config, noticeNode, pillNode) {
    const orderingState = (config && config.orderingState) || {};
    if (!pillNode) {
      return;
    }

    if (orderingState.isOpen) {
      pillNode.textContent = "受付中";
      pillNode.dataset.ready = "true";
      if (config.announcementMessage) {
        setMessage(noticeNode, config.announcementMessage, "info");
      } else {
        clearMessage(noticeNode);
      }
      return;
    }

    pillNode.textContent = orderingState.mode === "sold_out" ? "完売" : "受付停止中";
    pillNode.dataset.ready = "false";
    setMessage(noticeNode, orderingState.message || "ただいま受付できません。", orderingState.mode === "sold_out" ? "warn" : "error");
  }

  function renderProductGrid(container, products, quantities) {
    container.innerHTML = products.length
      ? products
        .map((product) => {
          const qty = quantities[product.id] || 0;
          return `
            <article class="product-card ${qty > 0 ? "is-selected" : ""}">
              <div class="product-image-wrap">
                <img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}">
              </div>
              <div class="product-header">
                <div>
                  <h3>${escapeHtml(product.name)}</h3>
                  <p>${escapeHtml(product.description || "")}</p>
                </div>
                <span class="product-price">${formatCurrency(product.price)}</span>
              </div>
              <div class="qty-control">
                <button type="button" class="qty-button" data-product-id="${escapeHtml(product.id)}" data-delta="-1" aria-label="${escapeHtml(product.name)}を減らす">−</button>
                <div class="qty-value">${qty}</div>
                <button type="button" class="qty-button" data-product-id="${escapeHtml(product.id)}" data-delta="1" aria-label="${escapeHtml(product.name)}を増やす">＋</button>
              </div>
            </article>
          `;
        })
        .join("")
      : `<article class="panel-card centered-card"><p>商品設定がまだありません。</p></article>`;
  }

  function renderSlotGrid(container, slots, totalCount, selectedSlotId) {
    if (!slots.length) {
      container.innerHTML = `<article class="empty-card">時間枠が設定されていません。</article>`;
      return;
    }

    container.innerHTML = slots
      .map((slot) => {
        const fit = canSlotFit(slot, totalCount);
        const isSelected = selectedSlotId === slot.id;
        const isDisabled = totalCount > 0 ? !fit : false;
        return `
          <button
            type="button"
            class="slot-card ${isSelected ? "is-selected" : ""} ${isDisabled ? "is-disabled" : ""}"
            data-slot-id="${escapeHtml(slot.id)}"
            ${isDisabled ? "disabled" : ""}
          >
            <span class="slot-title">${escapeHtml(slot.label)}</span>
            <span class="slot-meta">残り ${escapeHtml(String(slot.remaining))} 個 / 上限 ${escapeHtml(String(slot.capacity))} 個</span>
            <span class="slot-note">${slot.remaining > 0 ? "この枠で受け取れます" : "空きなし"}</span>
          </button>
        `;
      })
      .join("");
  }

  function renderSummaryCard(summary, totalAmountNode, totalItemsNode, summaryListNode) {
    totalAmountNode.textContent = formatCurrency(summary.totalAmount);
    totalItemsNode.textContent = `${summary.totalCount}個`;

    if (!summary.items.length) {
      summaryListNode.innerHTML = `<li class="empty-state">まだ商品が選ばれていません</li>`;
      return;
    }

    summaryListNode.innerHTML = summary.items
      .map((item) => {
        return `
          <li>
            <span>${escapeHtml(item.name)} × ${escapeHtml(String(item.qty))}</span>
            <strong>${formatCurrency(item.subtotal)}</strong>
          </li>
        `;
      })
      .join("");
  }

  function renderCashierStats(stats, container) {
    if (!stats) {
      container.innerHTML = "";
      return;
    }

    const cards = [
      { label: "未決済", value: stats.pendingCount || 0 },
      { label: "調理待ち", value: stats.cookingCount || 0 },
      { label: "完成", value: stats.readyCount || 0 },
      { label: "決済済売上", value: formatCurrency(stats.paidRevenue || 0) }
    ];

    container.innerHTML = cards.map(renderStatCard).join("");
  }

  function renderHandoverStats(stats, container) {
    if (!stats) {
      container.innerHTML = "";
      return;
    }

    const cards = [
      { label: "調理待ち", value: stats.cookingCount || 0 },
      { label: "完成", value: stats.readyCount || 0 },
      { label: "受取済", value: stats.pickedUpCount || 0 },
      { label: "決済済数量", value: `${stats.paidQuantity || 0}個` }
    ];

    container.innerHTML = cards.map(renderStatCard).join("");
  }

  function renderAdminStats(stats, container) {
    if (!stats) {
      container.innerHTML = "";
      return;
    }

    const cards = [
      { label: "総注文", value: stats.totalOrders || 0 },
      { label: "決済済売上", value: formatCurrency(stats.paidRevenue || 0) },
      { label: "未決済", value: stats.pendingCount || 0 },
      { label: "完成", value: stats.readyCount || 0 },
      { label: "キャンセル", value: stats.canceledCount || 0 },
      { label: "販売数量", value: `${stats.totalQuantity || 0}個` }
    ];

    container.innerHTML = cards.map(renderStatCard).join("");
  }

  function renderSlotStats(slotStats, container) {
    if (!slotStats.length) {
      container.innerHTML = `<article class="empty-card">時間枠の設定がありません。</article>`;
      return;
    }

    container.innerHTML = slotStats
      .map((slot) => {
        return `
          <article class="slot-summary-card">
            <strong>${escapeHtml(slot.label)}</strong>
            <span>残り ${escapeHtml(String(slot.remaining))} 個</span>
            <span>予約中 ${escapeHtml(String(slot.reservedQuantity))} 個</span>
            <span>決済済 ${escapeHtml(String(slot.paidQuantity))} 個</span>
            <span>キャンセル ${escapeHtml(String(slot.canceledQuantity))} 個</span>
          </article>
        `;
      })
      .join("");
  }

  function renderActionOrderList(container, orders, actionStatus, actionLabel) {
    if (!orders.length) {
      container.innerHTML = buildEmptyCardHtml("該当する注文はありません", "新しい注文が入るとここに表示されます。");
      return;
    }

    container.innerHTML = orders
      .map((order) => {
        const items = (order.items || [])
          .map((item) => `<span class="line-item-pill">${escapeHtml(item.name)} × ${escapeHtml(String(item.qty))}</span>`)
          .join("");

        return `
          <article class="compact-order-card">
            <div class="compact-order-head">
              <h3>${escapeHtml(order.orderNumber)}</h3>
              <span class="mini-chip">${escapeHtml(order.slotLabel)}</span>
            </div>
            <div class="line-item-list">${items}</div>
            <div class="metric-row">
              <span>${formatCurrency(order.totalAmount)}</span>
              <button
                type="button"
                class="primary-button"
                data-order-number="${escapeHtml(order.orderNumber)}"
                data-status-action="${escapeHtml(actionStatus)}"
              >
                ${escapeHtml(actionLabel)}
              </button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderAdminOrderCard(order) {
    const items = (order.items || [])
      .map((item) => `<span class="line-item-pill">${escapeHtml(item.name)} × ${escapeHtml(String(item.qty))}</span>`)
      .join("");
    const actions = buildAdminActionButtons(order);

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
          <span>受取時間: ${escapeHtml(order.slotLabel)}</span>
          <span>数量: ${escapeHtml(String(order.totalCount))}個</span>
          <span>合計: ${formatCurrency(order.totalAmount)}</span>
          <span>注文: ${escapeHtml(formatDateTime(order.orderedAt))}</span>
        </div>
        <div class="line-item-list">${items}</div>
        ${actions ? `<div class="status-button-row">${actions}</div>` : ""}
      </article>
    `;
  }

  function buildAdminActionButtons(order) {
    if (order.status === STATUS.PAYMENT_PENDING) {
      return [
        buildStatusActionButton(order.orderNumber, STATUS.COOKING_WAIT, "決済完了"),
        buildStatusActionButton(order.orderNumber, STATUS.CANCELED, "キャンセル")
      ].join("");
    }
    if (order.status === STATUS.COOKING_WAIT) {
      return [
        buildStatusActionButton(order.orderNumber, STATUS.READY, "完成"),
        buildStatusActionButton(order.orderNumber, STATUS.CANCELED, "キャンセル")
      ].join("");
    }
    if (order.status === STATUS.READY) {
      return buildStatusActionButton(order.orderNumber, STATUS.PICKED_UP, "受取完了");
    }
    return "";
  }

  function buildStatusActionButton(orderNumber, status, label) {
    return `
      <button
        type="button"
        class="status-button"
        data-order-number="${escapeHtml(orderNumber)}"
        data-status-action="${escapeHtml(status)}"
      >
        ${escapeHtml(label)}
      </button>
    `;
  }

  function buildStatusStepsHtml(currentStatus) {
    if (currentStatus === STATUS.CANCELED) {
      return `
        <div class="status-step is-done"><span>1</span><strong>${escapeHtml(STATUS.PAYMENT_PENDING)}</strong></div>
        <div class="status-step is-canceled"><span>!</span><strong>${escapeHtml(STATUS.CANCELED)}</strong></div>
      `;
    }

    const currentIndex = STATUS_FLOW.indexOf(currentStatus);
    return STATUS_FLOW.map((status, index) => {
      const className = index < currentIndex ? "is-done" : index === currentIndex ? "is-current" : "";
      return `
        <div class="status-step ${className}">
          <span>${index + 1}</span>
          <strong>${escapeHtml(status)}</strong>
        </div>
      `;
    }).join("");
  }

  async function fetchPublicConfig() {
    const response = await requestApi("publicConfig");
    if (!response || !response.config || !Array.isArray(response.config.products) || !Array.isArray(response.config.slots)) {
      throw new Error("Apps Script 側が旧版です。最新の Code.gs を貼り付けて再デプロイしてください。");
    }
    return response.config;
  }

  function resolveCustomerToken() {
    const search = new URLSearchParams(window.location.search);
    const token = search.get("token");
    if (token) {
      return token;
    }

    const lastOrder = loadLastOrder();
    if (lastOrder && lastOrder.customerUrl) {
      try {
        return new URL(lastOrder.customerUrl).searchParams.get("token") || "";
      } catch (error) {
        return "";
      }
    }

    return "";
  }

  function findRecommendedSlot(slots, totalCount) {
    if (!totalCount) {
      return null;
    }
    return slots.find((slot) => canSlotFit(slot, totalCount)) || null;
  }

  function canSlotFit(slot, totalCount) {
    if (!slot || !totalCount) {
      return false;
    }
    return slot.remaining >= totalCount && new Date(slot.endAt).getTime() > Date.now();
  }

  function getSlotById(slots, slotId) {
    return (slots || []).find((slot) => slot.id === slotId) || null;
  }

  function normalizeQuantities(products, rawQuantities) {
    return products.reduce((result, product) => {
      result[product.id] = clampQuantity(rawQuantities && rawQuantities[product.id]);
      return result;
    }, {});
  }

  function buildOrderPayload(name, grade, quantities, products) {
    const trimmedName = String(name || "").trim();
    const trimmedGrade = String(grade || "").trim();
    const summary = collectOrderSummary(products, quantities);

    if (!trimmedName) {
      return { ok: false, message: "名前を入力してください。" };
    }
    if (trimmedName.length > 40) {
      return { ok: false, message: "名前は40文字以内で入力してください。" };
    }
    if (trimmedGrade.length > 20) {
      return { ok: false, message: "学年は20文字以内で入力してください。" };
    }
    if (!summary.items.length) {
      return { ok: false, message: "商品を1つ以上選んでください。" };
    }

    return {
      ok: true,
      data: {
        name: trimmedName,
        grade: trimmedGrade,
        items: summary.items.map((item) => ({
          id: item.id,
          qty: item.qty
        }))
      }
    };
  }

  function collectOrderSummary(products, quantities) {
    const items = [];
    let totalAmount = 0;
    let totalCount = 0;

    (products || []).forEach((product) => {
      const qty = clampQuantity(quantities && quantities[product.id]);
      if (!qty) {
        return;
      }

      const subtotal = product.price * qty;
      items.push({
        id: product.id,
        name: product.name,
        qty,
        price: product.price,
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

  function buildOrderSearchText(order) {
    return [
      order.orderNumber,
      order.name,
      order.grade,
      order.status,
      order.slotLabel,
      (order.items || []).map((item) => `${item.name} ${item.qty}`).join(" ")
    ]
      .join(" ")
      .toLowerCase();
  }

  function compareOrdersByQueue(a, b) {
    const slotDiff = new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime();
    if (slotDiff !== 0) {
      return slotDiff;
    }
    return orderNumberToInt(a.orderNumber) - orderNumberToInt(b.orderNumber);
  }

  async function requestApi(action, params) {
    if (!hasApiConfig()) {
      throw new Error("Apps Script の WebアプリURLが未設定です。");
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

  function saveOrderDraft(draft) {
    setStorageJson(STORAGE_KEYS.orderDraft, {
      name: String((draft && draft.name) || "").slice(0, 40),
      grade: String((draft && draft.grade) || "").slice(0, 20),
      selectedSlotId: String((draft && draft.selectedSlotId) || ""),
      quantities: Object.assign({}, draft && draft.quantities),
      updatedAt: new Date().toISOString()
    });
  }

  function loadOrderDraft() {
    const draft = getStorageJson(STORAGE_KEYS.orderDraft);
    if (!draft || typeof draft !== "object") {
      return null;
    }
    return {
      name: String(draft.name || ""),
      grade: String(draft.grade || ""),
      selectedSlotId: String(draft.selectedSlotId || ""),
      quantities: draft.quantities || {}
    };
  }

  function saveLastOrder(receipt) {
    setStorageJson(STORAGE_KEYS.lastOrder, receipt);
  }

  function loadLastOrder() {
    return getStorageJson(STORAGE_KEYS.lastOrder);
  }

  function setStorageJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      return;
    }
  }

  function getStorageJson(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function hasApiConfig() {
    return /^https:\/\/.+/i.test(APP_CONFIG.gasWebAppUrl);
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
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function clampQuantity(value) {
    return Math.max(0, Math.min(20, Number(value) || 0));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildEmptyCardHtml(title, body) {
    return `
      <article class="empty-card">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(body)}</p>
      </article>
    `;
  }

  function renderStatCard(entry) {
    return `
      <article class="stat-card">
        <span>${escapeHtml(entry.label)}</span>
        <strong>${escapeHtml(String(entry.value))}</strong>
      </article>
    `;
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

  function orderNumberToInt(value) {
    return Number(String(value || "").replace(/[^\d]/g, "")) || 0;
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        return;
      });
    });
  }
})();
