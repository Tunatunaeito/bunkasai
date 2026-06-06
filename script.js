(function () {
  const APP_CONFIG = {
    gasWebAppUrl: "https://script.google.com/macros/s/AKfycby5RqvOCMNI3C34NdgRIiLQ_tyvkNx_bzG_uuqbEJiGDcO8cIPK2gqe3FZbD4Z85FWJHw/exec",
    fallbackStoreName: "Un Deux Crois"
  };

  const STORAGE_KEYS = {
    opsSession: "festival_ops_session_token_v2",
    orderDraft: "festival_un_deux_crois_cart_v1",
    lastOrder: "festival_un_deux_crois_last_order_v1"
  };

  const STATUS = {
    ACCEPTED: "受付",
    COOKING: "調理中",
    READY: "完成",
    PICKED_UP: "受取済",
    CANCELED: "キャンセル"
  };

  const PAYMENT = {
    UNPAID: "未払い",
    PAID: "支払済"
  };

  const STATUS_FLOW = [STATUS.ACCEPTED, STATUS.COOKING, STATUS.READY, STATUS.PICKED_UP];
  const currencyFormatter = new Intl.NumberFormat("ja-JP");
  const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  document.addEventListener("DOMContentLoaded", () => {
    applySharedUi();
    registerServiceWorker();

    const page = document.body.dataset.page;
    const pageBootMap = {
      order: bootOrderPage,
      customer: bootCustomerPage,
      cashier: bootCashierPage,
      handover: bootKitchenPage,
      kitchen: bootKitchenPage,
      admin: bootAdminPage,
      display: bootDisplayPage
    };

    if (pageBootMap[page]) {
      pageBootMap[page]();
    }
  });

  async function bootOrderPage() {
    const productGrid = document.getElementById("productGrid");
    const cartList = document.getElementById("cartList");
    const orderMessage = document.getElementById("orderMessage");
    const publicNotice = document.getElementById("publicNotice");
    const submitOrderButton = document.getElementById("submitOrderButton");
    const clearCartButton = document.getElementById("clearCartButton");
    const totalAmountNode = document.getElementById("orderTotalAmount");
    const totalItemsNode = document.getElementById("orderTotalItems");
    const paymentNoticeNode = document.getElementById("paymentNotice");
    const saleWindowPill = document.getElementById("saleWindowPill");
    const orderStatePill = document.getElementById("orderStatePill");
    const heroTitle = document.getElementById("heroTitle");
    const heroCopy = document.getElementById("heroCopy");
    const receiptPanel = document.getElementById("receiptPanel");
    const receiptOrderNumber = document.getElementById("receiptOrderNumber");
    const receiptStatus = document.getElementById("receiptStatus");
    const receiptPaymentStatus = document.getElementById("receiptPaymentStatus");
    const receiptCustomerLink = document.getElementById("receiptCustomerLink");
    const openCustomerPageButton = document.getElementById("openCustomerPageButton");
    const copyCustomerLinkButton = document.getElementById("copyCustomerLinkButton");

    const modal = document.getElementById("configuratorModal");
    const modalTitle = document.getElementById("configuratorTitle");
    const modalDescription = document.getElementById("configuratorDescription");
    const modalMessage = document.getElementById("configuratorMessage");
    const modalForm = document.getElementById("configuratorForm");
    const modalFields = document.getElementById("configuratorFields");
    const modalSubmitButton = document.getElementById("configuratorSubmitButton");

    const state = {
      config: null,
      cart: loadDraftCart(),
      activeProductId: "",
      editingUid: "",
      refreshing: false
    };

    renderStoredReceipt(loadLastOrder());

    productGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-open-product]");
      if (!button || !state.config) {
        return;
      }
      const product = findProduct(state.config.products, button.dataset.openProduct);
      if (!product || !state.config.orderingEnabled) {
        return;
      }
      openConfigurator(product);
    });

    cartList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-cart-action]");
      if (!button) {
        return;
      }
      const line = findCartLine(state.cart, button.dataset.uid);
      if (!line) {
        return;
      }
      const action = button.dataset.cartAction;
      if (action === "inc") {
        line.qty = clampQuantity(line.qty + 1);
      } else if (action === "dec") {
        line.qty -= 1;
        if (line.qty <= 0) {
          state.cart = state.cart.filter((item) => item.uid !== line.uid);
        }
      } else if (action === "remove") {
        state.cart = state.cart.filter((item) => item.uid !== line.uid);
      } else if (action === "edit") {
        const product = findProduct(state.config.products, line.productId);
        if (product) {
          openConfigurator(product, line);
          return;
        }
      }
      state.cart = mergeCartLines(normalizeCartWithProducts(state.cart, state.config ? state.config.products : []));
      persistDraftCart(state.cart);
      renderOrderState();
    });

    clearCartButton.addEventListener("click", () => {
      state.cart = [];
      persistDraftCart(state.cart);
      renderOrderState();
    });

    submitOrderButton.addEventListener("click", async () => {
      clearMessage(orderMessage);

      if (!state.config) {
        setMessage(orderMessage, "設定の読み込みが終わってからお試しください。", "warn");
        return;
      }
      if (!state.config.orderingEnabled) {
        setMessage(orderMessage, state.config.orderingStateMessage || "現在は注文できません。", "warn");
        return;
      }
      if (!state.cart.length) {
        setMessage(orderMessage, "商品を1つ以上カートに入れてください。", "warn");
        return;
      }

      const payload = {
        lines: state.cart.map((line) => ({
          productId: line.productId,
          qty: line.qty,
          configuration: line.configuration
        }))
      };

      try {
        setLoading(submitOrderButton, true, "送信中...");
        const response = await requestApi("createOrder", {
          payload: toBase64Url(payload)
        }, { method: "POST" });

        const receipt = {
          orderNumber: response.orderNumber,
          token: response.token,
          customerUrl: response.customerUrl,
          status: response.status,
          paymentStatus: response.paymentStatus,
          orderedAt: response.orderedAt
        };
        saveLastOrder(receipt);
        renderStoredReceipt(receipt);
        state.cart = [];
        persistDraftCart(state.cart);
        renderOrderState();
        setMessage(orderMessage, "注文番号を発行しました。スクリーンショット保存がおすすめです。", "success");
        receiptPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        setMessage(orderMessage, error.message, "error");
      } finally {
        setLoading(submitOrderButton, false);
      }
    });

    modalForm.addEventListener("submit", (event) => {
      event.preventDefault();
      clearMessage(modalMessage);

      if (!state.config) {
        return;
      }
      const product = findProduct(state.config.products, state.activeProductId);
      if (!product) {
        return;
      }

      try {
        const nextLine = buildCartLineFromForm(product, modalForm, state.editingUid);
        let nextCart = state.cart.slice();
        if (state.editingUid) {
          nextCart = nextCart.filter((line) => line.uid !== state.editingUid);
        }
        nextCart.push(nextLine);
        state.cart = mergeCartLines(normalizeCartWithProducts(nextCart, state.config.products));
        persistDraftCart(state.cart);
        closeConfigurator();
        renderOrderState();
      } catch (error) {
        setMessage(modalMessage, error.message, "error");
      }
    });

    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-modal]")) {
        closeConfigurator();
      }
    });

    copyCustomerLinkButton.addEventListener("click", async () => {
      const link = openCustomerPageButton.getAttribute("href");
      if (!link || link === "./customer.html") {
        setMessage(orderMessage, "注文完了後にURLをコピーできます。", "warn");
        return;
      }
      try {
        await copyText(link);
        setMessage(orderMessage, "待機画面URLをコピーしました。", "success");
      } catch (error) {
        setMessage(orderMessage, "コピーできなかったため、URLを長押しで共有してください。", "warn");
      }
    });

    if (!hasApiConfig()) {
      setMessage(orderMessage, "Apps Script の WebアプリURLが未設定です。", "warn");
      submitOrderButton.disabled = true;
      return;
    }

    await loadConfig();
    window.setInterval(() => {
      loadConfig(false);
    }, 45000);

    function openConfigurator(product, existingLine) {
      state.activeProductId = product.productId;
      state.editingUid = existingLine ? existingLine.uid : "";
      modalTitle.textContent = existingLine ? `${product.name} を編集` : product.name;
      modalDescription.textContent = product.description || "内容を選んでカートに追加します。";
      modalSubmitButton.textContent = existingLine ? "内容を更新" : "カートに追加";
      modalFields.innerHTML = renderConfiguratorFields(product, existingLine);
      clearMessage(modalMessage);
      modal.hidden = false;
    }

    function closeConfigurator() {
      state.activeProductId = "";
      state.editingUid = "";
      modal.hidden = true;
      modalForm.reset();
      clearMessage(modalMessage);
    }

    async function loadConfig(showErrors = true) {
      if (state.refreshing) {
        return;
      }
      state.refreshing = true;
      try {
        const config = await requestApi("publicConfig");
        if (!Array.isArray(config.products)) {
          throw new Error("Apps Script 側が旧版です。最新の Code.gs を貼り付けて再デプロイしてください。");
        }
        state.config = config;
        applySharedUi(config.storeName);
        heroTitle.textContent = config.heroTitle;
        heroCopy.textContent = config.heroMessage;
        saleWindowPill.textContent = config.isTestMode ? `${config.saleWindowLabel} / テスト中` : config.saleWindowLabel;
        paymentNoticeNode.textContent = config.paymentMessage;
        state.cart = mergeCartLines(normalizeCartWithProducts(state.cart, config.products));
        persistDraftCart(state.cart);
        renderOrderingState(config, publicNotice, orderStatePill);
        renderOrderState();
      } catch (error) {
        if (showErrors) {
          setMessage(orderMessage, error.message, "error");
        }
      } finally {
        state.refreshing = false;
      }
    }

    function renderOrderState() {
      const products = state.config ? state.config.products : [];
      const summary = getCartSummary(state.cart);
      totalAmountNode.textContent = formatCurrency(summary.totalAmount);
      totalItemsNode.textContent = `${summary.totalQty}点`;
      submitOrderButton.disabled = !state.config || !state.config.orderingEnabled || !state.cart.length;
      renderProductGrid(productGrid, products, state.config && state.config.orderingEnabled);
      renderCartList(cartList, state.cart, products);
    }

    function renderStoredReceipt(receipt) {
      if (!receipt) {
        receiptPanel.hidden = true;
        return;
      }
      receiptOrderNumber.textContent = receipt.orderNumber || "A000";
      receiptStatus.textContent = receipt.status || STATUS.ACCEPTED;
      receiptPaymentStatus.textContent = receipt.paymentStatus || PAYMENT.UNPAID;
      receiptCustomerLink.textContent = receipt.customerUrl || "-";
      openCustomerPageButton.href = receipt.customerUrl || "./customer.html";
      receiptPanel.hidden = false;
    }
  }

  async function bootCustomerPage() {
    const loadingCard = document.getElementById("customerLoadingCard");
    const errorCard = document.getElementById("customerErrorCard");
    const errorMessage = document.getElementById("customerErrorMessage");
    const customerView = document.getElementById("customerView");
    const heroStatus = document.getElementById("customerHeroStatus");
    const orderNumberNode = document.getElementById("customerOrderNumber");
    const statusBadge = document.getElementById("customerStatusBadge");
    const paymentBadge = document.getElementById("customerPaymentBadge");
    const paymentStatusNode = document.getElementById("customerPaymentStatus");
    const statusMessage = document.getElementById("customerStatusMessage");
    const updatedAtNode = document.getElementById("customerUpdatedAt");
    const queueNode = document.getElementById("customerQueueCount");
    const totalAmountNode = document.getElementById("customerTotalAmount");
    const orderedAtNode = document.getElementById("customerOrderedAt");
    const summaryListNode = document.getElementById("customerSummaryList");
    const stepsNode = document.getElementById("customerStatusSteps");

    const storedOrder = loadLastOrder();
    const query = new URLSearchParams(window.location.search);
    const token = query.get("token") || (storedOrder && storedOrder.token) || extractTokenFromUrl(storedOrder && storedOrder.customerUrl);

    if (!token) {
      showError("注文トークンが見つかりません。注文完了画面から開いてください。");
      return;
    }

    await loadCustomerOrder();
    window.setInterval(loadCustomerOrder, 10000);

    async function loadCustomerOrder() {
      try {
        const response = await requestApi("getCustomerOrder", { token: token });
        const order = response.order;
        loadingCard.hidden = true;
        errorCard.hidden = true;
        customerView.hidden = false;
        applySharedUi();
        orderNumberNode.textContent = order.orderNumber;
        statusBadge.textContent = order.status;
        statusBadge.dataset.status = order.status;
        paymentBadge.textContent = order.paymentStatus;
        paymentBadge.dataset.status = order.paymentStatus;
        paymentStatusNode.textContent = order.paymentStatus;
        heroStatus.textContent = order.status;
        statusMessage.textContent = order.statusMessage;
        updatedAtNode.textContent = `更新: ${order.updatedAtLabel}`;
        queueNode.textContent = `あと${order.aheadCount}組`;
        totalAmountNode.textContent = formatCurrency(order.totalAmount);
        orderedAtNode.textContent = order.orderedAtLabel;
        renderSummaryItems(summaryListNode, order.items);
        renderStatusSteps(stepsNode, order.status);
      } catch (error) {
        showError(error.message);
      }
    }

    function showError(message) {
      loadingCard.hidden = true;
      customerView.hidden = true;
      errorCard.hidden = false;
      errorMessage.textContent = message;
      heroStatus.textContent = "確認できません";
    }
  }

  async function bootCashierPage() {
    const searchInput = document.getElementById("cashierSearchInput");
    const refreshButton = document.getElementById("cashierRefreshButton");
    const messageNode = document.getElementById("cashierMessage");
    const statsNode = document.getElementById("cashierStats");
    const updatedAtNode = document.getElementById("cashierUpdatedAt");
    const orderListNode = document.getElementById("cashierOrderList");
    let latestDashboard = null;

    const ops = initOpsAccess(loadDashboard);

    searchInput.addEventListener("input", () => {
      if (!latestDashboard) {
        return;
      }
      renderCashier(latestDashboard);
    });

    refreshButton.addEventListener("click", () => {
      ops.refresh();
    });

    orderListNode.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-payment-toggle]");
      if (!button) {
        return;
      }
      try {
        await requestApi("updatePayment", {
          sessionToken: ops.getSessionToken(),
          orderNumber: button.dataset.orderNumber,
          paymentStatus: button.dataset.paymentToggle
        }, { method: "POST" });
        setMessage(messageNode, "支払い状況を更新しました。", "success");
        await ops.refresh();
      } catch (error) {
        setMessage(messageNode, error.message, "error");
      }
    });

    function loadDashboard() {
      return requestApi("adminDashboard", {
        sessionToken: ops.getSessionToken()
      }).then((dashboard) => {
        latestDashboard = dashboard;
        renderCashier(dashboard);
      }).catch((error) => {
        if (isSessionError(error)) {
          ops.logout("ログインし直してください。");
          return;
        }
        setMessage(messageNode, error.message, "error");
      });
    }

    function renderCashier(dashboard) {
      updatedAtNode.textContent = `最終更新: ${formatDateTime(dashboard.updatedAt)}`;
      renderStats(statsNode, [
        { label: "未払い", value: `${dashboard.stats.unpaidCount}件` },
        { label: "支払済", value: `${dashboard.stats.paidCount}件` },
        { label: "売上", value: formatCurrency(dashboard.stats.salesTotal) }
      ]);

      const search = normalizeSearch(searchInput.value);
      const orders = (search ? dashboard.orders : dashboard.orders.filter((order) =>
        order.paymentStatus === PAYMENT.UNPAID && order.status !== STATUS.CANCELED
      ));

      if (!orders.length) {
        orderListNode.innerHTML = createEmptyCard("会計待ちの注文はありません。");
        return;
      }

      orderListNode.innerHTML = orders.map((order) => `
        <article class="compact-order-card">
          <div class="compact-order-head">
            <h3>${escapeHtml(order.orderNumber)}</h3>
            <span class="status-pill" data-status="${escapeHtml(order.paymentStatus)}">${escapeHtml(order.paymentStatus)}</span>
          </div>
          <ul class="simple-line-list">
            ${order.items.map((item) => `<li>${escapeHtml(item.summaryLabel)} ×${item.qty}</li>`).join("")}
          </ul>
          <div class="metric-row">
            <strong>${formatCurrency(order.totalAmount)}</strong>
            <button class="primary-button" type="button" data-order-number="${escapeHtml(order.orderNumber)}" data-payment-toggle="${order.paymentStatus === PAYMENT.PAID ? PAYMENT.UNPAID : PAYMENT.PAID}">
              ${order.paymentStatus === PAYMENT.PAID ? "未払いに戻す" : "決済完了"}
            </button>
          </div>
        </article>
      `).join("");
    }
  }

  async function bootKitchenPage() {
    const searchInput = document.getElementById("kitchenSearchInput");
    const refreshButton = document.getElementById("kitchenRefreshButton");
    const messageNode = document.getElementById("kitchenMessage");
    const statsNode = document.getElementById("kitchenStats");
    const updatedAtNode = document.getElementById("kitchenUpdatedAt");
    const orderListNode = document.getElementById("kitchenOrderList");
    let latestDashboard = null;

    const ops = initOpsAccess(loadDashboard);

    searchInput.addEventListener("input", () => {
      if (latestDashboard) {
        renderKitchen(latestDashboard);
      }
    });

    refreshButton.addEventListener("click", () => {
      ops.refresh();
    });

    orderListNode.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-next-status]");
      if (!button) {
        return;
      }
      try {
        await requestApi("updateStatus", {
          sessionToken: ops.getSessionToken(),
          orderNumber: button.dataset.orderNumber,
          status: button.dataset.nextStatus
        }, { method: "POST" });
        setMessage(messageNode, "ステータスを更新しました。", "success");
        await ops.refresh();
      } catch (error) {
        setMessage(messageNode, error.message, "error");
      }
    });

    function loadDashboard() {
      return requestApi("adminDashboard", {
        sessionToken: ops.getSessionToken()
      }).then((dashboard) => {
        latestDashboard = dashboard;
        renderKitchen(dashboard);
      }).catch((error) => {
        if (isSessionError(error)) {
          ops.logout("ログインし直してください。");
          return;
        }
        setMessage(messageNode, error.message, "error");
      });
    }

    function renderKitchen(dashboard) {
      updatedAtNode.textContent = `最終更新: ${formatDateTime(dashboard.updatedAt)}`;
      renderStats(statsNode, [
        { label: "受付", value: `${dashboard.orders.filter((order) => order.status === STATUS.ACCEPTED).length}件` },
        { label: "調理中", value: `${dashboard.stats.cookingCount}件` },
        { label: "完成", value: `${dashboard.stats.readyCount}件` }
      ]);

      const search = normalizeSearch(searchInput.value);
      const orders = (search ? dashboard.orders : dashboard.orders.filter((order) =>
        order.status !== STATUS.PICKED_UP && order.status !== STATUS.CANCELED
      ));

      if (!orders.length) {
        orderListNode.innerHTML = createEmptyCard("表示する注文はありません。");
        return;
      }

      orderListNode.innerHTML = orders.map((order) => {
        const next = getKitchenAction(order);
        return `
          <article class="admin-order-card">
            <div class="admin-order-head">
              <h3>${escapeHtml(order.orderNumber)}</h3>
              <div class="button-row">
                <span class="status-pill" data-status="${escapeHtml(order.status)}">${escapeHtml(order.status)}</span>
                <span class="status-pill" data-status="${escapeHtml(order.paymentStatus)}">${escapeHtml(order.paymentStatus)}</span>
              </div>
            </div>
            <div class="admin-order-meta">
              <span>注文時刻: ${escapeHtml(order.orderedAtLabel)}</span>
              <span>合計: ${formatCurrency(order.totalAmount)}</span>
            </div>
            <ul class="simple-line-list">
              ${order.items.map((item) => `<li>${escapeHtml(item.summaryLabel)} ×${item.qty}</li>`).join("")}
            </ul>
            <div class="metric-row">
              <span>${escapeHtml(next.note)}</span>
              <button class="${next.disabled ? "ghost-button" : "primary-button"}" type="button" ${next.disabled ? "disabled" : ""} data-order-number="${escapeHtml(order.orderNumber)}" data-next-status="${escapeHtml(next.status)}">
                ${escapeHtml(next.label)}
              </button>
            </div>
          </article>
        `;
      }).join("");
    }
  }

  async function bootAdminPage() {
    const searchInput = document.getElementById("adminSearchInput");
    const refreshButton = document.getElementById("adminRefreshButton");
    const messageNode = document.getElementById("adminMessage");
    const statsNode = document.getElementById("adminStats");
    const updatedAtNode = document.getElementById("adminUpdatedAt");
    const orderListNode = document.getElementById("adminOrderList");
    const cancelListNode = document.getElementById("adminCancelList");
    const toggleOrderingButton = document.getElementById("toggleOrderingButton");
    const toggleTestModeButton = document.getElementById("toggleTestModeButton");
    const saveOperationsButton = document.getElementById("saveOperationsButton");
    const acceptingStateLabel = document.getElementById("acceptingStateLabel");
    const testModeStateLabel = document.getElementById("testModeStateLabel");
    const announcementInput = document.getElementById("announcementInput");
    const heroMessageInput = document.getElementById("heroMessageInput");
    const orderEndTimeInput = document.getElementById("orderEndTimeInput");
    const specialCroffleInput = document.getElementById("specialCroffleInput");
    const sheetOpenLink = document.getElementById("sheetOpenLink");

    let latestDashboard = null;

    const ops = initOpsAccess(loadDashboard);

    searchInput.addEventListener("input", () => {
      if (latestDashboard) {
        renderAdmin(latestDashboard);
      }
    });

    refreshButton.addEventListener("click", () => {
      ops.refresh();
    });

    toggleOrderingButton.addEventListener("click", async () => {
      if (!latestDashboard) {
        return;
      }
      try {
        await requestApi("updateOperations", {
          sessionToken: ops.getSessionToken(),
          orderingEnabled: String(!latestDashboard.settings.orderingEnabledBySwitch)
        }, { method: "POST" });
        setMessage(messageNode, "受付状態を更新しました。", "success");
        await ops.refresh();
      } catch (error) {
        setMessage(messageNode, error.message, "error");
      }
    });

    toggleTestModeButton.addEventListener("click", async () => {
      if (!latestDashboard) {
        return;
      }
      try {
        await requestApi("updateOperations", {
          sessionToken: ops.getSessionToken(),
          testMode: String(!latestDashboard.settings.isTestMode)
        }, { method: "POST" });
        setMessage(messageNode, "テストモードを更新しました。", "success");
        await ops.refresh();
      } catch (error) {
        setMessage(messageNode, error.message, "error");
      }
    });

    saveOperationsButton.addEventListener("click", async () => {
      try {
        setLoading(saveOperationsButton, true, "保存中...");
        await requestApi("updateOperations", {
          sessionToken: ops.getSessionToken(),
          announcementMessage: announcementInput.value,
          heroMessage: heroMessageInput.value,
          orderEndTime: orderEndTimeInput.value,
          specialCroffleLabel: specialCroffleInput.value
        }, { method: "POST" });
        setMessage(messageNode, "設定を保存しました。", "success");
        await ops.refresh();
      } catch (error) {
        setMessage(messageNode, error.message, "error");
      } finally {
        setLoading(saveOperationsButton, false);
      }
    });

    orderListNode.addEventListener("click", handleOrderAction);
    cancelListNode.addEventListener("click", handleOrderAction);

    function handleOrderAction(event) {
      const statusButton = event.target.closest("[data-status-update]");
      const paymentButton = event.target.closest("[data-payment-toggle]");

      if (statusButton) {
        requestApi("updateStatus", {
          sessionToken: ops.getSessionToken(),
          orderNumber: statusButton.dataset.orderNumber,
          status: statusButton.dataset.statusUpdate
        }, { method: "POST" }).then(() => {
          setMessage(messageNode, "ステータスを更新しました。", "success");
          return ops.refresh();
        }).catch((error) => {
          setMessage(messageNode, error.message, "error");
        });
      }

      if (paymentButton) {
        requestApi("updatePayment", {
          sessionToken: ops.getSessionToken(),
          orderNumber: paymentButton.dataset.orderNumber,
          paymentStatus: paymentButton.dataset.paymentToggle
        }, { method: "POST" }).then(() => {
          setMessage(messageNode, "支払い状況を更新しました。", "success");
          return ops.refresh();
        }).catch((error) => {
          setMessage(messageNode, error.message, "error");
        });
      }
    }

    function loadDashboard() {
      return requestApi("adminDashboard", {
        sessionToken: ops.getSessionToken()
      }).then((dashboard) => {
        latestDashboard = dashboard;
        renderAdmin(dashboard);
      }).catch((error) => {
        if (isSessionError(error)) {
          ops.logout("ログインし直してください。");
          return;
        }
        setMessage(messageNode, error.message, "error");
      });
    }

    function renderAdmin(dashboard) {
      updatedAtNode.textContent = `最終更新: ${formatDateTime(dashboard.updatedAt)}`;
      renderStats(statsNode, [
        { label: "総注文", value: `${dashboard.stats.totalOrders}件` },
        { label: "未払い", value: `${dashboard.stats.unpaidCount}件` },
        { label: "支払済", value: `${dashboard.stats.paidCount}件` },
        { label: "調理中", value: `${dashboard.stats.cookingCount}件` },
        { label: "完成", value: `${dashboard.stats.readyCount}件` },
        { label: "売上", value: formatCurrency(dashboard.stats.salesTotal) }
      ]);

      acceptingStateLabel.textContent = dashboard.settings.orderingStateLabel;
      testModeStateLabel.textContent = dashboard.settings.isTestMode ? "ON" : "OFF";
      announcementInput.value = dashboard.settings.announcementMessage || "";
      heroMessageInput.value = dashboard.settings.heroMessage || "";
      orderEndTimeInput.value = extractTimePart(dashboard.settings.saleWindowLabel);
      specialCroffleInput.value = dashboard.settings.specialCroffleLabel || "";
      sheetOpenLink.href = dashboard.settings.sheetUrl || "#";

      const search = normalizeSearch(searchInput.value);
      const activeOrders = (search ? dashboard.orders : dashboard.orders.filter((order) => order.status !== STATUS.CANCELED));
      const canceledOrders = search ? dashboard.canceledOrders : dashboard.canceledOrders;

      orderListNode.innerHTML = activeOrders.length
        ? activeOrders.map(renderAdminOrderCard).join("")
        : createEmptyCard("表示する注文はありません。");
      cancelListNode.innerHTML = canceledOrders.length
        ? canceledOrders.map(renderAdminOrderCard).join("")
        : createEmptyCard("キャンセル注文はありません。");
    }
  }

  async function bootDisplayPage() {
    const updatedAtNode = document.getElementById("displayUpdatedAt");
    const countNode = document.getElementById("displayCount");
    const messageNode = document.getElementById("displayMessage");
    const listNode = document.getElementById("displayOrderList");

    await loadDisplay();
    window.setInterval(loadDisplay, 5000);

    async function loadDisplay() {
      try {
        const response = await requestApi("displayReadyOrders");
        updatedAtNode.textContent = formatDateTime(response.updatedAt);
        countNode.textContent = `${response.orders.length}件`;
        clearMessage(messageNode);
        if (!response.orders.length) {
          listNode.innerHTML = '<div class="display-empty"><p>完成した注文番号がここに表示されます。</p></div>';
          return;
        }
        listNode.innerHTML = response.orders.map((order) => `
          <article class="display-order-card">
            <p class="display-number">${escapeHtml(order.orderNumber)}</p>
          </article>
        `).join("");
      } catch (error) {
        listNode.innerHTML = "";
        setMessage(messageNode, error.message, "error");
      }
    }
  }

  function initOpsAccess(loadDashboard) {
    const loginCard = document.getElementById("opsLoginCard");
    const dashboard = document.getElementById("opsDashboard");
    const loginForm = document.getElementById("opsLoginForm");
    const passwordInput = document.getElementById("opsPassword");
    const loginButton = document.getElementById("opsLoginButton");
    const loginMessage = document.getElementById("opsLoginMessage");
    const logoutButtons = document.querySelectorAll("[data-logout]");
    let sessionToken = loadOpsSession();

    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage(loginMessage);
      if (!passwordInput.value.trim()) {
        setMessage(loginMessage, "パスワードを入力してください。", "warn");
        return;
      }
      try {
        setLoading(loginButton, true, "ログイン中...");
        const response = await requestApi("adminLogin", {
          password: passwordInput.value
        }, { method: "POST" });
        sessionToken = response.sessionToken;
        saveOpsSession(sessionToken);
        passwordInput.value = "";
        showDashboard();
        await loadDashboard();
      } catch (error) {
        setMessage(loginMessage, error.message, "error");
      } finally {
        setLoading(loginButton, false);
      }
    });

    logoutButtons.forEach((button) => {
      button.addEventListener("click", () => {
        logout();
      });
    });

    if (sessionToken) {
      showDashboard();
      loadDashboard();
    } else {
      showLogin();
    }

    return {
      getSessionToken: () => sessionToken,
      refresh: loadDashboard,
      logout: logout
    };

    function showDashboard() {
      loginCard.hidden = true;
      dashboard.hidden = false;
    }

    function showLogin() {
      loginCard.hidden = false;
      dashboard.hidden = true;
    }

    function logout(message) {
      sessionToken = "";
      clearOpsSession();
      showLogin();
      if (message) {
        setMessage(loginMessage, message, "warn");
      } else {
        clearMessage(loginMessage);
      }
    }
  }

  function renderProductGrid(container, products, enabled) {
    const safeProducts = Array.isArray(products) ? products : [];
    if (!safeProducts.length) {
      container.innerHTML = createEmptyCard("商品設定を読み込めませんでした。Google Sheets の Products シートを確認してください。");
      return;
    }

    const groups = safeProducts.reduce((map, product) => {
      const key = product.category || "おすすめ";
      if (!map[key]) {
        map[key] = [];
      }
      map[key].push(product);
      return map;
    }, {});

    container.innerHTML = Object.keys(groups).map((category) => `
      <section class="menu-group">
        <div class="section-heading section-heading--inline">
          <div>
            <p class="section-kicker">MENU</p>
            <h2>${escapeHtml(category)}</h2>
          </div>
        </div>
        <div class="product-grid">
          ${groups[category].map((product) => `
            <article class="product-card">
              <div class="product-image-wrap">
                <img src="${escapeAttribute(product.imageUrl || "./assets/icon.svg")}" alt="${escapeAttribute(product.name)}">
              </div>
              <div class="product-header">
                <div>
                  <h3>${escapeHtml(product.name)}</h3>
                  <p>${escapeHtml(product.description || "")}</p>
                </div>
                <strong class="product-price">${formatCurrency(product.price)}</strong>
              </div>
              <button class="primary-button" type="button" data-open-product="${escapeAttribute(product.productId)}" ${enabled ? "" : "disabled"}>
                内容をえらぶ
              </button>
            </article>
          `).join("")}
        </div>
      </section>
    `).join("");
  }

  function renderCartList(container, cart, products) {
    if (!cart.length) {
      container.innerHTML = '<li class="empty-state">カートは空です。商品をえらんでください。</li>';
      return;
    }

    const productMap = buildProductMap(products);
    container.innerHTML = cart.map((line) => {
      const product = productMap[line.productId];
      return `
        <li class="cart-item">
          <div class="cart-item-main">
            <strong>${escapeHtml(line.summaryLabel)}</strong>
            <span>${formatCurrency(line.unitPrice)} / ${escapeHtml(product ? product.name : "")}</span>
          </div>
          <div class="cart-item-actions">
            <div class="qty-control qty-control--compact">
              <button class="qty-button" type="button" data-cart-action="dec" data-uid="${escapeAttribute(line.uid)}">−</button>
              <span class="qty-value">${line.qty}</span>
              <button class="qty-button" type="button" data-cart-action="inc" data-uid="${escapeAttribute(line.uid)}">＋</button>
            </div>
            <div class="button-row button-row--tight">
              <button class="ghost-button ghost-button--small" type="button" data-cart-action="edit" data-uid="${escapeAttribute(line.uid)}">内容変更</button>
              <button class="danger-button danger-button--small" type="button" data-cart-action="remove" data-uid="${escapeAttribute(line.uid)}">削除</button>
            </div>
          </div>
          <div class="metric-row">
            <span>小計</span>
            <strong>${formatCurrency(line.qty * line.unitPrice)}</strong>
          </div>
        </li>
      `;
    }).join("");
  }

  function renderConfiguratorFields(product, existingLine) {
    const configuration = existingLine ? existingLine.configuration : {};
    const qty = existingLine ? existingLine.qty : 1;
    const config = product.config || {};
    const fields = [];

    fields.push(`
      <label class="field">
        <span>数量</span>
        <input name="lineQty" type="number" min="1" max="20" step="1" value="${qty}">
      </label>
    `);

    if (product.productType === "single_flavor") {
      fields.push(renderSelectField("flavor", "味をえらぶ", config.options || [], configuration.flavor || ""));
    } else if (product.productType === "flavor_pack") {
      const count = Number(config.count || 0);
      for (let index = 0; index < count; index += 1) {
        const current = Array.isArray(configuration.selections) ? configuration.selections[index] : "";
        fields.push(renderSelectField(`selection_${index}`, `${index + 1}個目の味`, config.options || [], current));
      }
    } else if (product.productType === "paired_flavor" || product.productType === "variety_set") {
      (config.components || []).forEach((component) => {
        fields.push(renderSelectField(component.key, component.label, component.options || [], configuration[component.key] || ""));
      });
      if (product.productType === "variety_set") {
        fields.push(`
          <div class="info-chip">
            <span>固定で入る内容</span>
            <strong>ソルトクロッフル / カレーチーズクロッフル</strong>
          </div>
        `);
      }
    }

    return fields.join("");
  }

  function renderSelectField(name, label, options, value) {
    return `
      <label class="field">
        <span>${escapeHtml(label)}</span>
        <select class="select-field" name="${escapeAttribute(name)}" required>
          <option value="">選択してください</option>
          ${options.map((option) => `
            <option value="${escapeAttribute(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>
          `).join("")}
        </select>
      </label>
    `;
  }

  function buildCartLineFromForm(product, form, editingUid) {
    const formData = new FormData(form);
    const qty = clampQuantity(Number(formData.get("lineQty") || 1));
    let configuration = {};

    if (product.productType === "single_flavor") {
      configuration = { flavor: requireField(formData.get("flavor"), "味を選んでください。") };
      assertOption(configuration.flavor, product.config.options);
    } else if (product.productType === "flavor_pack") {
      const selections = [];
      const count = Number(product.config.count || 0);
      for (let index = 0; index < count; index += 1) {
        const value = requireField(formData.get(`selection_${index}`), `${index + 1}個目の味を選んでください。`);
        assertOption(value, product.config.options);
        selections.push(value);
      }
      configuration = { selections: selections };
    } else if (product.productType === "paired_flavor" || product.productType === "variety_set") {
      configuration = {};
      (product.config.components || []).forEach((component) => {
        const value = requireField(formData.get(component.key), `${component.label} を選んでください。`);
        assertOption(value, component.options);
        configuration[component.key] = value;
      });
    }

    return {
      uid: editingUid || createUid(),
      productId: product.productId,
      productName: product.name,
      imageUrl: product.imageUrl,
      qty: qty,
      unitPrice: product.price,
      configuration: configuration,
      summaryLabel: buildLineSummary(product, configuration)
    };
  }

  function normalizeCartWithProducts(cart, products) {
    const productMap = buildProductMap(products);
    return (Array.isArray(cart) ? cart : []).map((line) => {
      const product = productMap[line.productId];
      if (!product) {
        return null;
      }
      try {
        const configuration = normalizeClientConfiguration(product, line.configuration || {});
        return {
          uid: line.uid || createUid(),
          productId: product.productId,
          productName: product.name,
          imageUrl: product.imageUrl,
          qty: clampQuantity(line.qty || 1),
          unitPrice: Number(product.price || 0),
          configuration: configuration,
          summaryLabel: buildLineSummary(product, configuration)
        };
      } catch (error) {
        return null;
      }
    }).filter(Boolean);
  }

  function normalizeClientConfiguration(product, rawConfiguration) {
    if (product.productType === "single_flavor") {
      const flavor = String(rawConfiguration.flavor || "");
      assertOption(flavor, product.config.options);
      return { flavor: flavor };
    }
    if (product.productType === "flavor_pack") {
      const selections = Array.isArray(rawConfiguration.selections) ? rawConfiguration.selections : [];
      if (selections.length !== Number(product.config.count || 0)) {
        throw new Error("味の数が足りません。");
      }
      selections.forEach((value) => assertOption(value, product.config.options));
      return { selections: selections.slice() };
    }
    if (product.productType === "paired_flavor" || product.productType === "variety_set") {
      const configuration = {};
      (product.config.components || []).forEach((component) => {
        const value = String(rawConfiguration[component.key] || "");
        assertOption(value, component.options);
        configuration[component.key] = value;
      });
      return configuration;
    }
    return {};
  }

  function buildLineSummary(product, configuration) {
    if (product.productType === "single_flavor") {
      return `${product.name}（${configuration.flavor}）`;
    }
    if (product.productType === "flavor_pack") {
      return `${product.name}（${configuration.selections.join(" / ")}）`;
    }
    if (product.productType === "paired_flavor") {
      return `${product.name}（クロッフル: ${configuration.croffleFlavor} / クルンジ: ${configuration.kurungiFlavor}）`;
    }
    if (product.productType === "variety_set") {
      return `${product.name}（SCC: ${configuration.croffleFlavor} / ${configuration.kurungiFlavor} / ソルト / カレーチーズ）`;
    }
    return product.name;
  }

  function renderSummaryItems(container, items) {
    if (!items || !items.length) {
      container.innerHTML = '<li class="empty-state">注文内容がありません。</li>';
      return;
    }
    container.innerHTML = items.map((item) => `
      <li>
        <span>${escapeHtml(item.summaryLabel)} ×${item.qty}</span>
        <strong>${formatCurrency(item.lineTotal)}</strong>
      </li>
    `).join("");
  }

  function renderStatusSteps(container, currentStatus) {
    const steps = STATUS_FLOW.slice();
    if (currentStatus === STATUS.CANCELED) {
      steps.push(STATUS.CANCELED);
    }
    const currentIndex = steps.indexOf(currentStatus);
    container.innerHTML = steps.map((status, index) => {
      const classes = ["status-step"];
      if (status === STATUS.CANCELED) {
        classes.push("is-canceled");
      } else if (index < currentIndex) {
        classes.push("is-done");
      } else if (status === currentStatus) {
        classes.push("is-current");
      }
      return `
        <div class="${classes.join(" ")}">
          <span>${index + 1}</span>
          <strong>${escapeHtml(status)}</strong>
        </div>
      `;
    }).join("");
  }

  function renderStats(container, items) {
    container.innerHTML = items.map((item) => `
      <div class="stat-card">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.value)}</strong>
      </div>
    `).join("");
  }

  function renderAdminOrderCard(order) {
    return `
      <article class="admin-order-card">
        <div class="admin-order-head">
          <h3>${escapeHtml(order.orderNumber)}</h3>
          <div class="button-row">
            <span class="status-pill" data-status="${escapeHtml(order.status)}">${escapeHtml(order.status)}</span>
            <span class="status-pill" data-status="${escapeHtml(order.paymentStatus)}">${escapeHtml(order.paymentStatus)}</span>
          </div>
        </div>
        <div class="admin-order-meta">
          <span>注文時刻: ${escapeHtml(order.orderedAtLabel)}</span>
          <span>合計: ${formatCurrency(order.totalAmount)}</span>
          <span>更新: ${escapeHtml(order.updatedAtLabel)}</span>
        </div>
        <ul class="simple-line-list">
          ${order.items.map((item) => `<li>${escapeHtml(item.summaryLabel)} ×${item.qty}</li>`).join("")}
        </ul>
        <div class="button-row">
          ${STATUS_FLOW.concat([STATUS.CANCELED]).map((status) => `
            <button class="${status === order.status ? "secondary-button" : "ghost-button"} ghost-button--small" type="button" data-order-number="${escapeAttribute(order.orderNumber)}" data-status-update="${escapeAttribute(status)}">
              ${escapeHtml(status)}
            </button>
          `).join("")}
        </div>
        <div class="metric-row">
          <span>支払い状況</span>
          <button class="${order.paymentStatus === PAYMENT.PAID ? "secondary-button" : "primary-button"}" type="button" data-order-number="${escapeAttribute(order.orderNumber)}" data-payment-toggle="${order.paymentStatus === PAYMENT.PAID ? PAYMENT.UNPAID : PAYMENT.PAID}">
            ${order.paymentStatus === PAYMENT.PAID ? "未払いに戻す" : "支払済にする"}
          </button>
        </div>
      </article>
    `;
  }

  function renderOrderingState(config, noticeNode, pillNode) {
    pillNode.textContent = config.orderingStateLabel || (config.orderingEnabled ? "受付中" : "停止中");
    pillNode.dataset.ready = String(Boolean(config.orderingEnabled));
    if (config.announcementMessage || config.orderingStateMessage) {
      setMessage(
        noticeNode,
        config.orderingEnabled
          ? [config.announcementMessage, config.isTestMode ? "テストモード中です。" : ""].filter(Boolean).join(" ")
          : config.orderingStateMessage,
        config.orderingEnabled ? "info" : "warn"
      );
    } else {
      clearMessage(noticeNode);
    }
  }

  function getKitchenAction(order) {
    if (order.status === STATUS.ACCEPTED) {
      if (order.paymentStatus !== PAYMENT.PAID) {
        return {
          label: "会計待ち",
          status: STATUS.ACCEPTED,
          note: "先に会計で支払いを完了してください。",
          disabled: true
        };
      }
      return {
        label: "調理開始",
        status: STATUS.COOKING,
        note: "支払いが完了しています。",
        disabled: false
      };
    }
    if (order.status === STATUS.COOKING) {
      return {
        label: "完成にする",
        status: STATUS.READY,
        note: "できあがったら押してください。",
        disabled: false
      };
    }
    if (order.status === STATUS.READY) {
      return {
        label: "受取済にする",
        status: STATUS.PICKED_UP,
        note: "商品を渡したら完了です。",
        disabled: false
      };
    }
    return {
      label: "完了済み",
      status: STATUS.PICKED_UP,
      note: "この注文は終了しています。",
      disabled: true
    };
  }

  function mergeCartLines(lines) {
    const merged = [];
    const indexMap = new Map();
    lines.forEach((line) => {
      const key = `${line.productId}:${JSON.stringify(line.configuration)}`;
      const existingIndex = indexMap.get(key);
      if (existingIndex === undefined) {
        indexMap.set(key, merged.length);
        merged.push(Object.assign({}, line));
      } else {
        merged[existingIndex].qty = clampQuantity(merged[existingIndex].qty + line.qty);
      }
    });
    return merged;
  }

  function getCartSummary(cart) {
    return cart.reduce((summary, line) => {
      summary.totalQty += line.qty;
      summary.totalAmount += line.qty * line.unitPrice;
      return summary;
    }, { totalQty: 0, totalAmount: 0 });
  }

  function requestApi(action, params, options) {
    const method = (options && options.method) || "GET";
    const normalizedParams = {};
    Object.keys(params || {}).forEach((key) => {
      if (params[key] !== undefined && params[key] !== null) {
        normalizedParams[key] = String(params[key]);
      }
    });
    normalizedParams.action = action;

    if (method === "POST") {
      return fetch(APP_CONFIG.gasWebAppUrl, {
        method: "POST",
        body: new URLSearchParams(normalizedParams),
        cache: "no-store"
      }).then(parseApiResponse).catch(() => requestApi(action, params, { method: "GET" }));
    }

    const url = new URL(APP_CONFIG.gasWebAppUrl);
    Object.keys(normalizedParams).forEach((key) => {
      url.searchParams.set(key, normalizedParams[key]);
    });
    return fetch(url.toString(), {
      method: "GET",
      cache: "no-store"
    }).then(parseApiResponse);
  }

  async function parseApiResponse(response) {
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new Error("API応答の解析に失敗しました。");
    }
    if (!json.ok) {
      throw new Error(json.error || "通信に失敗しました。");
    }
    return json;
  }

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

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
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

  function setLoading(button, isLoading, loadingText) {
    if (!button) {
      return;
    }
    if (!button.dataset.defaultText) {
      button.dataset.defaultText = button.textContent;
    }
    button.disabled = isLoading;
    button.textContent = isLoading ? loadingText : button.dataset.defaultText;
  }

  function hasApiConfig() {
    return Boolean(APP_CONFIG.gasWebAppUrl && APP_CONFIG.gasWebAppUrl.indexOf("script.google.com") !== -1);
  }

  function formatCurrency(value) {
    return `¥${currencyFormatter.format(Number(value || 0))}`;
  }

  function formatDateTime(value) {
    if (!value) {
      return "-";
    }
    try {
      return dateFormatter.format(new Date(value));
    } catch (error) {
      return String(value);
    }
  }

  function normalizeSearch(value) {
    return String(value || "").trim().toLowerCase();
  }

  function createEmptyCard(message) {
    return `<div class="empty-card"><p>${escapeHtml(message)}</p></div>`;
  }

  function clampQuantity(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) {
      return 1;
    }
    return Math.max(1, Math.min(20, Math.round(number)));
  }

  function findProduct(products, productId) {
    return (products || []).find((product) => product.productId === productId);
  }

  function buildProductMap(products) {
    return (products || []).reduce((map, product) => {
      map[product.productId] = product;
      return map;
    }, {});
  }

  function findCartLine(cart, uid) {
    return (cart || []).find((line) => line.uid === uid);
  }

  function requireField(value, message) {
    const text = String(value || "").trim();
    if (!text) {
      throw new Error(message);
    }
    return text;
  }

  function assertOption(value, options) {
    if (!Array.isArray(options) || options.indexOf(value) === -1) {
      throw new Error("選択内容が不正です。");
    }
  }

  function createUid() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return `line_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function toBase64Url(value) {
    const json = typeof value === "string" ? value : JSON.stringify(value);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const input = document.createElement("textarea");
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);
  }

  function saveOpsSession(token) {
    safeSetItem(STORAGE_KEYS.opsSession, token);
  }

  function loadOpsSession() {
    return safeGetItem(STORAGE_KEYS.opsSession) || "";
  }

  function clearOpsSession() {
    safeRemoveItem(STORAGE_KEYS.opsSession);
  }

  function persistDraftCart(cart) {
    safeSetJson(STORAGE_KEYS.orderDraft, { cart: cart || [] });
  }

  function loadDraftCart() {
    const draft = safeGetJson(STORAGE_KEYS.orderDraft);
    return draft && Array.isArray(draft.cart) ? draft.cart : [];
  }

  function saveLastOrder(receipt) {
    safeSetJson(STORAGE_KEYS.lastOrder, receipt);
  }

  function loadLastOrder() {
    return safeGetJson(STORAGE_KEYS.lastOrder);
  }

  function safeSetJson(key, value) {
    safeSetItem(key, JSON.stringify(value));
  }

  function safeGetJson(key) {
    try {
      const raw = safeGetItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      return;
    }
  }

  function safeGetItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      return "";
    }
  }

  function safeRemoveItem(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      return;
    }
  }

  function extractTokenFromUrl(url) {
    if (!url) {
      return "";
    }
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.searchParams.get("token") || "";
    } catch (error) {
      return "";
    }
  }

  function extractTimePart(label) {
    const match = String(label || "").match(/(\d{2}:\d{2})$/);
    return match ? match[1] : "";
  }

  function isSessionError(error) {
    return /ログイン/.test(error.message) || /期限/.test(error.message);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }
})();
