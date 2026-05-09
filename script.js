const API_URL = "https://script.google.com/macros/s/AKfycbzcIx-8qsCFcI7LaD_7RbkJ9rxLYaHzuGWwwiYeLLlw8X4hljFqMuQnEiNazarmF3zBzw/exec";

let currentUser = null;
let controlData = [];
let contractsData = [];
let settings = {};
let lastPreviewHtml = "";
let lastPreviewData = null;

document.addEventListener("DOMContentLoaded", () => {
  setTodayDefaults();
  bindEvents();
  restoreSession();
});

function bindEvents() {
  // Login as form submit (Enter on either field works)
  document.getElementById("loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    login();
  });

  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("refreshBtn").addEventListener("click", loadAllData);

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  document.getElementById("previewContractBtn").addEventListener("click", previewContract);
  document.getElementById("saveNewContractBtn").addEventListener("click", saveNewContract);
  document.getElementById("saveOldInstallmentBtn").addEventListener("click", saveOldInstallment);

  document.getElementById("downloadPdfBtn").addEventListener("click", downloadContractPdf);
  document.getElementById("printContractBtn").addEventListener("click", printContract);

  document.getElementById("reloadControlBtn").addEventListener("click", loadControl);
  document.getElementById("reloadContractsBtn").addEventListener("click", loadContracts);

  document.getElementById("controlSearch").addEventListener("input", renderControl);
  document.getElementById("contractsSearch").addEventListener("input", renderContracts);

  document.getElementById("confirmPaymentBtn").addEventListener("click", confirmPayment);

  // რედაქტირების მოდალის ღილაკები
  const saveEditBtn = document.getElementById("saveEditContractBtn");
  const deleteBtn = document.getElementById("deleteContractBtn");
  if (saveEditBtn) saveEditBtn.addEventListener("click", saveEditContract);
  if (deleteBtn) deleteBtn.addEventListener("click", deleteContract);

  // ძველი განვადება — დარჩენილი თანხის ავტო-გამოთვლა
  const oldTotal = document.getElementById("oldTotalAmount");
  const oldPaid  = document.getElementById("oldAlreadyPaid");
  const oldRem   = document.getElementById("oldRemainingAmount");

  function recalcOldRemaining() {
    const total = Number(oldTotal.value || 0);
    const paid  = Number(oldPaid.value || 0);
    const rem   = Math.max(0, Math.round((total - paid) * 100) / 100);
    oldRem.value = rem.toFixed(2);
  }

  if (oldTotal && oldPaid && oldRem) {
    oldTotal.addEventListener("input", recalcOldRemaining);
    oldPaid.addEventListener("input", recalcOldRemaining);
  }

  document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", closeModals);
  });

  // ESC იხურებს მოდალებს
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModals();
  });

  // ფონზე კლიკი ხურავს მოდალებს
  document.querySelectorAll(".modal").forEach(m => {
    m.addEventListener("click", e => {
      if (e.target === m) closeModals();
    });
  });
}

function setTodayDefaults() {
  const today = toInputDate(new Date());
  document.querySelectorAll('input[type="date"]').forEach(input => {
    if (!input.value) input.value = today;
  });
}

async function api(action, payload = {}) {
  const body = { action, ...payload };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error("API პასუხი JSON არ არის: " + text);
  }
}

async function login() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  const msg = document.getElementById("loginMessage");

  msg.textContent = "";

  if (!username || !password) {
    msg.textContent = "შეიყვანე მომხმარებელი და პაროლი";
    return;
  }

  try {
    setLoading(true);
    const result = await api("login", { username, password });

    if (!result.success) {
      msg.textContent = result.message || "შესვლა ვერ მოხერხდა";
      return;
    }

    currentUser = result.user;
    localStorage.setItem("installment_user", JSON.stringify(currentUser));
    openMain();
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    setLoading(false);
  }
}

function restoreSession() {
  const saved = localStorage.getItem("installment_user");
  if (!saved) return;

  try {
    const parsed = JSON.parse(saved);
    if (!parsed?.username || !parsed?.role) {
      localStorage.removeItem("installment_user");
      return;
    }
    currentUser = parsed;
    openMain();
  } catch {
    localStorage.removeItem("installment_user");
  }
}

async function openMain() {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("mainView").classList.remove("hidden");

  document.getElementById("userRoleText").textContent =
    currentUser.role === "admin" ? "ადმინი" : "მოლარე";

  applyRoleAccess();
  await loadAllData();
}

function logout() {
  currentUser = null;
  localStorage.removeItem("installment_user");

  document.getElementById("mainView").classList.add("hidden");
  document.getElementById("loginView").classList.remove("hidden");
}

function applyRoleAccess() {
  const isAdmin = currentUser && currentUser.role === "admin";

  document.querySelectorAll(".admin-only").forEach(el => {
    el.classList.toggle("hidden", !isAdmin);
  });

  if (!isAdmin) {
    showView("newContractView");
  } else {
    showView("dashboardView");
  }
}

function showView(viewId) {
  document.querySelectorAll(".page-view").forEach(v => v.classList.add("hidden"));
  document.getElementById(viewId).classList.remove("hidden");

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });

  const titles = {
    dashboardView: ["დეშბორდი", "საერთო ფინანსური სურათი"],
    newContractView: ["ახალი ხელშეკრულება", "ხელშეკრულება + გრაფიკი A4 ფორმატში"],
    oldInstallmentView: ["ძველი განვადება", "უკვე არსებული განვადებების კონტროლში დამატება"],
    controlView: ["გადახდების კონტროლი", "გადასახდელები, დაგვიანებები და გადახდების დამატება"],
    contractsView: ["ხელშეკრულებები", "შენახული ხელშეკრულებების ბაზა"]
  };

  document.getElementById("pageTitle").textContent = titles[viewId][0];
  document.getElementById("pageSubtitle").textContent = titles[viewId][1];
}

/* ========== LOADING (PARALLEL) ========== */
async function loadAllData() {
  try {
    setLoading(true);
    // 3 ზარი პარალელურად — ნაცვლად 3 წმ-ისა ~1 წმ
    const [settingsRes, contractsRes, controlRes] = await Promise.all([
      api("getSettings").catch(err => ({ success: false, message: err.message })),
      api("getContracts").catch(err => ({ success: false, message: err.message })),
      api("getControlData").catch(err => ({ success: false, message: err.message }))
    ]);

    if (settingsRes.success) settings = settingsRes.data || {};

    if (contractsRes.success) {
      contractsData = contractsRes.data || [];
      renderContracts();
    } else {
      toast(contractsRes.message || "ხელშეკრულებები ვერ ჩაიტვირთა", true);
    }

    if (controlRes.success) {
      controlData = controlRes.data || [];
      renderControl();
      renderDashboard();
    } else {
      toast(controlRes.message || "Control ვერ ჩაიტვირთა", true);
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    setLoading(false);
  }
}

async function loadContracts() {
  const result = await api("getContracts");
  if (!result.success) {
    toast(result.message || "ხელშეკრულებები ვერ ჩაიტვირთა", true);
    return;
  }
  contractsData = result.data || [];
  renderContracts();
}

async function loadControl() {
  const result = await api("getControlData");
  if (!result.success) {
    toast(result.message || "Control ვერ ჩაიტვირთა", true);
    return;
  }
  controlData = result.data || [];
  renderControl();
  renderDashboard();
}

/* ========== RENDERS ========== */
function renderDashboard() {
  const totalContracts = controlData.length;
  const totalRemaining = controlData.reduce((s, r) => s + num(r["სულ დარჩენილი"]), 0);
  const overdue = controlData.reduce((s, r) => s + num(r["დაგვიანებული თანხა"]), 0);
  const dueToday = controlData.filter(r => r["სტატუსი"] === "Due Today").length;

  document.getElementById("statContracts").textContent = totalContracts;
  document.getElementById("statRemaining").textContent = money(totalRemaining);
  document.getElementById("statOverdue").textContent = money(overdue);
  document.getElementById("statDueToday").textContent = dueToday;

  const rows = [...controlData]
    .filter(r => num(r["სულ დარჩენილი"]) > 0)
    .sort((a, b) => parseDateGeo(a["შემდეგი გადახდის თარიღი"]) - parseDateGeo(b["შემდეგი გადახდის თარიღი"]))
    .slice(0, 8);

  document.getElementById("dashboardRows").innerHTML = rows.map(r => `
    <tr>
      <td>${safe(r["კლიენტი"])}</td>
      <td>${safe(r["ტელეფონი"])}</td>
      <td>${safe(r["შემდეგი გადახდის თარიღი"])}</td>
      <td>${money(r["შემდეგი გადასახდელი"])}</td>
      <td>${statusBadge(r["სტატუსი"])}</td>
    </tr>
  `).join("") || emptyRow(5);
}

function renderControl() {
  const q = document.getElementById("controlSearch").value.toLowerCase().trim();

  const rows = controlData.filter(r => {
    const text = [
      r["კლიენტი"], r["პირადი ნომერი"], r["ტელეფონი"], r["პროდუქცია"], r["Contract ID"]
    ].join(" ").toLowerCase();
    return text.includes(q);
  });

  document.getElementById("controlRows").innerHTML = rows.map(r => `
    <tr>
      <td>${safe(r["კლიენტი"])}</td>
      <td>${safe(r["ტელეფონი"])}</td>
      <td>${safe(r["პროდუქცია"])}</td>
      <td>${money(r["სრული თანხა"])}</td>
      <td>${money(r["სულ გადახდილი"])}</td>
      <td><strong>${money(r["სულ დარჩენილი"])}</strong></td>
      <td>${safe(r["შემდეგი გადახდის თარიღი"])}</td>
      <td>${money(r["შემდეგი გადასახდელი"])}</td>
      <td>${money(r["დაგვიანებული თანხა"])}</td>
      <td>${statusBadge(r["სტატუსი"])}</td>
      <td>
        <div class="row-actions">
          <button class="small-btn pay" onclick="openPaymentModal('${safeAttr(r["Contract ID"])}','${safeAttr(r["კლიენტი"])}')">გადახდა</button>
          <button class="small-btn view" onclick="openDetails('${safeAttr(r["Contract ID"])}')">ნახვა</button>
        </div>
      </td>
    </tr>
  `).join("") || emptyRow(11);
}

function renderContracts() {
  const q = document.getElementById("contractsSearch").value.toLowerCase().trim();

  // ფილტრი მხოლოდ ძიებით — როლი backend-ის მხარეს იცვლება
  const rows = contractsData.filter(r => {
    const text = [
      r["Contract ID"], r["ჩანაწერის ტიპი"], r["კლიენტი"],
      r["პირადი ნომერი"], r["ტელეფონი"], r["პროდუქცია"]
    ].join(" ").toLowerCase();
    return text.includes(q);
  });

  const isAdmin = currentUser && currentUser.role === "admin";

  document.getElementById("contractsRows").innerHTML = rows.map(r => `
    <tr>
      <td>${safe(r["Contract ID"])}</td>
      <td>${safe(r["ჩანაწერის ტიპი"])}</td>
      <td>${safe(r["კლიენტი"])}</td>
      <td>${safe(r["პირადი ნომერი"])}</td>
      <td>${safe(r["ტელეფონი"])}</td>
      <td>${safe(r["პროდუქცია"])}</td>
      <td>${money(r["სრული თანხა"])}</td>
      <td>${statusBadge(r["სტატუსი"])}</td>
      <td>${safe(r["შემქმნელი"])}</td>
      <td>
        <div class="row-actions">
          <button class="small-btn view" onclick="openDetails('${safeAttr(r["Contract ID"])}')">ნახვა</button>
          ${isAdmin ? `<button class="small-btn" style="background:#fef3c7;color:#854d0e" onclick="openEditContract('${safeAttr(r["Contract ID"])}')">რედაქტ.</button>` : ''}
        </div>
      </td>
    </tr>
  `).join("") || emptyRow(10);
}

/* ========== CONTRACT BUILD / PREVIEW / SAVE ========== */
function previewContract() {
  const data = formToObject(document.getElementById("newContractForm"));

  if (!data.contractNumber || !data.buyerName || !data.buyerId || !data.products || !data.totalAmount || !data.months) {
    toast("შეავსე აუცილებელი ველები (მათ შორის ხელშეკრულების N)", true);
    return;
  }

  const html = buildContractHtml(data);
  lastPreviewHtml = html;
  lastPreviewData = data;

  const preview = document.getElementById("contractPreview");
  preview.classList.remove("empty-preview");
  preview.innerHTML = html;
}

async function saveNewContract() {
  const form = document.getElementById("newContractForm");
  if (!form.reportValidity()) return;

  const data = formToObject(form);
  data.createdBy = currentUser.username;

  try {
    setLoading(true);

    const result = await api("addNewContract", { data });
    if (!result.success) {
      toast(result.message || "შენახვა ვერ მოხერხდა", true);
      return;
    }

    const html = buildContractHtml(data);

    try {
      await api("saveContractVersion", {
        data: {
          contractId: result.contractId,
          contractHtml: html,
          createdBy: currentUser.username,
          comment: "პირველი შენახული ვერსია"
        }
      });
    } catch (verErr) {
      toast("ხელშეკრულება შეინახა, მაგრამ ვერსია ვერ შევინახე: " + verErr.message, true);
    }

    toast("ხელშეკრულება შეინახა: " + result.contractId);
    form.reset();
    setTodayDefaults();

    const preview = document.getElementById("contractPreview");
    preview.classList.add("empty-preview");
    preview.innerHTML = "შეავსე ფორმა და დააჭირე „წინასწარი ნახვა“";
    lastPreviewHtml = "";
    lastPreviewData = null;

    await loadAllData();
  } catch (err) {
    toast(err.message, true);
  } finally {
    setLoading(false);
  }
}

async function saveOldInstallment() {
  const form = document.getElementById("oldInstallmentForm");
  if (!form.reportValidity()) return;

  const data = formToObject(form);
  data.createdBy = currentUser.username;

  try {
    setLoading(true);
    const result = await api("addOldInstallment", { data });

    if (!result.success) {
      toast(result.message || "შენახვა ვერ მოხერხდა", true);
      return;
    }

    toast("ძველი განვადება დაემატა: " + result.contractId);
    form.reset();
    setTodayDefaults();
    await loadAllData();
  } catch (err) {
    toast(err.message, true);
  } finally {
    setLoading(false);
  }
}

function openPaymentModal(contractId, buyerName) {
  const form = document.getElementById("paymentForm");

  form.contractId.value = contractId;
  form.buyerName.value = buyerName;
  form.paymentDate.value = toInputDate(new Date());
  form.amount.value = "";
  form.method.value = "ნაღდი";
  form.comment.value = "";

  document.getElementById("paymentModal").classList.remove("hidden");
}

async function confirmPayment() {
  const form = document.getElementById("paymentForm");
  if (!form.reportValidity()) return;

  const data = formToObject(form);
  data.createdBy = currentUser.username;

  try {
    setLoading(true);
    const result = await api("addPayment", { data });

    if (!result.success) {
      toast(result.message || "გადახდა ვერ დაემატა", true);
      return;
    }

    closeModals();
    toast("გადახდა შეინახა");
    await loadAllData();
  } catch (err) {
    toast(err.message, true);
  } finally {
    setLoading(false);
  }
}

async function openDetails(contractId) {
  try {
    setLoading(true);
    const result = await api("getContractFull", { contractId });

    if (!result.success) {
      toast(result.message || "დეტალები ვერ მოიძებნა", true);
      return;
    }

    const c = result.contract;
    const schedule = result.schedule || [];
    const payments = result.payments || [];

    document.getElementById("detailsContent").innerHTML = `
      <div class="details-grid">
        <div class="detail-box"><span>ID</span><strong>${safe(c["Contract ID"])}</strong></div>
        <div class="detail-box"><span>კლიენტი</span><strong>${safe(c["კლიენტი"])}</strong></div>
        <div class="detail-box"><span>ტიპი</span><strong>${safe(c["ჩანაწერის ტიპი"])}</strong></div>
        <div class="detail-box"><span>პირადი ნომერი</span><strong>${safe(c["პირადი ნომერი"])}</strong></div>
        <div class="detail-box"><span>ტელეფონი</span><strong>${safe(c["ტელეფონი"])}</strong></div>
        <div class="detail-box"><span>თანხა</span><strong>${money(c["სრული თანხა"])}</strong></div>
      </div>

      <h3>გრაფიკი</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>N</th><th>თარიღი</th><th>დასარიცხი</th>
              <th>გადახდილი</th><th>დარჩენილი</th><th>სტატუსი</th>
            </tr>
          </thead>
          <tbody>
            ${schedule.map(s => `
              <tr>
                <td>${safe(s["N"])}</td>
                <td>${safe(s["გადახდის თარიღი"])}</td>
                <td>${money(s["საბოლოო დასარიცხი თანხა"])}</td>
                <td>${money(s["გადახდილი თანხა"])}</td>
                <td>${money(s["დარჩენილი თანხა"])}</td>
                <td>${statusBadge(s["სტატუსი"])}</td>
              </tr>
            `).join("") || emptyRow(6)}
          </tbody>
        </table>
      </div>

      <h3>გადახდები</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>თარიღი</th><th>თანხა</th><th>მეთოდი</th><th>კომენტარი</th><th>დაამატა</th>
            </tr>
          </thead>
          <tbody>
            ${payments.map(p => `
              <tr>
                <td>${safe(p["გადახდის თარიღი"])}</td>
                <td>${money(p["თანხა"])}</td>
                <td>${safe(p["მეთოდი"])}</td>
                <td>${safe(p["კომენტარი"])}</td>
                <td>${safe(p["დაამატა"])}</td>
              </tr>
            `).join("") || emptyRow(5)}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById("detailsModal").classList.remove("hidden");
  } catch (err) {
    toast(err.message, true);
  } finally {
    setLoading(false);
  }
}

function closeModals() {
  document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
}

/* ========== რედაქტირება ========== */
async function openEditContract(contractId) {
  try {
    setLoading(true);
    const result = await api("getContractFull", { contractId });

    if (!result.success) {
      toast(result.message || "ვერ მოიძებნა", true);
      return;
    }

    const c = result.contract;
    const form = document.getElementById("editContractForm");
    const recordType = c["ჩანაწერის ტიპი"] || 'ახალი';
    const isOld = recordType === 'ძველი';

    form.contractId.value = c["Contract ID"];
    form.recordType.value = recordType;
    form.buyerName.value = c["კლიენტი"] || '';
    form.buyerId.value = c["პირადი ნომერი"] || '';
    form.phone.value = c["ტელეფონი"] || '';
    form.address.value = c["მისამართი"] || '';
    form.products.value = c["პროდუქცია"] || '';
    form.totalAmount.value = c["სრული თანხა"] || '';
    form.advanceAmount.value = c["წინასწარი შენატანი"] || 0;
    form.alreadyPaid.value = c["უკვე გადახდილი"] || 0;
    form.months.value = c["თვეების რაოდენობა"] || '';
    form.firstPaymentDate.value = inputDateFromGeo(c["პირველი გადახდის თარიღი"]);
    form.paymentDay.value = c["გადახდის დღე"] || '';
    form.comment.value = c["კომენტარი"] || '';
    form.regenerateSchedule.checked = true;

    // ძველი / ახალი — შესაბამისი ველის ჩვენება
    document.getElementById("editAlreadyPaidWrap").style.display = isOld ? '' : 'none';
    document.getElementById("editAdvanceAmount").parentElement.style.display = isOld ? 'none' : '';

    document.getElementById("editContractModal").classList.remove("hidden");
  } catch (err) {
    toast(err.message, true);
  } finally {
    setLoading(false);
  }
}

async function saveEditContract() {
  const form = document.getElementById("editContractForm");
  if (!form.reportValidity()) return;

  const data = formToObject(form);
  data.regenerateSchedule = form.regenerateSchedule.checked;

  try {
    setLoading(true);
    const result = await api("editContract", { data });

    if (!result.success) {
      toast(result.message || "შენახვა ვერ მოხერხდა", true);
      return;
    }

    toast("ხელშეკრულება განახლდა");
    closeModals();
    await loadAllData();
  } catch (err) {
    toast(err.message, true);
  } finally {
    setLoading(false);
  }
}

async function deleteContract() {
  const form = document.getElementById("editContractForm");
  const id = form.contractId.value;
  if (!id) return;

  if (!confirm(`დარწმუნებული ხარ, რომ წაშალო ხელშეკრულება ${id}?\nეს ქმედება შეუქცევადია — წაიშლება ყველაფერი (გრაფიკი, გადახდები).`)) {
    return;
  }

  try {
    setLoading(true);
    const result = await api("deleteContract", { contractId: id });

    if (!result.success) {
      toast(result.message || "წაშლა ვერ მოხერხდა", true);
      return;
    }

    toast("ხელშეკრულება წაიშალა");
    closeModals();
    await loadAllData();
  } catch (err) {
    toast(err.message, true);
  } finally {
    setLoading(false);
  }
}

// "dd.MM.yyyy" → "yyyy-MM-dd" (input[type=date]-სთვის)
function inputDateFromGeo(value) {
  if (!value) return '';
  const str = String(value);
  if (str.includes('.')) {
    const [d, m, y] = str.split('.');
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  if (str.includes('-')) return str.substring(0, 10);
  try {
    return toInputDate(new Date(str));
  } catch {
    return '';
  }
}

/* ========== ბეჭდვა (Ctrl+P / Print ღილაკი) ========== */
function printContract() {
  const preview = document.getElementById("contractPreview");
  if (!lastPreviewHtml || preview.classList.contains("empty-preview")) {
    toast("ჯერ შექმენი წინასწარი ხედი", true);
    return;
  }
  // მცირე დაყოვნება — დარწმუნდება რომ DOM სრულად განახლდა
  setTimeout(() => window.print(), 100);
}

/* ========== PDF — თითოეული .contract-page ცალკე A4-ად ========== */
async function downloadContractPdf() {
  const preview = document.getElementById("contractPreview");

  if (!lastPreviewHtml || preview.classList.contains("empty-preview")) {
    toast("ჯერ შექმენი წინასწარი ხედი", true);
    return;
  }

  const pages = preview.querySelectorAll(".contract-page");
  if (!pages.length) {
    toast("გვერდები ვერ მოიძებნა", true);
    return;
  }

  // jsPDF და html2canvas html2pdf.bundle-დან
  const JsPdfClass = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  const h2c = window.html2canvas;

  if (!JsPdfClass || !h2c) {
    toast("PDF ბიბლიოთეკა არ ჩაიტვირთა", true);
    return;
  }

  setLoading(true);

  try {
    const pdf = new JsPdfClass({ orientation: "p", unit: "mm", format: "a4" });
    const A4_W = 210;
    const A4_H = 297;

    for (let i = 0; i < pages.length; i++) {
      if (i > 0) pdf.addPage();

      // box-shadow ვიზუალურად გადავარიდოთ canvas-ში
      const originalShadow = pages[i].style.boxShadow;
      pages[i].style.boxShadow = "none";

      const canvas = await h2c(pages[i], {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false
      });

      pages[i].style.boxShadow = originalShadow;

      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const ratio = canvas.height / canvas.width;

      let imgW = A4_W;
      let imgH = A4_W * ratio;

      // თუ შინაარსი მაღალია, ცენტრში მოვათავსოთ
      if (imgH > A4_H) {
        imgH = A4_H;
        imgW = A4_H / ratio;
      }

      const x = (A4_W - imgW) / 2;
      const y = 0;

      pdf.addImage(imgData, "JPEG", x, y, imgW, imgH);
    }

    const fileName = `khelshekruleba-${(lastPreviewData?.contractNumber || "ganvadeba")}.pdf`;
    pdf.save(fileName);
  } catch (err) {
    toast("PDF შექმნის შეცდომა: " + err.message, true);
  } finally {
    setLoading(false);
  }
}

/* ========== HTML BUILDER ========== */
function buildContractHtml(data) {
  const contractNumber = safe(data.contractNumber);
  const buyerName = safe(data.buyerName);
  const buyerId = safe(data.buyerId);
  const phone = safe(data.phone);
  const address = safe(data.address);
  const products = safe(data.products);
  const totalAmount = money(data.totalAmount);
  const advanceAmount = money(data.advanceAmount || 0);
  const installmentAmount = money(num(data.totalAmount) - num(data.advanceAmount));
  const contractDate = formatInputDateGeo(data.contractDate);

  const months = Math.max(1, Number(data.months || 1));
  const paymentDay = Number(data.paymentDay) ||
    (data.firstPaymentDate ? new Date(data.firstPaymentDate).getDate() : 15);

  const schedule = buildLocalSchedule(data);
  const lastDate = schedule.length ? schedule[schedule.length - 1].date : contractDate;
  const baseInstallment = schedule.length ? schedule[0].amount : 0;

  /* ============ PAGE 1 ============ */
  const page1 = `
    <div class="contract-page">
      <div class="contract-title">
        საყოფაცხოვრებო პროდუქციის (ავეჯი)<br>
        განვადებით ნასყიდობის შესახებ<br>
        ხელშეკრულება № ${contractNumber}
      </div>

      <div class="contract-top">
        <span>ქ. ბათუმი</span>
        <span>${contractDate} წელი</span>
      </div>

      <p>
        ჩვენ, ქვემოთ ხელის მომწერნი, ერთის მხრივ - შ.პ.ს. ,,ედელვაისი"-ს
        (ს/კ: 448408054) დირექტორი - გიორგი წულუკიძე (პ/ნ 61006068844),
        შემდგომში "გამყიდველი" წოდებული და მეორეს მხრივ ${buyerName}
        (პ/ნ-${buyerId}), შემდგომში ,,მყიდველი", ადასტურებენ, რომ მათ შორის
        მიღწეულია შეთანხმება და აფორმებენ წინამდებარე ხელშეკრულებას შემდეგზე:
      </p>

      <div class="products-block">
        <strong>ნასყიდობის საგანი (პროდუქცია):</strong>
        <div class="products-list">${products}</div>
      </div>

      <div class="contract-article">მუხლი 1. ხელშეკრულების და ნასყიდობის საგანი</div>
      <p>1.1. წინამდებარე ხელშეკრულების საგანია გამყიდველის საკუთრებაში არსებული, ზემოთ აღნიშნული საყოფაცხოვრებო პროდუქციის მყიდველისათვის ნასყიდობის საგნის საკუთრების უფლებით გადაცემა ანაზღაურების სანაცვლოდ.</p>
      <p>1.2. საკუთრების უფლება მყიდველისათვის გადაცემულად ითვლება ნასყიდობის საგნის გადაცემასთან ერთად.</p>
      <p>1.3. ნასყიდობის საგანი განისაზღვრება წინამდებარე ხელშეკრულების დანართით, რასაც მყიდველი შეარჩევს გამყიდველის საკუთრებაში არსებულ კონკრეტულ პროდუქციას (შემდგომში - ნასყიდობის საგანი).</p>
      <p>1.4. წინამდებარე ხელშეკრულებით გათვალისწინებული ვალდებულებების სრულად შესრულებამდე მყიდველს უფლება არ აქვს გაასხვისოს, დააზიანოს, ან/და უფლებრივად დატვირთოს ნასყიდობის საგანი.</p>

      <div class="contract-article">მუხლი 2. ნასყიდობის საფასური და გადახდა</div>
      <p>2.1. ნასყიდობის საფასური განისაზღვრება ინდივიდუალურად, მყიდველის მიერ კონკრეტული ნასყიდობის საგნის შერჩევის დროს, დანართის შესაბამისად.</p>
      <p>2.2. ნასყიდობის საფასურის გადახდა ხორციელდება განვადებით. ნასყიდობის საფასური და გადახდის გრაფიკი განისაზღვრება ინდივიდუალურად, წინამდებარე ხელშეკრულების დანართით, რომელიც გამომდინარეობს მყიდველის მიერ შერჩეული კონკრეტული პროდუქციის შესაბამისად.</p>
      <p>2.3. გადახდის გრაფიკის ზედიზედ ორჯერ დარღვევის შემთხვევაში, თუკი ვადაგადაცილებული დღეების ოდენობა აღემატება - 15 (თხუთმეტი) კალენდარულ დღეს, გამყიდველი ან/და გამყიდველის უფლებამოსილი პირი უფლებამოსილია შეწყვიტოს ხელშეკრულება მყიდველისათვის სატელეფონო შეტყობინების გაგზავნის გზით, ელ-ფოსტაზე შეტყობინებით და მოითხოვოს გადახდის გრაფიკით განსაზღვრული გადაუხდელი თანხისა და ხელშეკრულებით გათვალისწინებული ყველა სხვა გადასახდელის სრული ოდენობით გადახდა.</p>
      <p>2.4. ვალდებულების შესრულების მიზნით, გამყიდველი ან/და გამყიდველის მიერ უფლებამოსილი პირი უფლებამოსილია დაუკავშირდეს მყიდველს, მათ შორის, სატელეფონო თუ სხვადასხვა სახის შეტყობინების გზით, შეახსენოს ვალდებულების შესრულების თარიღი, გრაფიკის დარღვევის ფაქტი, გამყიდველის მოთხოვნის უფლებები.</p>
      <p>2.5. მყიდველი უფლებამოსილია ვადამდე დაფაროს სრულად გრაფიკით გათვალისწინებული სრული საფასური, რისთვისაც მას არ დაეკისრება დამატებითი საკომისიო ან/და პირგასამტეხლო.</p>
    </div>
  `;

  /* ============ PAGE 2 ============ */
  const page2 = `
    <div class="contract-page">
      <div class="contract-article">მუხლი 3. კომუნიკაცია. სასამართლო უწყების ჩაბარება</div>
      <p>3.1. გამყიდველის ან/და გამყიდველის უფლებამოსილი პირის მიერ კომუნიკაცია განხორციელდება შემდეგი საშუალებებით: სატელეფონო კომუნიკაცია; ელ-ფოსტის მეშვეობით კომუნიკაცია; ნასყიდობის საგნის ადგილსამყოფელისა და მისი მდგომარეობის შესამოწმებლად მყიდველის საცხოვრებელ ადგილზე ვიზიტი; მყიდველის მიერ მითითებულ მისამართზე ვიზიტი; ოფიციალური კორესპონდენციის გაგზავნა მყიდველის მიერ მითითებულ მისამართზე.</p>
      <p>3.2. წინამდებარე ხელშეკრულებით გათვალისწინებული საკომუნიკაციო მონაცემები განისაზღვრება დანართით, რომელიც წარმოადგენს ხელშეკრულების განუყოფელ ნაწილს.</p>

      <div class="contract-article">მუხლი 4. დავების გადაწყვეტა</div>
      <p>4.1. მხარეები შეეცდებიან ხელშეკრულებიდან წარმოშობილი დავები გადაწყვიტონ ურთიერთშეთანხმებით.</p>
      <p>4.2. მხარეებს უფლება აქვთ დავის გადასაწყვეტად მიმართონ სასამართლოს საქართველოს სამოქალაქო საპროცესო კოდექსით დადგენილი წესით. პირველი ინსტანციის მიერ მიღებული გადაწყვეტილება ექვემდებარება დაუყოვნებლივ აღსრულებას.</p>

      <div class="contract-article">მუხლი 5. დასკვნითი დებულებები</div>
      <p>5.1. წინამდებარე ხელშეკრულება მოქმედებს მხარეთა მიერ ნაკისრი ვალდებულებების სრულად შესრულებამდე.</p>
      <p>5.2. ამ ხელშეკრულების ნებისმიერი ცვლილება და დამატება ძალაშია მხოლოდ იმ პირობით, თუ ის შედგენილია წერილობითი ფორმით და ხელმოწერილია მხარეთა მიერ ან/და სათანადო რწმუნებულების მქონე წარმომადგენელთა მიერ.</p>
      <p>5.3. ეს ხელშეკრულება შედგენილია ორ იდენტურ ეგზემპლარად, ქართულ ენაზე, რომელიც გადაეცემა მხარეებს და ორივე ეგზემპლიარი თანაბარი იურიდიული ძალის მქონეა.</p>
      <p>5.4. მყიდველი თანახმაა, გამყიდველმა დაამუშაოს წინამდებარე ხელშეკრულებიდან გამომდინარე პერსონალური მონაცემები, მათ შორის, სახელი, გვარი, პირადი ნომერი, დაბადების თარიღი, სამუშაო ადგილი, პროფესია, ოჯახური მდგომარეობა, დაბადების ადგილი, ელ-ფოსტა, ტელეფონის ნომერი, მისამართი, სოციალურ ქსელში არსებული ინფორმაცია, ფოტოსურათი, ალტერნატიული მისამართი, ფინანსური მონაცემები, გადახდასთან დაკავშირებული ინფორმაცია, სქესი, კანონიერი გზებითა და მიზნებით, მათ შორის, ამ ხელშეკრულებით გათვალისწინებული მიზნებისათვის.</p>

      <div class="contract-article">მუხლი 6. მხარეთა ხელმოწერები და რეკვიზიტები</div>

      <div class="signature-grid">
        <div>
          <strong>გამყიდველი:</strong><br>
          შ.პ.ს. ,,ედელვაისი"-ს (ს/კ: 448408054)<br>
          დირექტორი --------------------- /გიორგი წულუკიძე/<br>
          მის: ქ. ბათუმი, ლორიას ქუჩა #7<br>
          ელ. ფოსტა: giorgi.tsulukidze94@gmail.com<br>
          ტელ: 557 25-06-06;
        </div>
        <div>
          <strong>მყიდველი:</strong><br>
          --------------------- /${buyerName}/<br>
          პ/ნ: ${buyerId}<br>
          მის: ${address}<br>
          ტელ: ${phone};
        </div>
      </div>
    </div>
  `;

  /* ============ PAGE 3 — SCHEDULE ============ */
  const scheduleRows = schedule.map(row => `
    <tr>
      <td>${row.n}</td>
      <td>${row.date}</td>
      <td>${money(row.amount)}</td>
      <td>${money(row.remaining)}</td>
      <td>${money(row.balance)}</td>
    </tr>
  `).join("");

  const page3 = `
    <div class="contract-page schedule-page">
      <div class="schedule-title">დაფარვის გრაფიკი</div>

      <div class="schedule-meta">
        <div><span>კლიენტის სახელი:</span><strong>${buyerName}</strong></div>
        <div><span>განვადება N:</span><strong>${contractNumber}</strong></div>
        <div><span>პირადი ნომერი:</span><strong>${buyerId}</strong></div>
        <div><span>წინასწარი შენატანი:</span><strong>${advanceAmount}</strong></div>
        <div><span>განვადების მოცულობა:</span><strong>${totalAmount}</strong></div>
        <div><span>განვადების გაცემის თარიღი:</span><strong>${contractDate}</strong></div>
        <div><span>პროცენტი:</span><strong>0.0%</strong></div>
        <div><span>განვადების დასრულების თარიღი:</span><strong>${lastDate}</strong></div>
        <div><span>ვადა (თვე):</span><strong>${months}</strong></div>
        <div><span>ყოველთვიური შენატანი:</span><strong>${money(baseInstallment)}</strong></div>
      </div>

      <div class="schedule-note">გადახდების გრაფიკი ყოველთვის <strong>${paymentDay}</strong> რიცხვში</div>
      <div class="schedule-total">სულ: ${installmentAmount}</div>

      <table class="schedule-table">
        <thead>
          <tr>
            <th style="width:8%">#</th>
            <th style="width:20%">თარიღი</th>
            <th style="width:24%">შესატანი თანხა</th>
            <th style="width:24%">ფულადი ნაშთი</th>
            <th style="width:24%">ბალანსი</th>
          </tr>
        </thead>
        <tbody>${scheduleRows}</tbody>
      </table>

      <div class="schedule-signature">
        <div class="sig-block">
          <div class="sig-name">გიორგი წულუკიძე</div>
          <div class="sig-line">- - - - - - - - - - - - - - - - - - - -</div>
        </div>
        <div class="sig-block">
          <div class="sig-name">${buyerName}</div>
          <div class="sig-line">- - - - - - - - - - - - - - - - - - - -</div>
        </div>
      </div>
    </div>
  `;

  return page1 + page2 + page3;
}

/* ========== SCHEDULE BUILDER (DATE-SAFE) ========== */
function buildLocalSchedule(data) {
  const months = Math.max(1, Number(data.months || 1));
  const total = round2(num(data.totalAmount) - num(data.advanceAmount));
  const base = round2(total / months);

  const firstDate = data.firstPaymentDate
    ? parseInputDate(data.firstPaymentDate)
    : new Date();

  const paymentDay = Number(data.paymentDay) || firstDate.getDate();

  let rows = [];
  let generated = 0;
  let balance = total;

  for (let i = 1; i <= months; i++) {
    let d;

    if (i === 1) {
      d = new Date(firstDate);
    } else {
      // უსაფრთხო თვის დამატება (Feb 30 -> Feb 28/29)
      const target = new Date(firstDate.getFullYear(), firstDate.getMonth() + (i - 1), 1);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(paymentDay, lastDay));
      d = target;
    }

    let amount = base;
    if (i === months) amount = round2(total - generated);

    generated = round2(generated + amount);
    balance = round2(balance - amount);

    rows.push({
      n: i,
      date: formatDateGeo(d),
      amount,
      remaining: Math.max(round2(total - generated), 0),
      balance: Math.max(balance, 0)
    });
  }

  return rows;
}

/* ========== HELPERS ========== */
function formToObject(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = typeof value === "string" ? value.trim() : value;
  });
  return data;
}

function setLoading(isLoading) {
  document.body.style.cursor = isLoading ? "wait" : "default";
}

function toast(message, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.style.background = isError ? "#dc2626" : "#111827";
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3500);
}

function safe(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeAttr(value) {
  return safe(value).replaceAll("\n", " ");
}

function num(value) {
  const n = Number(String(value || 0).replaceAll(",", ""));
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  return `${round2(num(value)).toLocaleString("ka-GE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ₾`;
}

function statusBadge(status) {
  const map = {
    Active: "აქტიური",
    Closed: "დასრულებული",
    Overdue: "დაგვიანებული",
    "Due Today": "დღეს გადასახდელი",
    Pending: "გადასახდელი",
    Paid: "გადახდილი",
    Partial: "ნაწილობრივი",
    Cancelled: "გაუქმებული"
  };

  const validClasses = ["Active","Closed","Overdue","DueToday","Pending","Paid","Partial","Cancelled"];
  const raw = String(status || "Active").replaceAll(" ", "");
  const cls = validClasses.includes(raw) ? raw : "Active";

  return `<span class="badge ${cls}">${map[status] || safe(status)}</span>`;
}

function emptyRow(cols) {
  return `<tr><td colspan="${cols}" style="text-align:center;color:#6b7280;padding:24px;">მონაცემები არ არის</td></tr>`;
}

function toInputDate(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// უსაფრთხო parsing input[type=date]-დან (timezone-ის გარეშე)
function parseInputDate(value) {
  if (!value) return new Date();
  const [y, m, d] = String(value).split("-").map(Number);
  if (!y || !m || !d) return new Date(value);
  return new Date(y, m - 1, d);
}

function formatDateGeo(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const y = d.getFullYear();
  return `${day}.${m}.${y}`;
}

function formatInputDateGeo(value) {
  if (!value) return formatDateGeo(new Date());
  return formatDateGeo(parseInputDate(value));
}

function parseDateGeo(value) {
  if (!value) return new Date("2999-01-01");
  const str = String(value);
  if (str.includes(".")) {
    const [d, m, y] = str.split(".");
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  return new Date(str);
}
