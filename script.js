
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
  const ORDER_DRAFT_KEY = "festival_order_draft_v1";
  const ORDER_RECEIPT_KEY = "festival_order_receipt_v1";
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

    mountProductGrid(grid, quantities, handleDraftChange);
    restoreSavedState();
    updateSummary();

    nameInput.addEventListener("input", persistCurrentDraft);
    gradeInput.addEventListener("input", persistCurrentDraft);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage(message);
